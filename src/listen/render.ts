import { PIANO_NOTES, pianoFile } from '../audio/instruments';
import { createNoteVoice } from '../audio/voices';
import {
  buildListenPlan,
  LISTEN_RATE,
  listenSpeechTokens,
  type ListenPlan,
  type ListenSettings,
} from './plan';
import { speechFile, type SpeechToken } from './speech';
export interface RenderedListen {
  blob: Blob;
  plan: ListenPlan;
}
const yieldToUI = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
export function wavHeader(frames: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) =>
    [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + frames * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, LISTEN_RATE, true);
  view.setUint32(28, LISTEN_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, frames * 2, true);
  return buffer;
}
export function writePCM(
  view: DataView,
  start: number,
  samples: Float32Array,
  gain = 1,
) {
  if (44 + (start + samples.length) * 2 > view.byteLength)
    throw new Error('PCM overflow');
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i] * gain));
    view.setInt16(
      44 + (start + i) * 2,
      Math.round(sample * (sample < 0 ? 32768 : 32767)),
      true,
    );
  }
}
export function wavAttribution(): Uint8Array<ArrayBuffer> {
  const credits = new TextEncoder().encode(
    'Chordscape. Speech: VOICEVOX Nemo, female 1, locally synthesized and edited. https://voicevox.hiroshiba.jp/nemo/term/ . Piano: Salamander Grand Piano, Alexander Holm. Piano CC BY 3.0: https://creativecommons.org/licenses/by/3.0/ . Sources: https://github.com/Tonejs/audio/tree/master/salamander .\0',
  );
  const length = credits.length + (credits.length % 2);
  const result = new Uint8Array(20 + length);
  const view = new DataView(result.buffer);
  result.set(new TextEncoder().encode('LIST'), 0);
  view.setUint32(4, 12 + length, true);
  result.set(new TextEncoder().encode('INFOICMT'), 8);
  view.setUint32(16, credits.length, true);
  result.set(credits, 20);
  return result;
}
async function renderChord(
  notes: number[],
  seconds: number,
  samples: Map<number, AudioBuffer>,
): Promise<Float32Array> {
  const context = new OfflineAudioContext(
    1,
    Math.round(seconds * LISTEN_RATE),
    LISTEN_RATE,
  );
  const bus = context.createGain();
  bus.gain.value = 0.5;
  const filter = context.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 35;
  filter.Q.value = 0.5;
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -6;
  compressor.knee.value = 6;
  compressor.ratio.value = 20;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.1;
  bus.connect(filter);
  filter.connect(compressor);
  compressor.connect(context.destination);
  const voices = notes.map((note) =>
    createNoteVoice(context, bus, 'piano', note, 0, seconds, samples),
  );
  const rendered = await context.startRendering();
  voices.forEach((voice) => voice.dispose());
  bus.disconnect();
  filter.disconnect();
  compressor.disconnect();
  return rendered.getChannelData(0);
}
// Render one short chord at a time, with a bounded LRU cache. Never allocate a
// 20-minute floating-point AudioBuffer or thousands of simultaneous audio nodes.
export async function renderListen(
  settings: ListenSettings,
  signal: AbortSignal,
  progress: (value: number) => void,
): Promise<RenderedListen> {
  signal.throwIfAborted();
  const decoder = new OfflineAudioContext(1, 1, LISTEN_RATE);
  const load = async (path: string) => {
    const response = await fetch(`${import.meta.env.BASE_URL}${path}`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
    });
    if (!response.ok) throw new Error('Audio asset unavailable');
    const audio = await decoder.decodeAudioData(await response.arrayBuffer());
    signal.throwIfAborted();
    return audio;
  };
  const tokens = listenSpeechTokens(settings);
  const speech = new Map<SpeechToken, Float32Array>();
  const samples = new Map<number, AudioBuffer>();
  const count = tokens.size + PIANO_NOTES.length;
  let loaded = 0;
  // Sequential decode limits transient memory during loading on small devices.
  for (const note of PIANO_NOTES) {
    samples.set(note, await load(`samples/salamander/${pianoFile(note)}`));
    progress((++loaded / count) * 0.15);
  }
  for (const token of tokens) {
    const clip = await load(`speech/ja/${speechFile(token)}`);
    speech.set(token, clip.getChannelData(0));
    progress((++loaded / count) * 0.15);
  }
  const durations = Object.fromEntries(
    [...speech].map(([token, clip]) => [token, clip.length]),
  );
  const plan = buildListenPlan(settings, durations);
  if (!plan.cues.length) throw new Error('Empty listen plan');
  const buffer = wavHeader(plan.frames);
  const view = new DataView(buffer);
  const cache = new Map<string, Float32Array>();
  for (let i = 0; i < plan.cues.length; i++) {
    signal.throwIfAborted();
    const cue = plan.cues[i];
    for (const segment of cue.segments) {
      if (segment.kind === 'speech')
        writePCM(view, segment.start, speech.get(segment.token)!, 0.75);
      else {
        const key = cue.notes.join(',');
        let chord = cache.get(key);
        if (chord) cache.delete(key);
        else
          chord = await renderChord(cue.notes, settings.chordSeconds, samples);
        signal.throwIfAborted();
        cache.set(key, chord);
        if (cache.size > 12) cache.delete(cache.keys().next().value!);
        writePCM(view, segment.start, chord);
      }
    }
    progress(0.15 + (0.85 * (i + 1)) / plan.cues.length);
    if (i % 4 === 0) await yieldToUI();
  }
  signal.throwIfAborted();
  const attribution = wavAttribution();
  view.setUint32(4, buffer.byteLength - 8 + attribution.byteLength, true);
  const blob = new Blob([buffer, attribution], { type: 'audio/wav' });
  samples.clear();
  speech.clear();
  cache.clear();
  return { blob, plan };
}
