import { expect, it } from 'vitest';
import { parsePitch } from '../music/harmony';
import {
  newSpaceContext,
  chooseSpaceChord,
  changeSpaceKey,
  changeSpaceStyle,
  historyAge,
} from './context';
it('style preserves history and current sound; key clears all harmonic and voicing state', () => {
  const selected = chooseSpaceChord(
    chooseSpaceChord(newSpaceContext(), 'c'),
    'f',
  );
  const styled = changeSpaceStyle(selected, 'jazz');
  expect(styled.current).toBe(selected.current);
  expect(styled.history).toBe(selected.history);
  expect(styled.recommendations).not.toEqual(selected.recommendations);
  const changed = changeSpaceKey(styled, {
    tonic: parsePitch('D'),
    mode: 'major',
  });
  expect(changed).toMatchObject({
    history: [],
    current: null,
    recommendations: [],
    style: 'jazz',
  });
  expect(chooseSpaceChord(changed, 'c').current?.notes).toEqual([50, 54, 57]);
});
it('uses the newest visit for grayscale history and drops old visual history', () => {
  const history = ['dm', 'c', 'f', 'g', 'am', 'c', 'fm'];
  expect(historyAge(history, 'c')).toBe(1);
  expect(historyAge(history, 'fm')).toBe(0);
  expect(historyAge(history, 'dm')).toBeUndefined();
  expect(historyAge(history, 'e7')).toBeUndefined();
  let state = newSpaceContext();
  for (let i = 0; i < 16; i++)
    state = chooseSpaceChord(state, i % 2 ? 'g' : 'c');
  expect(state.history).toHaveLength(12);
});
it('history and recommendation coexist on the tonic after I-IV-iv', () => {
  const state = ['c', 'f', 'fm'].reduce(chooseSpaceChord, newSpaceContext());
  expect(historyAge(state.history, 'c')).toBe(2);
  expect(state.recommendations.find((r) => r.chordId === 'c')).toMatchObject({
    type: 'resolve',
  });
});
