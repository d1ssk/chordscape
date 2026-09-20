import { expect, it } from 'vitest';
import { defaultKey } from '../music/harmony';
import type { PreviewCandidate } from './modelPreview';
import { spaceNodes } from './layout';
import { classifyModelCandidates } from './modelCandidateTypes';

const availableChords = spaceNodes(defaultKey);
const candidate = (ids: string[], rank = 1): PreviewCandidate => ({
  ids,
  rank,
  probability: 0.2,
});
const classify = (history: string[], candidates: PreviewCandidate[]) =>
  classifyModelCandidates({
    key: defaultKey,
    style: 'free',
    history,
    availableChords,
    candidates,
  });

it('labels arbitrary model candidates with resolution, continuation, tension and color', () => {
  expect(classify(['g-seventh'], [candidate(['c'])]).get('c')).toBe('resolve');
  expect(classify(['c'], [candidate(['f'])]).get('f')).toBe('continue');
  expect(classify(['c'], [candidate(['d7'])]).get('d7')).toBe('tension');
  expect(classify(['c'], [candidate(['fm'])]).get('fm')).toBe('color');
  expect(classify([], [candidate(['f'])]).get('f')).toBe('explore');
});

it('keeps one type for bass variants without changing model rank or probability', () => {
  const candidates = [candidate(['db', 'db-f']), candidate(['c'], 2)];
  const before = structuredClone(candidates);
  const types = classify(['c'], candidates);
  expect(types.get('db')).toBe(types.get('db-f'));
  expect(candidates).toEqual(before);
});
