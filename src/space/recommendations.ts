import {
  analyze,
  mod,
  pc,
  tones,
  type Analysis,
  type Key,
} from '../music/harmony';
import type { SpaceNode } from './layout';

export const SPACE_STYLES = ['free', 'pop', 'jazz', 'classical'] as const;
export type SpaceStyle = (typeof SPACE_STYLES)[number];
export const RECOMMENDATION_TYPES = [
  'resolve',
  'continue',
  'color',
  'explore',
] as const;
export type RecommendationType = (typeof RECOMMENDATION_TYPES)[number];
type Source = 'base' | 'style' | 'context' | 'recency';
export interface Contribution {
  rule: string;
  source: Source;
  value: number;
}
export interface Recommendation {
  chordId: string;
  type: RecommendationType;
  score: number;
  reasons: string[];
  contributions: Contribution[];
}
interface Role {
  node: SpaceNode;
  analysis: Analysis;
  offset: number;
  pitches: number[];
}
const role = (node: SpaceNode, key: Key): Role => ({
  node,
  analysis: analyze(node.chord, key),
  offset: mod(pc(node.chord.root) - pc(key.tonic)),
  pitches: tones(node.chord).map(pc),
});
const degree = (r: Role, n: number) =>
  r.analysis.kind === 'diatonic' && r.analysis.degree === n;
const minorFourth = (r: Role) =>
  r.offset === 5 && ['minor', 'm7'].includes(r.node.chord.quality);
const dominant = (r: Role) => r.node.chord.quality === '7';
const stable = (r: Role) =>
  ['major', 'minor', 'maj7', 'm7'].includes(r.node.chord.quality);
const secondary = (r: Role, target: number) =>
  r.analysis.kind === 'secondary' && r.analysis.appliedTo === target;
type Match = (r: Role) => boolean;
const d =
  (n: number): Match =>
  (r) =>
    degree(r, n);
const applied =
  (n: number): Match =>
  (r) =>
    secondary(r, n);
const patterns: { id: string; steps: Match[] }[] = [
  { id: 'ii-V-I', steps: [d(1), d(4), d(0)] },
  { id: 'IV-V-I', steps: [d(3), d(4), d(0)] },
  { id: 'IV-iv-I', steps: [d(3), minorFourth, d(0)] },
  { id: 'I-IV-iv-I', steps: [d(0), d(3), minorFourth, d(0)] },
  { id: 'iii-vi-ii-V-I', steps: [d(2), d(5), d(1), d(4), d(0)] },
  { id: 'I-vi-IV-V', steps: [d(0), d(5), d(3), d(4)] },
  {
    id: 'dominant-chain',
    steps: [applied(5), applied(1), applied(4), d(4), d(0)],
  },
];
const transitions: [number, number, number][] = [
  [0, 5, 0.6],
  [0, 3, 0.6],
  [0, 4, 0.56],
  [0, 1, 0.48],
  [0, 2, 0.4],
  [1, 4, 0.72],
  [2, 5, 0.68],
  [3, 4, 0.68],
  [4, 5, 0.53],
  [5, 1, 0.65],
  [5, 3, 0.58],
];
const profiles = {
  free: {
    resolution: 0.02,
    secondary: 0.01,
    mixture: 0.02,
    fifths: 0,
    chromatic: 0,
    seventh: -0.03,
  },
  pop: {
    resolution: 0.03,
    secondary: -0.08,
    mixture: 0.09,
    fifths: -0.03,
    chromatic: -0.1,
    seventh: -0.09,
  },
  jazz: {
    resolution: 0.02,
    secondary: 0.09,
    mixture: 0,
    fifths: 0.08,
    chromatic: 0.09,
    seventh: 0.1,
  },
  classical: {
    resolution: 0.06,
    secondary: 0.03,
    mixture: -0.03,
    fifths: 0.03,
    chromatic: -0.12,
    seventh: -0.04,
  },
} satisfies Record<SpaceStyle, Record<string, number>>;

