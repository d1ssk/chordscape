import { candidates, rootVoicing, type VoicingInput } from '../music/voicing';
export const SPACE_RANGE = { low: 48, high: 84, maxSpan: 24 };
export function generateSpaceVoicings(
  input: Pick<VoicingInput, 'chord' | 'bass'>,
): number[][] {
  const options = candidates({ ...input, policy: 'smooth' })
    .flatMap((notes) => [notes, notes.map((n) => n + 12)])
    .filter(
      (notes) =>
        notes[0] >= SPACE_RANGE.low &&
        notes.at(-1)! <= SPACE_RANGE.high &&
        notes.at(-1)! - notes[0] <= SPACE_RANGE.maxSpan,
    );
  const unique = new Map(options.map((notes) => [notes.join(','), notes]));
  const result = [...unique.values()].sort(
    (a, b) => a[0] - b[0] || a.join(',').localeCompare(b.join(',')),
  );
  return result.length ? result : [rootVoicing(input.chord, input.bass ?? 0)];
}
