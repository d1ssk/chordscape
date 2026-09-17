import { expect, it } from 'vitest';
import { defaultKey, pc, tones, parsePitch } from '../music/harmony';
import { rootVoicing } from '../music/voicing';
import { spaceNodes, SPACE_TONICS } from './layout';
import { newSpaceContext, chooseSpaceChord } from './context';
import { generateSpaceVoicings, SPACE_RANGE } from './voicings';
import { selectSpaceVoicing, spaceMovementCost } from './voiceLeading';
const nodes = spaceNodes(defaultKey);
const node = (id: string) => nodes.find((n) => n.id === id)!;
const travel = (all: number[][]) =>
  all
    .slice(1)
    .reduce(
      (total, v, i) =>
        total +
        v.reduce((sum, n, voice) => sum + Math.abs(n - all[i][voice]), 0),
      0,
    );
it('reduces total semitone movement compared with fixed root position', () => {
  const sequence = ['c', 'g', 'am', 'f', 'dm', 'g', 'c'];
  let context = newSpaceContext();
  const smooth = sequence.map((id) => {
    context = chooseSpaceChord(context, id);
    return context.current!.notes;
  });
  const root = sequence.map((id) => rootVoicing(node(id).chord));
  expect(travel(smooth)).toBeLessThan(travel(root));
  expect(smooth[3].some((n) => smooth[2].includes(n))).toBe(true);
});
it('preserves chord tones and fixed slash bass with ordered, bounded voices across keys', () => {
  for (const tonic of SPACE_TONICS)
    for (const chord of spaceNodes({
      tonic: parsePitch(tonic),
      mode: 'major',
    })) {
      const options = generateSpaceVoicings(chord);
      expect(options.length).toBeGreaterThan(1);
      for (const notes of options) {
        expect(notes.map((n) => n % 12).sort()).toEqual(
          tones(chord.chord).map(pc).sort(),
        );
        expect(notes[0]).toBeGreaterThanOrEqual(SPACE_RANGE.low);
        expect(notes.at(-1)!).toBeLessThanOrEqual(SPACE_RANGE.high);
        expect(notes.at(-1)! - notes[0]).toBeLessThanOrEqual(
          SPACE_RANGE.maxSpan,
        );
        expect(notes.every((n, i) => !i || n > notes[i - 1])).toBe(true);
        if (chord.bass !== null)
          expect(notes[0] % 12).toBe(pc(tones(chord.chord)[chord.bass]));
      }
    }
  expect(spaceMovementCost([48, 52, 55], [55, 52, 60])).toBe(Infinity);
  expect(spaceMovementCost([48, 52, 55], [36, 52, 55])).toBe(Infinity);
});
it('uses score-weighted look-ahead without depending on it or changing the first chord', () => {
  const previous = [48, 52, 55];
  expect(selectSpaceVoicing(undefined, node('c'), [])).toEqual(previous);
  expect(selectSpaceVoicing(previous, node('g'), [])).toEqual(
    selectSpaceVoicing(
      previous,
      node('g'),
      [{ input: node('am'), score: 1 }],
      0,
    ),
  );
  // At least one genuinely different optimal placement proves that the next
  // candidates participate in selection rather than being ignored metadata.
  const changed = nodes.some((current) => {
    const baseline = selectSpaceVoicing([60, 64, 67], current, []);
    return nodes.some(
      (next) =>
        selectSpaceVoicing([60, 64, 67], current, [
          { input: next, score: 0.9 },
        ]).join() !== baseline.join(),
    );
  });
  expect(changed).toBe(true);
  expect(
    selectSpaceVoicing(previous, node('g'), [
      { input: node('am'), score: NaN },
    ]),
  ).toEqual(selectSpaceVoicing(previous, node('g'), []));
});
