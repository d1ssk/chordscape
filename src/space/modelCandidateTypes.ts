import { analyze, type Key } from '../music/harmony';
import type { PreviewCandidate } from './modelPreview';
import type { SpaceNode } from './layout';
import {
  getRecommendations,
  type RecommendationType,
  type SpaceStyle,
} from './recommendations';

export const MODEL_CANDIDATE_TYPES = [
  'resolve',
  'continue',
  'tension',
  'color',
  'explore',
] as const;
export type ModelCandidateType = RecommendationType | 'tension';
export const MODEL_CANDIDATE_LABELS = {
  resolve: 'spaceResolve',
  continue: 'spaceContinue',
  tension: 'spaceTension',
  color: 'spaceColor',
  explore: 'spaceExplore',
} as const;

const tenseQualities = new Set(['7', 'dim', 'dim7', 'm7♭5', 'aug', 'm(maj7)']);
const priority: Record<ModelCandidateType, number> = {
  resolve: 5,
  tension: 4,
  continue: 3,
  color: 2,
  explore: 1,
};

/** Label model-selected chords with the local rules; never reorder their ranks. */
export function classifyModelCandidates({
  key,
  style,
  history,
  availableChords,
  candidates,
}: {
  key: Key;
  style: SpaceStyle;
  history: readonly string[];
  availableChords: readonly SpaceNode[];
  candidates: readonly PreviewCandidate[];
}): Map<string, ModelCandidateType> {
  const nodes = new Map(availableChords.map((node) => [node.id, node]));
  const rules = new Map(
    getRecommendations(
      { key, style, history, availableChords },
      availableChords.length,
    ).map((recommendation) => [recommendation.chordId, recommendation]),
  );
  const current = history.at(-1);
  const result = new Map<string, ModelCandidateType>();

  function classify(id: string): ModelCandidateType {
    const node = nodes.get(id);
    if (!node) return 'explore';
    const matched = rules.get(id);
    if (matched?.type === 'resolve') return 'resolve';
    if (tenseQualities.has(node.chord.quality)) return 'tension';
    if (matched) return matched.type;
    if (current && id === current) return 'continue';
    const kind = analyze(node.chord, key).kind;
    if (kind === 'borrowed') return 'color';
    if (current && kind === 'diatonic') return 'continue';
    return 'explore';
  }

  for (const candidate of candidates) {
    if (!candidate.ids.length) continue;
    const type = candidate.ids
      .map(classify)
      .reduce((best, next) => (priority[next] > priority[best] ? next : best));
    for (const id of candidate.ids) result.set(id, type);
  }
  return result;
}