function contextBonus(
  history: Role[],
  candidate: Role,
): Contribution | undefined {
  let best: Contribution | undefined;
  for (const pattern of patterns) {
    for (let next = 2; next < pattern.steps.length; next++) {
      if (!pattern.steps[next](candidate)) continue;
      const length = Math.min(next, history.length, 4);
      if (
        length < 2 ||
        !history
          .slice(-length)
          .every((r, i) => pattern.steps[next - length + i](r))
      )
        continue;
      let value = 0.1 + (length - 2) * 0.025;
      if (
        pattern.id === 'ii-V-I' &&
        candidate.node.chord.quality === 'maj7' &&
        history.slice(-2).every((r) => r.pitches.length === 4)
      )
        value += 0.07;
      if (pattern.id === 'dominant-chain' && dominant(candidate)) value += 0.04;
      if (!best || value > best.value)
        best = { rule: pattern.id, source: 'context', value };
    }
  }
  return best;
}

// Rules use key-relative degrees, spelled analysis and interval relations.
// Layout IDs and absolute chord-name strings never determine harmony here.
export function getRecommendations({
  key,
  style,
  history,
  availableChords,
}: {
  key: Key;
  style: SpaceStyle;
  history: readonly string[];
  availableChords: readonly SpaceNode[];
}): Recommendation[] {
  const roles = availableChords.map((n) => role(n, key));
  const byId = new Map(roles.map((r) => [r.node.id, r]));
  const recent = history
    .slice(-8)
    .map((id) => byId.get(id))
    .filter((r): r is Role => !!r);
  const current = recent.at(-1);
  if (!current) return [];
  const weights = profiles[style];
  const all: Recommendation[] = [];
  for (const next of roles) {
    if (next.node.id === current.node.id) continue;
    const bases: { type: RecommendationType; score: number; rule: string }[] =
      [];
    const add = (type: RecommendationType, score: number, rule: string) =>
      bases.push({ type, score, rule });
    const fifth = mod(next.offset - current.offset) === 5;
    const common = next.pitches.filter((p) =>
      current.pitches.includes(p),
    ).length;
    if ((dominant(current) || degree(current, 4)) && fifth && stable(next))
      add(
        'resolve',
        next.analysis.kind === 'diatonic' ? 0.79 : 0.65,
        current.analysis.kind === 'secondary'
          ? 'applied-dominant-target'
          : 'dominant-tonic',
      );
    if (
      ['dim', 'dim7', 'm7♭5'].includes(current.node.chord.quality) &&
      mod(next.offset - current.offset) === 1 &&
      stable(next)
    )
      add('resolve', 0.77, 'leading-tone-resolution');
    if (dominant(current) && current.offset === 1 && degree(next, 0))
      add('resolve', 0.76, 'tritone-dominant-tonic');
    if (minorFourth(current) && degree(next, 0))
      add('resolve', 0.76, 'minor-plagal-return');
    for (const [from, to, score] of transitions)
      if (degree(current, from) && degree(next, to))
        add('continue', score, 'diatonic-movement');
    if (degree(current, 5) && degree(next, 0))
      add('continue', 0.55, 'relative-tonic-return');
    if (current.analysis.kind === 'borrowed' && degree(next, 0))
      add('continue', 0.53, 'borrowed-return');
    if (current.offset === 10 && degree(next, 3))
      add('continue', 0.64, 'flat-VII-IV');
    if (
      current.offset === 1 &&
      ['major', '7'].includes(current.node.chord.quality) &&
      degree(next, 4)
    )
      add(
        'continue',
        current.node.bass === 1 ? 0.73 : 0.57,
        'neapolitan-dominant',
      );
    if (next.analysis.kind === 'secondary')
      add('continue', degree(current, 0) ? 0.47 : 0.43, 'approach-secondary');
    if (dominant(current) && dominant(next) && fifth)
      add('continue', 0.64, 'dominant-chain-step');
    if (
      next.analysis.kind === 'borrowed' &&
      current.analysis.kind === 'diatonic'
    ) {
      add('color', degree(current, 0) ? 0.51 : 0.43, 'modal-mixture');
      if (minorFourth(next) && degree(current, 0))
        add('color', 0.58, 'tonic-borrowed-iv');
      if (minorFourth(next) && degree(current, 3))
        add('color', 0.75, 'major-to-minor-IV');
    }
    if (
      next.offset === current.offset &&
      next.node.chord.quality !== current.node.chord.quality &&
      next.analysis.kind !== 'diatonic'
    )
      add('color', 0.53, 'same-root-color');
    if (common || fifth)
      add(
        next.analysis.kind === 'diatonic' ? 'continue' : 'explore',
        0.24 + 0.035 * common + (fifth ? 0.04 : 0),
        common ? 'shared-tones' : 'fifth-relation',
      );
    if (
      dominant(next) &&
      next.offset === 1 &&
      current.analysis.kind === 'diatonic'
    )
      add('explore', 0.5, 'chromatic-dominant-approach');
    if (
      next.offset === 1 &&
      next.node.bass === 1 &&
      current.analysis.kind === 'diatonic'
    )
      add('color', 0.46, 'neapolitan-color');
    if (!bases.length) continue;
    bases.sort((a, b) => b.score - a.score);
    const base = bases[0];
    const contributions: Contribution[] = [
      { rule: base.rule, source: 'base', value: base.score },
    ];
    const bonus = (rule: string, value: number) =>
      contributions.push({ rule, source: 'style', value });
    if (base.type === 'resolve') bonus('resolution-weight', weights.resolution);
    if (base.type === 'color') bonus('mixture-weight', weights.mixture);
    if (base.type === 'explore' || base.rule === 'tritone-dominant-tonic')
      bonus('chromatic-weight', weights.chromatic);
    if (next.analysis.kind === 'secondary')
      bonus('secondary-weight', weights.secondary);
    if (fifth) bonus('fifths-weight', weights.fifths);
    if (next.pitches.length === 4) bonus('seventh-preference', weights.seventh);
    if (
      style === 'pop' &&
      ((degree(current, 0) && [3, 4, 5].some((n) => degree(next, n))) ||
        (degree(current, 5) && degree(next, 3)) ||
        (degree(current, 3) && degree(next, 4)) ||
        (degree(current, 0) && [8, 10].includes(next.offset)))
    )
      bonus('pop-loop', 0.1);
    if (
      style === 'classical' &&
      ((degree(current, 0) && degree(next, 1)) ||
        base.rule === 'neapolitan-dominant' ||
        (next.offset === 1 && next.node.bass === 1))
    )
      bonus('classical-predominant', 0.12);
    if (style === 'classical' && base.rule === 'dominant-chain-step')
      bonus('classical-chain-restraint', -0.1);
    const context = contextBonus(recent, next);
    if (context) contributions.push(context);
    if (recent.slice(-4).some((r) => r.node.id === next.node.id))
      contributions.push({
        rule: 'recent-repeat',
        source: 'recency',
        value: -0.03,
      });
    const rawScore = Math.max(
      0.05,
      contributions.reduce((sum, item) => sum + item.value, 0),
    );
    // A soft upper bound keeps strong contextual/style differences visible.
    const score =
      rawScore <= 0.8
        ? rawScore
        : 0.8 + 0.2 * (1 - Math.exp(-5 * (rawScore - 0.8)));
    all.push({
      chordId: next.node.id,
      type: base.type,
      score,
      reasons: contributions.map((c) => c.rule),
      contributions,
    });
  }
  // Limit duplicate root/family variants so six slots describe several paths.
  const selected: Recommendation[] = [];
  const remaining = [...all];
  const family = (item: Recommendation) => {
    const r = byId.get(item.chordId)!;
    return `${r.offset}:${r.analysis.kind}`;
  };
  while (remaining.length && selected.length < 6) {
    const effective = (item: Recommendation) =>
      item.score -
      (selected.some((s) => family(s) === family(item)) ? 0.16 : 0);
    remaining.sort(
      (a, b) =>
        effective(b) - effective(a) || a.chordId.localeCompare(b.chordId),
    );
    selected.push(remaining.shift()!);
  }
  return selected.sort(
    (a, b) => b.score - a.score || a.chordId.localeCompare(b.chordId),
  );
}
