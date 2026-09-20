import { chordscapeCandidateManifest } from './candidateManifest';
import type { PreviewPrediction } from './modelPreview';

type State = [number, number, string, string, number[], string[]];
type Descriptor = { offset: number; shape: number[] };
export interface BrowserModelManifest {
  schema_version: number;
  run_id: string;
  dataset_version: string;
  candidate_version: string;
  config: { context: number; d_model: number; layers: number; heads: number };
  vocabulary: Record<string, string[]>;
  candidates: { ids: string[]; state: State }[];
  weights_file: string;
  weights_sha256: string;
  tensors: Record<string, Descriptor>;
}

const CATS = ['degree', 'accidental', 'quality', 'seventh'] as const;
const BITS = ['extensions', 'alterations'] as const;

function logSumExp(values: readonly number[]) {
  const max = Math.max(...values);
  return (
    max +
    Math.log(values.reduce((sum, value) => sum + Math.exp(value - max), 0))
  );
}

function erf(value: number) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const polynomial =
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
    t;
  return sign * (1 - polynomial * Math.exp(-x * x));
}

function gelu(value: number) {
  return (value / 2) * (1 + erf(value / Math.SQRT2));
}

function linear(
  input: Float32Array,
  weight: Float32Array,
  bias: Float32Array,
  output: number,
) {
  const width = input.length;
  const result = new Float32Array(output);
  for (let row = 0; row < output; row++) {
    let sum = bias[row];
    const start = row * width;
    for (let col = 0; col < width; col++)
      sum += weight[start + col] * input[col];
    result[row] = sum;
  }
  return result;
}

function norm(input: Float32Array, weight: Float32Array, bias: Float32Array) {
  const width = input.length;
  let mean = 0;
  for (const value of input) mean += value;
  mean /= width;
  let variance = 0;
  for (const value of input) variance += (value - mean) ** 2;
  const scale = 1 / Math.sqrt(variance / width + 1e-5);
  const output = new Float32Array(width);
  for (let i = 0; i < width; i++)
    output[i] = (input[i] - mean) * scale * weight[i] + bias[i];
  return output;
}

function add(left: Float32Array, right: Float32Array) {
  const output = new Float32Array(left.length);
  for (let i = 0; i < output.length; i++) output[i] = left[i] + right[i];
  return output;
}

export class BrowserTransformer {
  private readonly tensors = new Map<string, Float32Array>();
  private readonly byId = new Map<string, State>();
  private readonly bitCount: number;

