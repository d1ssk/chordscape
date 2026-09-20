import { chordscapeCandidateManifest } from './candidateManifest';

export interface PreviewRun {
  run_id: string;
  dataset_version: string;
  trained_styles: string[];
  validation_nll: number;
  best_epoch: number;
  config: {
    context: number;
    dropout: number;
    learning_rate: number;
    epochs: number;
  };
}

export const SPACE_MODEL_CONTEXT = 48;

export function runSupportsStyle(run: PreviewRun, style: string): boolean {
  return style === 'free' || run.trained_styles.includes(style);
}

/** Prefer the reviewed public corpus, comparing validation loss within a corpus. */
export function selectSpaceModelRun(
  runs: readonly PreviewRun[],
): PreviewRun | null {
  return (
    runs
      .filter((run) => run.config.context === SPACE_MODEL_CONTEXT)
      .sort(
        (a, b) =>
          Number(b.dataset_version === 'public-v1') -
            Number(a.dataset_version === 'public-v1') ||
          a.validation_nll - b.validation_nll ||
          a.run_id.localeCompare(b.run_id),
      )[0] ?? null
  );
}

export function modelInputHistory(
  history: readonly string[],
  context: number,
): string[] {
  const limit = Math.max(0, Math.floor(context));
  return limit ? history.slice(-limit) : [];
}

export interface PreviewCandidate {
  ids: string[];
  rank: number;
  probability: number;
}

export interface PreviewPrediction {
  run_id: string;
  context: number;
  history_used: number;
  candidate_version: string;
  candidates: PreviewCandidate[];
}

const expected = chordscapeCandidateManifest();
const endpoint = (name: string) =>
  `${import.meta.env.BASE_URL}model-api/${name}`;

async function responseJson(response: Response) {
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
  return value;
}

export async function fetchPreviewRuns(
  signal: AbortSignal,
): Promise<PreviewRun[]> {
  const value = await responseJson(
    await fetch(endpoint('models'), { signal, cache: 'no-store' }),
  );
  const ids = expected.nodes.map((node) => node[0]).sort();
  if (
    value.candidate_version !== expected.version ||
    JSON.stringify(value.candidate_ids) !== JSON.stringify(ids) ||
    !Array.isArray(value.runs)
  )
    throw new Error('Candidate manifest does not match Harmonic Space.');
  return value.runs as PreviewRun[];
}

export async function fetchPreviewPrediction(
  run: PreviewRun,
  style: string,
  history: readonly string[],
  signal: AbortSignal,
): Promise<PreviewPrediction> {
  const runId = run.run_id;
  const value = await responseJson(
    await fetch(endpoint('predict'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        run_id: runId,
        style,
        history: modelInputHistory(history, run.config.context),
      }),
      signal,
      cache: 'no-store',
    }),
  );
  if (
    value.run_id !== runId ||
    value.candidate_version !== expected.version ||
    !Array.isArray(value.candidates)
  )
    throw new Error('Unexpected prediction response.');
  return value as PreviewPrediction;
}
