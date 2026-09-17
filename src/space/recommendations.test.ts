import { describe, expect, it } from 'vitest';
import {
  chordSymbol,
  defaultKey,
  parsePitch,
  type Key,
} from '../music/harmony';
import { spaceNodes, SPACE_TONICS } from './layout';
import { getRecommendations, type SpaceStyle } from './recommendations';
const key = (name: string): Key => ({ tonic: parsePitch(name), mode: 'major' });
const recs = (
  history: string[],
  style: SpaceStyle = 'free',
  context = defaultKey,
) =>
  getRecommendations({
    key: context,
    style,
    history,
    availableChords: spaceNodes(context),
  });
const get = (history: string[], id: string, style: SpaceStyle = 'free') =>
  recs(history, style).find((r) => r.chordId === id)!;

describe('key-relative harmonic recommendations', () => {
  for (const [from, to] of [
    ['g-seventh', 'c'],
    ['e7', 'am'],
    ['a7', 'dm'],
    ['d7', 'g'],
    ['b7', 'em'],
    ['db7', 'c'],
    ['dsdim7', 'em'],
  ]) {
    it(`${from} resolves strongly to ${to}`, () => {
      expect(get([from], to)).toMatchObject({ type: 'resolve' });
      expect(get([from], to).score).toBeGreaterThan(0.7);
    });
  }
  it('recognizes ii7-V7-I, dominant chains and the minor plagal return using history', () => {
    expect(get(['dm-seventh', 'g-seventh'], 'c-seventh').score).toBeGreaterThan(
      get(['g-seventh'], 'c-seventh').score,
    );
    expect(get(['e7', 'a7', 'd7'], 'g-seventh').score).toBeGreaterThan(
      get(['d7'], 'g-seventh').score,
    );
    expect(get(['c', 'f', 'fm'], 'c').score).toBeGreaterThan(
      get(['fm'], 'c').score,
    );
    expect(get(['c', 'f', 'fm'], 'c').reasons).toContain('I-IV-iv-I');
  });
  for (const [history, target, pattern] of [
    [['dm', 'g'], 'c', 'ii-V-I'],
    [['f', 'g'], 'c', 'IV-V-I'],
    [['f', 'fm'], 'c', 'IV-iv-I'],
    [['em', 'am', 'dm'], 'g', 'iii-vi-ii-V-I'],
    [['em', 'am', 'dm', 'g'], 'c', 'iii-vi-ii-V-I'],
    [['c', 'am', 'f'], 'g', 'I-vi-IV-V'],
  ] as [string[], string, string][]) {
    it(`recognizes ${pattern} with triad families`, () =>
      expect(get(history, target).reasons).toContain(pattern));
  }
  it('changes rankings and seventh preference with style, while Free still guides', () => {
    const pop = recs(['c'], 'pop');
    const jazz = recs(['c'], 'jazz');
    expect(pop.map((r) => r.chordId)).not.toEqual(jazz.map((r) => r.chordId));
    expect(pop.map((r) => r.chordId)).toEqual(
      expect.arrayContaining(['am', 'f', 'fm', 'g']),
    );
    expect(
      get(['dm-seventh', 'g-seventh'], 'c-seventh', 'jazz').score,
    ).toBeGreaterThan(get(['dm-seventh', 'g-seventh'], 'c', 'jazz').score);
    expect(get(['db-f'], 'g', 'classical').reasons).toContain(
      'neapolitan-dominant',
    );
    expect(recs(['c'])).toHaveLength(6);
  });
  it('uses the same rules after transposition and spells F-sharp major naturally', () => {
    for (const tonic of SPACE_TONICS)
      expect(recs(['a7'], 'free', key(tonic))).toEqual(recs(['a7']));
    const nodes = spaceNodes(key('D'));
    expect(chordSymbol(nodes.find((n) => n.id === 'a7')!.chord)).toBe('B7');
    expect(chordSymbol(nodes.find((n) => n.id === 'dm')!.chord)).toBe('Em');
    expect(
      chordSymbol(spaceNodes(key('F♯')).find((n) => n.id === 'bdim')!.chord),
    ).toBe('E♯°');
  });
  it('returns bounded, distinct, inspectable candidates and no guide before the first chord', () => {
    expect(recs([])).toEqual([]);
    for (const style of ['free', 'pop', 'jazz', 'classical'] as const)
      for (const node of spaceNodes(defaultKey)) {
        const result = recs([node.id], style);
        expect(result.length).toBeGreaterThanOrEqual(4);
        expect(result.length).toBeLessThanOrEqual(7);
        expect(new Set(result.map((r) => r.chordId)).size).toBe(result.length);
        for (const candidate of result) {
          expect(candidate.score).toBeGreaterThan(0);
          expect(candidate.score).toBeLessThanOrEqual(1);
          expect(candidate.contributions.length).toBeGreaterThan(0);
          expect(candidate.chordId).not.toBe(node.id);
        }
      }
  });
});