  constructor(
    readonly manifest: BrowserModelManifest,
    buffer: ArrayBuffer,
  ) {
    const expected = chordscapeCandidateManifest();
    if (
      manifest.schema_version !== 1 ||
      manifest.dataset_version !== 'public-pop-jazz-v1' ||
      manifest.candidate_version !== expected.version ||
      manifest.config.context !== 48 ||
      manifest.config.d_model !== 128 ||
      manifest.config.layers !== 4 ||
      manifest.config.heads !== 4 ||
      JSON.stringify(manifest.vocabulary.styles) !==
        JSON.stringify(['jazz', 'pop'])
    )
      throw new Error('Unsupported browser model manifest.');
    const actualIds = manifest.candidates
      .flatMap((candidate) => candidate.ids)
      .sort();
    const expectedIds = expected.nodes.map((node) => node[0]).sort();
    if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds))
      throw new Error('Model candidates differ from Harmonic Space.');
    const expectedStates = new Map(
      expected.nodes.map((node) => [node[0], node.slice(1, 7)]),
    );
    for (const candidate of manifest.candidates)
      for (const id of candidate.ids) {
        if (
          JSON.stringify(candidate.state) !==
          JSON.stringify(expectedStates.get(id))
        )
          throw new Error(`Model candidate factors differ: ${id}`);
        this.byId.set(id, candidate.state);
      }
    this.bitCount = BITS.reduce(
      (sum, head) => sum + manifest.vocabulary[head].length,
      0,
    );
    if (buffer.byteLength % 4) throw new Error('Invalid model binary length.');
    for (const [name, descriptor] of Object.entries(manifest.tensors)) {
      const size = descriptor.shape.reduce((product, dim) => product * dim, 1);
      if (
        descriptor.offset % 4 ||
        descriptor.offset < 0 ||
        descriptor.offset + size * 4 > buffer.byteLength
      )
        throw new Error(`Invalid model tensor: ${name}`);
      this.tensors.set(name, new Float32Array(buffer, descriptor.offset, size));
    }
  }

  private tensor(name: string) {
    const value = this.tensors.get(name);
    if (!value) throw new Error(`Missing model tensor: ${name}`);
    return value;
  }

  private encode(state: State) {
    const values = [String(state[0]), String(state[1]), state[2], state[3]];
    const categories = CATS.map((head, index) => {
      const vocabulary = this.manifest.vocabulary[head];
      const found = vocabulary.indexOf(values[index]);
      return found < 0 ? vocabulary.indexOf('__UNK__') : found;
    });
    const bits = new Float32Array(this.bitCount);
    let offset = 0;
    for (const [index, head] of BITS.entries()) {
      const active = (index === 0 ? state[4] : state[5]).map(String);
      for (let bit = 0; bit < this.manifest.vocabulary[head].length; bit++)
        if (active.includes(this.manifest.vocabulary[head][bit]))
          bits[offset + bit] = 1;
      offset += this.manifest.vocabulary[head].length;
    }
    return { categories, bits };
  }

  private forward(history: readonly State[], style: 'jazz' | 'pop') {
    const { context, d_model: width, layers, heads } = this.manifest.config;
    const length = Math.min(history.length + 1, context);
    const start = history.length + 1 - length;
    const styleIndex = this.manifest.vocabulary.styles.indexOf(style);
    const styleWeight = this.tensor('style_embedding.weight');
    const positionWeight = this.tensor('position_embedding.weight');
    const bitWeight = this.tensor('bit_embedding.weight');
    let hidden: Float32Array[] = [];
    for (let position = start; position <= history.length; position++) {
      const local = position - start;
      const encoded = position ? this.encode(history[position - 1]) : null;
      const row = new Float32Array(width);
      for (let dimension = 0; dimension < width; dimension++) {
        let value =
          styleWeight[styleIndex * width + dimension] +
          positionWeight[local * width + dimension];
        for (const [index, head] of CATS.entries())
          value += this.tensor(`embeddings.${head}.weight`)[
            ((encoded?.categories[index] ?? -1) + 2) * width + dimension
          ];
        if (encoded)
          for (let bit = 0; bit < this.bitCount; bit++)
            value +=
              bitWeight[dimension * this.bitCount + bit] * encoded.bits[bit];
        row[dimension] = value;
      }
      hidden.push(row);
    }

    const headWidth = width / heads;
    for (let layer = 0; layer < layers; layer++) {
      const prefix = `encoder.layers.${layer}.`;
      const normalized = hidden.map((row) =>
        norm(
          row,
          this.tensor(prefix + 'norm1.weight'),
          this.tensor(prefix + 'norm1.bias'),
        ),
      );
      const qkv = normalized.map((row) =>
        linear(
          row,
          this.tensor(prefix + 'self_attn.in_proj_weight'),
          this.tensor(prefix + 'self_attn.in_proj_bias'),
          width * 3,
        ),
      );
      const attended: Float32Array[] = [];
      for (let token = 0; token < length; token++) {
        const output = new Float32Array(width);
        for (let head = 0; head < heads; head++) {
          const scores = new Float64Array(token + 1);
          let largest = -Infinity;
          for (let past = 0; past <= token; past++) {
            let dot = 0;
            for (let dim = 0; dim < headWidth; dim++)
              dot +=
                qkv[token][head * headWidth + dim] *
                qkv[past][width + head * headWidth + dim];
            scores[past] = dot / Math.sqrt(headWidth);
            largest = Math.max(largest, scores[past]);
          }
          let total = 0;
          for (let past = 0; past <= token; past++)
            total += scores[past] = Math.exp(scores[past] - largest);
          for (let dim = 0; dim < headWidth; dim++) {
            let value = 0;
            for (let past = 0; past <= token; past++)
              value +=
                (scores[past] / total) *
                qkv[past][2 * width + head * headWidth + dim];
            output[head * headWidth + dim] = value;
          }
        }
        attended.push(
          add(
            hidden[token],
            linear(
              output,
              this.tensor(prefix + 'self_attn.out_proj.weight'),
              this.tensor(prefix + 'self_attn.out_proj.bias'),
              width,
            ),
          ),
        );
      }
      hidden = attended.map((row) => {
        const input = norm(
          row,
          this.tensor(prefix + 'norm2.weight'),
          this.tensor(prefix + 'norm2.bias'),
        );
        const first = linear(
          input,
          this.tensor(prefix + 'linear1.weight'),
          this.tensor(prefix + 'linear1.bias'),
          width * 4,
        );
        for (let i = 0; i < first.length; i++) first[i] = gelu(first[i]);
        return add(
          row,
          linear(
            first,
            this.tensor(prefix + 'linear2.weight'),
            this.tensor(prefix + 'linear2.bias'),
            width,
          ),
        );
      });
    }
    const last = norm(
      hidden[length - 1],
      this.tensor('normalizer.weight'),
      this.tensor('normalizer.bias'),
    );
    const categorical = CATS.map((head) => {
      const logits = linear(
        last,
        this.tensor(`outputs.${head}.weight`),
        this.tensor(`outputs.${head}.bias`),
        this.manifest.vocabulary[head].length,
      );
      const denominator = logSumExp(Array.from(logits));
      return logits.map((value) => value - denominator);
    });
    const bitLogits = linear(
      last,
      this.tensor('bits_output.weight'),
      this.tensor('bits_output.bias'),
      this.bitCount,
    );
    let emptyBits = 0;
    for (const value of bitLogits) emptyBits -= Math.log1p(Math.exp(value));
    return this.manifest.candidates.map((candidate) => {
      const encoded = this.encode(candidate.state);
      let value = emptyBits;
      for (let index = 0; index < CATS.length; index++)
        value += categorical[index][encoded.categories[index]];
      for (let bit = 0; bit < this.bitCount; bit++)
        value += encoded.bits[bit] * bitLogits[bit];
      return value;
    });
  }

  predict(historyIds: readonly string[], style: string): PreviewPrediction {
    if (!['free', 'jazz', 'pop'].includes(style))
      throw new Error(`Untrained model style: ${style}`);
    const history = historyIds.map((id) => {
      const state = this.byId.get(id);
      if (!state) throw new Error(`Unknown chord ID: ${id}`);
      return state;
    });
    let scores: number[];
    if (style === 'free') {
      const jazz = this.forward(history, 'jazz');
      const pop = this.forward(history, 'pop');
      scores = jazz.map(
        (value, index) => logSumExp([value, pop[index]]) - Math.LN2,
      );
    } else {
      scores = this.forward(history, style as 'jazz' | 'pop');
    }
    const denominator = logSumExp(scores);
    const candidates = this.manifest.candidates.map((candidate, index) => ({
      ids: candidate.ids,
      rank: 0,
      probability: Math.exp(scores[index] - denominator),
    }));
    candidates.sort(
      (a, b) =>
        b.probability - a.probability || a.ids[0].localeCompare(b.ids[0]),
    );
    candidates.forEach((candidate, index) => {
      candidate.rank = index + 1;
    });
    return {
      run_id: this.manifest.run_id,
      context: this.manifest.config.context,
      history_used: Math.min(history.length, this.manifest.config.context),
      candidate_version: this.manifest.candidate_version,
      candidates,
    };
  }
}
