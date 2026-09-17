import {
  defaultKey,
  diatonic,
  parsePitch,
  QUALITIES,
  tones,
  type Harmony,
  type Key,
  type Pitch,
  type Quality,
} from '../music/harmony';
import { seededRandom } from '../music/generation';
import { rootVoicing } from '../music/voicing';
import { chordTokens, keyTokens, type SpeechToken } from './speech';
export const LISTEN_RATE = 22050;
export type ListenMode = 'fixed' | 'key' | 'random' | 'ambient';
export interface ListenSettings {
  version: 1;
  mode: ListenMode;
  root: Pitch;
  key: Key;
  qualities: Quality[];
  seventh: boolean;
  inversions: boolean;
  order: 'nameFirst' | 'soundFirst';
  chordSeconds: number;
  gapSeconds: number;
  minutes: 5 | 10 | 20;
  seed: number;
}
export function defaultListen(
  root: Pitch = defaultKey.tonic,
  key: Key = defaultKey,
): ListenSettings {
  return {
    version: 1,
    mode: 'fixed',
    root,
    key,
    qualities: ['major', 'minor', '7', 'maj7', 'm7'],
    seventh: false,
    inversions: false,
    order: 'nameFirst',
    chordSeconds: 3,
    gapSeconds: 1,
    minutes: 20,
    seed: 42,
  };
}
function validPitch(value: unknown): value is Pitch {
  if (!value || typeof value !== 'object') return false;
  const p = value as Pitch;
  return (
    /^[A-G]$/.test(p.letter) &&
    Number.isInteger(p.accidental) &&
    Math.abs(p.accidental) <= 2
  );
}
export function isListenSettings(value: unknown): value is ListenSettings {
  if (!value || typeof value !== 'object') return false;
  const s = value as ListenSettings;
  return (
    s.version === 1 &&
    ['fixed', 'key', 'random', 'ambient'].includes(s.mode) &&
    validPitch(s.root) &&
    !!s.key &&
    validPitch(s.key.tonic) &&
    ['major', 'minor'].includes(s.key.mode) &&
    Array.isArray(s.qualities) &&
    s.qualities.length > 0 &&
    s.qualities.length <= 17 &&
    s.qualities.every((q) => Object.hasOwn(QUALITIES, q)) &&
    new Set(s.qualities).size === s.qualities.length &&
    typeof s.seventh === 'boolean' &&
    typeof s.inversions === 'boolean' &&
    ['nameFirst', 'soundFirst'].includes(s.order) &&
    [2, 3, 4, 6].includes(s.chordSeconds) &&
    [0.5, 1, 2, 3].includes(s.gapSeconds) &&
    [5, 10, 20].includes(s.minutes) &&
    Number.isInteger(s.seed) &&
    s.seed >= 0 &&
    s.seed <= 0xffffffff
  );
}
export interface ListenItem {
  chord: Harmony;
  key: Key;
  notes: number[];
  reference: boolean;
  speech: SpeechToken[];
}
// Twelve equally likely pitch classes; enharmonic spellings aren't extra tickets.
const RANDOM_ROOTS = [
  'C',
  'D♭',
  'D',
  'E♭',
  'E',
  'F',
  'F♯',
  'G',
  'A♭',
  'A',
  'B♭',
  'B',
].map(parsePitch);
// Enumerate the selected pool, never the entire bundled vocabulary or a random
// sample. This bounds download/decode memory while covering every possible cue.
export function listenSpeechTokens(settings: ListenSettings): Set<SpeechToken> {
  if (!isListenSettings(settings)) throw new Error('Invalid listen settings');
  const result = new Set<SpeechToken>();
  if (settings.mode === 'ambient') return result;
  const chords: Harmony[] =
    settings.mode === 'key'
      ? diatonic(settings.key, settings.seventh)
      : (settings.mode === 'fixed' ? [settings.root] : RANDOM_ROOTS).flatMap(
          (root) => settings.qualities.map((quality) => ({ root, quality })),
        );
  if (settings.mode === 'key')
    for (const token of keyTokens(settings.key)) result.add(token);
  for (const chord of chords)
    for (
      let inversion = 0;
      inversion < (settings.inversions ? tones(chord).length : 1);
      inversion++
    )
      for (const token of chordTokens(
        chord,
        settings.key,
        settings.mode === 'key',
        settings.inversions ? inversion : null,
      ))
        result.add(token);
  return result;
}
export function* listenItems(
  settings: ListenSettings,
): Generator<ListenItem, never, unknown> {
  if (!isListenSettings(settings)) throw new Error('Invalid listen settings');
  const random = seededRandom(settings.seed);
  const chords = diatonic(settings.key, settings.seventh);
  for (let i = 0; ; i++) {
    if (settings.mode === 'key' && i % 12 === 0) {
      const chord = diatonic(settings.key)[0];
      yield {
        chord,
        key: settings.key,
        notes: rootVoicing(chord),
        reference: true,
        speech: keyTokens(settings.key),
      };
    }
    const chord: Harmony =
      settings.mode === 'key' || settings.mode === 'ambient'
        ? chords[Math.floor(random() * chords.length)]
        : {
            root:
              settings.mode === 'fixed'
                ? settings.root
                : RANDOM_ROOTS[Math.floor(random() * 12)],
            quality:
              settings.qualities[
                Math.floor(random() * settings.qualities.length)
              ],
          };
    const inversion = settings.inversions
      ? Math.floor(random() * tones(chord).length)
      : 0;
    yield {
      chord,
      key: settings.key,
      notes: rootVoicing(chord, inversion),
      reference: false,
      speech:
        settings.mode === 'ambient'
          ? []
          : chordTokens(
              chord,
              settings.key,
              settings.mode === 'key',
              settings.inversions ? inversion : null,
            ),
    };
  }
}
export type ListenSegment =
  | { kind: 'speech'; token: SpeechToken; start: number; end: number }
  | { kind: 'chord'; start: number; end: number };
