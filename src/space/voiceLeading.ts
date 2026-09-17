import { movementCost, rootVoicing, type VoicingInput } from '../music/voicing';
import { generateSpaceVoicings, SPACE_RANGE } from './voicings';

type Input = Pick<VoicingInput, 'chord' | 'bass'>;
export interface NextVoicing {
  input: Input;
  score: number;
}
export const LOOK_AHEAD_WEIGHT = 0.25;
export function spaceMovementCost(previous: number[], notes: number[]) {
  if (
    notes.some(
      (n, i) =>
        n < SPACE_RANGE.low ||
        n > SPACE_RANGE.high ||
        (i > 0 && n <= notes[i - 1]),
    )
  )
    return Infinity;
  const width = notes.at(-1)! - notes[0];
  // movementCost uses ordered edit-distance for unequal voice counts,
  // leap/bass penalties and a reward for retaining the very same MIDI note.
  return movementCost(previous, notes) + Math.max(0, width - 19) * 0.7;
}
export function selectSpaceVoicing(
  previous: number[] | undefined,
  current: Input,
  next: readonly NextVoicing[],
  lookAhead = LOOK_AHEAD_WEIGHT,
): number[] {
  if (!previous?.length) return rootVoicing(current.chord, current.bass ?? 0);
  const options = generateSpaceVoicings(current);
  // Bounded look-ahead: no graph search, and no claim to know the next click.
  const future = next
    .filter((n) => Number.isFinite(n.score) && n.score > 0)
    .slice(0, 3)
    .map((n) => ({ score: n.score, options: generateSpaceVoicings(n.input) }));
  const total = future.reduce((sum, n) => sum + n.score, 0);
  const cost = (notes: number[]) =>
    spaceMovementCost(previous, notes) +
    (total
      ? (Math.max(0, Math.min(0.4, lookAhead)) *
          future.reduce(
            (sum, n) =>
              sum +
              n.score *
                Math.min(...n.options.map((v) => spaceMovementCost(notes, v))),
            0,
          )) /
        total
      : 0);
  return options.reduce((best, notes) =>
    cost(notes) < cost(best) - 1e-9 ? notes : best,
  );
}
