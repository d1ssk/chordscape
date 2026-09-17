import { type Harmony, tones, pc, inversionOf } from './harmony';
export type VoicingPolicy = 'manual' | 'root' | 'smooth';
export interface VoicingInput {
  chord: Harmony;
  bass: number | null;
  policy: VoicingPolicy;
  notes?: number[];
}
export const EDITED_RANGE = { low: 36, high: 96 };
export function canShiftOctave(notes: number[], octaves: number) {
  return notes.every(
    (n) =>
      n + octaves * 12 >= EDITED_RANGE.low &&
      n + octaves * 12 <= EDITED_RANGE.high,
  );
}
export function manualInversion(
  input: VoicingInput & { notes: number[] },
  bass: number | null,
) {
  const previousRoot = rootVoicing(
    input.chord,
    inversionOf(input.chord, input.notes),
  );
  const shift = input.notes[0] - previousRoot[0];
  let notes = rootVoicing(input.chord, bass ?? 0).map((n) => n + shift);
  while (notes[0] < EDITED_RANGE.low) notes = notes.map((n) => n + 12);
  while (notes.at(-1)! > EDITED_RANGE.high) notes = notes.map((n) => n - 12);
  return notes;
}
export function rootVoicing(chord: Harmony, inversion = 0) {
  const pitches = tones(chord).map(pc);
  const rotated = [...pitches.slice(inversion), ...pitches.slice(0, inversion)];
  let last = 47;
  return rotated.map((pitch) => {
    let note = 48 + pitch;
    while (note <= last) note += 12;
    last = note;
    return note;
  });
}
export function candidates(input: VoicingInput): number[][] {
  if (input.policy === 'manual' && input.notes) return [[...input.notes]];
  if (input.policy !== 'smooth')
    return [rootVoicing(input.chord, input.bass ?? 0)];
  const result: number[][] = [];
  for (let inversion = 0; inversion < tones(input.chord).length; inversion++) {
    if (input.bass !== null && inversion !== input.bass) continue;
    const base = rootVoicing(input.chord, inversion);
    for (const shift of [-12, 0, 12]) {
      const notes = base.map((n) => n + shift);
      if (notes[0] < 36 || notes[0] > 60 || notes.at(-1)! > 76) continue;
      result.push(notes);
      const open = [...notes.slice(0, -1), notes.at(-1)! + 12];
      if (open.at(-1)! <= 76) result.push(open);
    }
  }
  return result.sort((a, b) => a.join(',').localeCompare(b.join(',')));
}
// Ordered edit-distance: unmatched voices have an insertion/deletion cost.
export function voiceDistance(from: number[], to: number[]) {
  const costs = Array.from({ length: from.length + 1 }, () =>
    Array<number>(to.length + 1).fill(0),
  );
  for (let i = 0; i <= from.length; i++) costs[i][0] = i * 7;
  for (let j = 0; j <= to.length; j++) costs[0][j] = j * 7;
  for (let i = 1; i <= from.length; i++)
    for (let j = 1; j <= to.length; j++) {
      const distance = Math.abs(from[i - 1] - to[j - 1]);
      costs[i][j] = Math.min(
        costs[i - 1][j] + 7,
        costs[i][j - 1] + 7,
        costs[i - 1][j - 1] +
          distance +
          Math.max(0, distance - 7) * 0.7 -
          (distance === 0 ? 2 : 0),
      );
    }
  return costs[from.length][to.length];
}
function registerCost(notes: number[]) {
  return (
    Math.max(0, 48 - notes[0]) * 0.6 +
    Math.max(0, notes.at(-1)! - 72) +
    (notes[1] < 48 && notes[1] - notes[0] < 5 ? 8 : 0)
  );
}
export function movementCost(from: number[], to: number[]) {
  return (
    voiceDistance(from, to) +
    Math.abs(from[0] - to[0]) * 0.35 +
    registerCost(to)
  );
}
export function chooseVoicing(input: VoicingInput, previous?: number[]) {
  if (input.policy === 'manual' && input.notes) return [...input.notes];
  if (!previous || input.policy !== 'smooth')
    return rootVoicing(input.chord, input.bass ?? 0);
  return candidates(input).reduce((best, next) =>
    movementCost(previous, next) < movementCost(previous, best) ? next : best,
  );
}
// First auto chord anchors the phrase in root position. Fixed bass always wins.
export function optimizeVoicings(
  inputs: VoicingInput[],
  loop: boolean,
): number[][] {
  if (!inputs.length) return [];
  const options = inputs.map((input, index) =>
    index === 0 && input.policy !== 'manual'
      ? [rootVoicing(input.chord, input.bass ?? 0)]
      : candidates(input),
  );
  const costs: number[][] = [[0]];
  const parents: number[][] = [[0]];
  for (let i = 1; i < options.length; i++) {
    parents[i] = [];
    costs[i] = options[i].map((notes, j) => {
      let best = Infinity;
      let parent = 0;
      options[i - 1].forEach((previous, k) => {
        const score = costs[i - 1][k] + movementCost(previous, notes);
        if (score < best) {
          best = score;
          parent = k;
        }
      });
      parents[i][j] = parent;
      return best;
    });
  }
  const last = options.length - 1;
  let selected = 0;
  let best = Infinity;
  options[last].forEach((notes, i) => {
    const score =
      costs[last][i] + (loop ? movementCost(notes, options[0][0]) : 0);
    if (score < best) {
      best = score;
      selected = i;
    }
  });
  const result: number[][] = [];
  for (let i = last; i >= 0; i--) {
    result.unshift(options[i][selected]);
    selected = parents[i][selected];
  }
  return result;
}
export function voicingFacts(
  chord: Harmony,
  notes: number[],
  previous?: number[],
) {
  return {
    inversion: inversionOf(chord, notes),
    bass: Math.min(...notes),
    common: previous ? notes.filter((n) => previous.includes(n)) : [],
  };
}
