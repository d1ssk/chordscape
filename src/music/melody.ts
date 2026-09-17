import { pc, pitchName, parsePitch, scale, tones, type Pitch } from './harmony';
import { seededRandom } from './generation';
import type { ChordEvent } from '../state/session';

export interface MelodySettings {
  version: 1;
  enabled: boolean;
  density: number;
  min: number;
  max: number;
  activity: number;
  volume: number;
  holdMotif: boolean;
  seed: number;
  motifSeed: number;
  timing: 'immediate' | 'nextBeat';
}
export interface MelodyNote {
  beat: number;
  duration: number;
  midi: number | null;
  pitch: Pitch | null;
  kind: 'chord' | 'scale' | 'chromatic' | 'rest';
  ornament: 'passing' | 'approach' | null;
}
export const defaultMelody = (): MelodySettings => ({
  version: 1,
  enabled: false,
  density: 0.55,
  min: 60,
  max: 84,
  activity: 0.35,
  volume: 0.65,
  holdMotif: true,
  seed: 42,
  motifSeed: 42,
  timing: 'immediate',
});
export function isMelodySettings(value: unknown): value is MelodySettings {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  return (
    s.version === 1 &&
    typeof s.enabled === 'boolean' &&
    typeof s.holdMotif === 'boolean' &&
    ['density', 'activity', 'volume'].every(
      (k) =>
        typeof s[k] === 'number' &&
        Number.isFinite(s[k]) &&
        s[k] >= 0 &&
        s[k] <= 1,
    ) &&
    ['min', 'max'].every(
      (k) =>
        Number.isInteger(s[k]) &&
        (s[k] as number) >= 48 &&
        (s[k] as number) <= 96,
    ) &&
    (s.max as number) - (s.min as number) >= 12 &&
    ['seed', 'motifSeed'].every(
      (k) =>
        Number.isInteger(s[k]) &&
        (s[k] as number) >= 0 &&
        (s[k] as number) <= 0xffffffff,
    ) &&
    ['immediate', 'nextBeat'].includes(String(s.timing))
  );
}
export function melodyPitch(midi: number, event: ChordEvent): Pitch {
  return (
    [...tones(event.chord), ...scale(event.key)].find(
      (p) => pc(p) === midi % 12,
    ) ??
    parsePitch(
      ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'][
        midi % 12
      ],
    )
  );
}
export function melodyKind(
  midi: number | null,
  event: ChordEvent,
): MelodyNote['kind'] {
  if (midi === null) return 'rest';
  if (tones(event.chord).some((p) => pc(p) === midi % 12)) return 'chord';
  return scale(event.key).some((p) => pc(p) === midi % 12)
    ? 'scale'
    : 'chromatic';
}
export function melodyName(note: MelodyNote) {
  if (note.midi === null || !note.pitch) return '';
  const natural = pc({ ...note.pitch, accidental: 0 });
  return `${pitchName(note.pitch)}${Math.floor((note.midi - note.pitch.accidental - natural) / 12) - 1}`;
}
export interface MotifStep {
  beat: number;
  duration: number;
  contour: number;
  rest: boolean;
}
export function makeMotif(settings: MelodySettings): MotifStep[] {
  const random = seededRandom(settings.motifSeed);
  const step = settings.density < 0.34 ? 2 : settings.density < 0.7 ? 1 : 0.5;
  const length = random() < 0.5 ? 4 : 8;
  let contour = 0;
  return Array.from({ length: length / step }, (_, i) => {
    if (i)
      contour = Math.max(-3, Math.min(3, contour + (random() < 0.5 ? -1 : 1)));
    return {
      beat: i * step,
      duration: step,
      contour,
      rest: i > 0 && random() > 0.72 + settings.density * 0.22,
    };
  });
}
// Labels describe the realized neighboring notes, including rests and timing.
export function analyzeMelody(
  events: ChordEvent[],
  live = false,
): ChordEvent[] {
  let start = 0;
  const flat = events.flatMap((event) => {
    const notes = (event.melody ?? []).map((note) => ({
      event,
      note: {
        ...note,
        pitch: note.midi === null ? null : melodyPitch(note.midi, event),
        kind: melodyKind(note.midi, event),
        ornament: null as MelodyNote['ornament'],
      },
      start: start + note.beat,
    }));
    start += event.duration;
    return notes;
  });
  for (let i = 0; i < flat.length; i++) {
    const current = flat[i],
      previous = flat[i - 1],
      next = flat[i + 1];
    if (
      current.note.midi === null ||
      current.note.kind === 'chord' ||
      !next ||
      next.note.midi === null
    )
      continue;
    const contiguous =
      Math.abs(current.start + current.note.duration - next.start) < 1e-7;
    const after = next.note.midi - current.note.midi;
    if (
      contiguous &&
      Math.abs(after) > 0 &&
      Math.abs(after) <= 2 &&
      next.note.kind === 'chord'
    ) {
      if (
        previous?.note.midi != null &&
        previous.note.kind === 'chord' &&
        Math.abs(previous.start + previous.note.duration - current.start) < 1e-7
      ) {
        const before = current.note.midi - previous.note.midi;
        if (Math.abs(before) <= 2 && before * after > 0)
          current.note.ornament = 'passing';
      }
      if (!live && !current.note.ornament && current.event.id !== next.event.id)
        current.note.ornament = 'approach';
    }
  }
  let cursor = 0;
  return events.map((event) => ({
    ...event,
    melody: (event.melody ?? []).map(() => flat[cursor++].note),
  }));
}
export function generateMelody(
  events: ChordEvent[],
  settings: MelodySettings,
  live = false,
  previousMidi?: number,
): ChordEvent[] {
  const random = seededRandom(settings.seed);
  const motif = makeMotif(settings);
  const motifLength = motif.at(-1)!.beat + motif.at(-1)!.duration;
  const step = motif[0].duration;
  let absolute = 0,
    previous = previousMidi,
    lastMove = 0;
  const generated = events.map((event) => {
    const melody: MelodyNote[] = [];
    const chordPcs = tones(event.chord).map(pc),
      scalePcs = scale(event.key).map(pc);
    const low = Math.min(
      settings.max,
      Math.max(settings.min, Math.max(...event.notes) + 1),
    );
    const all = Array.from(
      { length: settings.max - settings.min + 1 },
      (_, i) => i + settings.min,
    );
    const chordNotes = all.filter((n) => chordPcs.includes(n % 12));
    const anchor =
      previous ??
      chordNotes.find((n) => n >= Math.max(low, 72)) ??
      chordNotes.at(-1)!;
    for (let beat = 0; beat < event.duration - 1e-9;) {
      const position = absolute + beat;
      const pattern =
        motif[Math.floor((position % motifLength) / step) % motif.length];
      const remainder = position % step;
      const duration = Math.min(
        remainder < 1e-7 || step - remainder < 1e-7 ? step : step - remainder,
        event.duration - beat,
      );
      const strong = beat === 0 || Math.abs(position % 2) < 1e-7;
      let midi: number | null = null;
      if (strong || !pattern.rest) {
        const chordOnly = strong || random() < 0.6;
        let pool = all.filter(
          (n) =>
            chordPcs.includes(n % 12) ||
            (!chordOnly && scalePcs.includes(n % 12)),
        );
        const above = pool.filter((n) => n >= low);
        if (above.length) pool = above;
        const variation = settings.holdMotif
          ? 1
          : Math.floor(position / motifLength) % 2
            ? -1
            : 1;
        const desired = Math.max(
          settings.min,
          Math.min(settings.max, anchor + pattern.contour * 2 * variation),
        );
        const leap = !strong && random() < settings.activity * 0.18;
        const jitter = new Map(pool.map((n) => [n, random() * 1.8]));
        const score = (n: number) => {
          const distance = previous === undefined ? 0 : Math.abs(n - previous);
          const recovery =
            previous !== undefined &&
            Math.abs(lastMove) > 4 &&
            (n - previous) * lastMove >= 0
              ? 12
              : 0;
          return (
            Math.abs(n - desired) * 0.9 +
            distance * (leap ? 0.05 : 0.7) +
            recovery +
            jitter.get(n)!
          );
        };
        pool.sort((a, b) => score(a) - score(b) || a - b);
        midi = pool[0];
        lastMove = previous === undefined ? 0 : midi - previous;
        previous = midi;
      }
      melody.push({
        beat,
        duration,
        midi,
        pitch: midi === null ? null : melodyPitch(midi, event),
        kind: melodyKind(midi, event),
        ornament: null,
      });
      beat += duration;
    }
    absolute += event.duration;
    return { ...event, melody };
  });
  if (!live)
    for (let i = 0; i < generated.length - 1; i++) {
      const event = generated[i],
        last = event.melody.at(-1)!,
        next = generated[i + 1].melody[0];
      if (
        event.melody.length < 2 ||
        !next ||
        next.midi === null ||
        random() >= 0.3 + settings.activity * 0.6
      )
        continue;
      // A weak final slot can approach the actual, already generated next tone.
      const start = generated.slice(0, i).reduce((n, e) => n + e.duration, 0);
      if (Math.abs((start + last.beat) % 2) < 1e-7) continue;
      const candidate = next.midi - 1;
      if (candidate >= settings.min && candidate <= settings.max)
        last.midi = candidate;
    }
  return analyzeMelody(generated, live);
}

// Capture the exact repeated live phrase over an applied interval, clipping
// an interrupted note instead of regenerating a different retrospective line.
export function captureMelody(
  template: MelodyNote[],
  period: number,
  offset: number,
  duration: number,
): MelodyNote[] {
  const result: MelodyNote[] = [];
  for (
    let cycle = Math.floor(offset / period);
    cycle * period < offset + duration;
    cycle++
  )
    for (const note of template) {
      const start = cycle * period + note.beat,
        end = start + note.duration;
      const left = Math.max(offset, start),
        right = Math.min(offset + duration, end);
      if (right > left + 1e-9)
        result.push({
          ...note,
          beat: left - offset,
          duration: right - left,
          ornament: null,
        });
    }
  return result;
}
