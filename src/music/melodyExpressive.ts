import { pc, tones, scale } from './harmony';
import { seededRandom } from './generation';
import {
  analyzeMelody,
  melodyKind,
  melodyPitch,
  type MelodySettings,
  type MotifStep,
  type MelodyNote,
} from './melody';
import type { ChordEvent } from '../state/session';

// Two-bar motifs mix long and short values on a half-beat grid. Every cell
// ends at a strong beat, keeping harmony changes and partial live beats safe.
export function makeExpressiveMotif(settings: MelodySettings): MotifStep[] {
  const random = seededRandom(settings.motifSeed);
  const cells =
    settings.density < 0.34
      ? [[2], [1.5, 0.5], [1, 1]]
      : settings.density < 0.7
        ? [
            [1, 0.5, 0.5],
            [0.5, 0.5, 1],
            [1.5, 0.5],
            [1, 1],
          ]
        : [
            [0.5, 0.5, 0.5, 0.5],
            [0.5, 1, 0.5],
            [1, 0.5, 0.5],
          ];
  const motif: MotifStep[] = [];
  const direction = random() < 0.5 ? 1 : -1;
  let beat = 0;
  for (let cell = 0; cell < 4; cell++) {
    // The response lengthens its last tone instead of repeating the opening.
    const rhythm =
      cell === 3 ? [0.5, 0.5, 1] : cells[Math.floor(random() * cells.length)];
    for (const duration of rhythm) {
      const arc = beat < 4 ? beat / 2 : (8 - beat) / 2;
      const inflection = motif.length === 0 ? 0 : Math.floor(random() * 3) - 1;
      motif.push({
        beat,
        duration,
        contour: direction * (arc + inflection),
        rest: beat % 2 !== 0 && random() < 0.2 - settings.density * 0.12,
      });
      beat += duration;
    }
  }
  return motif;
}

export function generateExpressiveMelody(
  events: ChordEvent[],
  settings: MelodySettings,
  live: boolean,
  previousMidi?: number,
): ChordEvent[] {
  const random = seededRandom(settings.seed);
  const motif = makeExpressiveMotif(settings);
  const motifLength = 8;
  const all = Array.from(
    { length: settings.max - settings.min + 1 },
    (_, i) => settings.min + i,
  );
  // A stable register avoids ratcheting the anchor upward at every chord.
  const center = (settings.min + settings.max) / 2;
  let absolute = 0;
  let previous = previousMidi;
  let lastMove = 0;
  let repeats = 0;
  const generated = events.map((event) => {
    const melody: MelodyNote[] = [];
    const chordPcs = tones(event.chord).map(pc);
    const scalePcs = scale(event.key).map(pc);
    const accompanimentTop = Math.max(...event.notes);
    for (let beat = 0; beat < event.duration - 1e-9;) {
      const position = absolute + beat;
      const rawPhase = position % motifLength;
      const nearest = Math.round(rawPhase * 2) / 2;
      const phase =
        Math.abs(rawPhase - nearest) < 1e-7 ? nearest % motifLength : rawPhase;
      const pattern =
        motif.find((step) => phase < step.beat + step.duration - 1e-9) ??
        motif[0];
      const duration = Math.min(
        pattern.beat + pattern.duration - phase,
        event.duration - beat,
      );
      const strong = beat === 0 || Math.abs(position % 2) < 1e-7;
      let midi: number | null = null;
      if (strong || !pattern.rest) {
        const chordOnly = strong || random() < 0.3;
        const pool = all.filter(
          (n) =>
            chordPcs.includes(n % 12) ||
            (!chordOnly && scalePcs.includes(n % 12)),
        );
        const cycle = Math.floor(position / motifLength);
        const variation = settings.holdMotif ? 1 : cycle % 2 ? -1 : 1;
        const desired = Math.max(
          settings.min,
          Math.min(
            settings.max,
            center +
              pattern.contour * (1.5 + settings.activity * 2.5) * variation,
          ),
        );
        const jitter = new Map(pool.map((n) => [n, random() * 1.2]));
        const score = (n: number) => {
          const move = previous === undefined ? 0 : n - previous;
          const distance = Math.abs(move);
          const repeated = previous === n ? 2.5 + repeats * 3 : 0;
          const recovery =
            Math.abs(lastMove) > 4 && move * lastMove > 0 ? 5 : 0;
          return (
            Math.abs(n - desired) * 0.85 +
            distance * (0.45 - settings.activity * 0.25) +
            Math.max(0, distance - 7) * 2 +
            repeated +
            recovery +
            Math.max(0, accompanimentTop + 1 - n) * 0.15 +
            jitter.get(n)!
          );
        };
        pool.sort((a, b) => score(a) - score(b) || a - b);
        midi = pool[0];
        repeats = midi === previous ? repeats + 1 : 0;
        lastMove = previous === undefined ? 0 : midi - previous;
        previous = midi;
      } else {
        repeats = 0;
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
  // Only short, already sounded weak notes can lead into the actual next
  // chord tone. Keep rests as breaths and choose the nearer approach direction.
  if (!live) {
    let start = 0;
    for (let i = 0; i < generated.length - 1; i++) {
      const event = generated[i];
      const last = event.melody.at(-1)!;
      const next = generated[i + 1].melody[0];
      if (
        event.melody.length > 1 &&
        last.midi !== null &&
        next?.midi != null &&
        last.duration <= 1 &&
        Math.abs((start + last.beat) % 2) > 1e-7 &&
        random() < 0.25 + settings.activity * 0.4
      ) {
        const candidates = [next.midi - 1, next.midi + 1].filter(
          (n) => n >= settings.min && n <= settings.max,
        );
        candidates.sort(
          (a, b) => Math.abs(a - last.midi!) - Math.abs(b - last.midi!),
        );
        if (candidates.length) last.midi = candidates[0];
      }
      start += event.duration;
    }
  }
  return analyzeMelody(generated, live);
}
