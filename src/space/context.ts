import { defaultKey, type Key } from '../music/harmony';
import type { ChordEvent } from '../state/session';
import { rootVoicing } from '../music/voicing';
import { spaceNodes } from './layout';
import {
  getRecommendations,
  type Recommendation,
  type SpaceStyle,
} from './recommendations';
import { selectSpaceVoicing } from './voiceLeading';

export interface SpaceContext {
  key: Key;
  style: SpaceStyle;
  automaticVoicing: boolean;
  history: string[];
  current: ChordEvent | null;
  recommendations: Recommendation[];
}
export function newSpaceContext(
  key: Key = defaultKey,
  style: SpaceStyle = 'free',
  automaticVoicing = true,
): SpaceContext {
  return {
    key,
    style,
    automaticVoicing,
    history: [],
    current: null,
    recommendations: [],
  };
}
export function changeSpaceKey(context: SpaceContext, key: Key): SpaceContext {
  if (key.mode !== 'major') throw new Error('Major keys only');
  return newSpaceContext(key, context.style, context.automaticVoicing);
}
export function changeSpaceStyle(
  context: SpaceContext,
  style: SpaceStyle,
): SpaceContext {
  return {
    ...context,
    style,
    recommendations: getRecommendations({
      ...context,
      style,
      availableChords: spaceNodes(context.key),
    }),
  };
}
export function chooseSpaceChord(
  context: SpaceContext,
  id: string,
): SpaceContext {
  const availableChords = spaceNodes(context.key);
  const node = availableChords.find((n) => n.id === id);
  if (!node) return context;
  const history = [...context.history, id].slice(-12);
  const recommendations = getRecommendations({
    ...context,
    history,
    availableChords,
  });
  const next = recommendations.map((r) => ({
    input: availableChords.find((n) => n.id === r.chordId)!,
    score: r.score,
  }));
  const notes = context.automaticVoicing
    ? selectSpaceVoicing(context.current?.notes, node, next)
    : rootVoicing(node.chord, node.bass ?? 0);
  const current: ChordEvent = {
    id: `space-${node.id}`,
    chord: node.chord,
    bass: node.bass,
    policy: context.automaticVoicing ? 'smooth' : 'root',
    key: context.key,
    duration: 1,
    notes,
  };
  return { ...context, history, current, recommendations };
}
export function historyAge(
  history: readonly string[],
  id: string,
): number | undefined {
  const index = history.lastIndexOf(id);
  const age = history.length - 1 - index;
  return index >= 0 && age < 6 ? age : undefined;
}