export interface ListenCue extends ListenItem {
  start: number;
  end: number;
  reveal: number;
  segments: ListenSegment[];
}
export interface ListenPlan {
  settings: ListenSettings;
  frames: number;
  cues: ListenCue[];
}
export function buildListenPlan(
  settings: ListenSettings,
  durations: Partial<Record<SpeechToken, number>>,
): ListenPlan {
  const frames = settings.minutes * 60 * LISTEN_RATE;
  const cues: ListenCue[] = [];
  let cursor = 0;
  const gap = Math.round(settings.gapSeconds * LISTEN_RATE);
  const chordFrames = Math.round(settings.chordSeconds * LISTEN_RATE);
  for (const item of listenItems(settings)) {
    const start = cursor;
    const segments: ListenSegment[] = [];
    let reveal = start;
    const speech = () => {
      reveal = cursor;
      for (const token of item.speech) {
        const length = durations[token];
        if (
          !length ||
          !Number.isInteger(length) ||
          length < 1 ||
          length > LISTEN_RATE * 15
        )
          throw new Error('Missing speech audio');
        segments.push({
          kind: 'speech',
          token,
          start: cursor,
          end: cursor + length,
        });
        cursor += length + Math.round(0.06 * LISTEN_RATE);
      }
    };
    const chord = () => {
      segments.push({
        kind: 'chord',
        start: cursor,
        end: cursor + chordFrames,
      });
      cursor += chordFrames;
    };
    if (!item.speech.length) chord();
    else if (settings.order === 'nameFirst' || item.reference) {
      speech();
      cursor += gap;
      chord();
    } else {
      chord();
      cursor += gap;
      speech();
      cursor += gap;
      chord();
    }
    cursor += gap;
    // Never cut a spoken name or sounding chord at the repeat boundary.
    if (cursor > frames) break;
    cues.push({ ...item, start, end: cursor, reveal, segments });
  }
  return { settings: structuredClone(settings), frames, cues };
}
export function cueAt(
  plan: ListenPlan,
  seconds: number,
): ListenCue | undefined {
  const frame = Math.round(seconds * LISTEN_RATE);
  // Native media time is authoritative, including seeks and looping.
  return plan.cues.find((cue) => cue.start <= frame && frame < cue.end);
}
