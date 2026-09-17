import {
  defaultKey,
  diatonic,
  parsePitch,
  type Harmony,
  type Quality,
} from '../music/harmony';
import { chooseVoicing } from '../music/voicing';
import type { ChordEvent } from '../state/session';

export type SpaceLayer = 'core' | 'near' | 'outer';
export type SpaceRegion =
  'diatonic' | 'secondary' | 'borrowed' | 'diminished' | 'sharp' | 'color';
export interface SpaceNode {
  id: string;
  chord: Harmony;
  bass: number | null;
  layer: SpaceLayer;
  region: SpaceRegion;
  anchor?: string;
  satelliteOf?: string;
  position: { x: number; y: number };
}
export const SPACE_KEY = defaultKey;
export const SPACE_SIZE = { width: 1140, height: 850 };

const corePositions = [
  [610, 400],
  [695, 545],
  [525, 255],
  [525, 545],
  [695, 255],
  [440, 400],
  [780, 400],
] as const;
const coreIds = ['c', 'dm', 'em', 'f', 'g', 'am', 'bdim'];
const sevenths = diatonic(SPACE_KEY, true);
const core: SpaceNode[] = diatonic(SPACE_KEY).flatMap((chord, i) => {
  const [x, y] = corePositions[i];
  const id = coreIds[i];
  return [
    {
      id,
      chord,
      bass: null,
      layer: 'core',
      region: 'diatonic',
      position: { x, y },
    },
    {
      id: `${id}-seventh`,
      chord: sevenths[i],
      bass: null,
      layer: 'core',
      region: 'diatonic',
      anchor: id,
      satelliteOf: id,
      position: {
        x: x + (i === 0 ? 40 : i === 2 ? -25 : i === 4 ? 25 : 0),
        y: y + 53,
      },
    },
  ];
});
function node(
  id: string,
  root: string,
  quality: Quality,
  layer: SpaceLayer,
  region: SpaceRegion,
  anchor: string,
  x: number,
  y: number,
  bass: number | null = null,
): SpaceNode {
  return {
    id,
    chord: { root: parsePitch(root), quality },
    bass,
    layer,
    region,
    anchor,
    position: { x, y },
  };
}

// Editorial geography, not a metric or a strict Tonnetz. Anchors describe
// placement relationships only; they do not imply a recommended next chord.
export const SPACE_NODES: readonly SpaceNode[] = [
  ...core,
  node('a7', 'A', '7', 'near', 'secondary', 'dm', 810, 655),
  node('b7', 'B', '7', 'near', 'secondary', 'em', 510, 135),
  node('c7', 'C', '7', 'near', 'secondary', 'f', 490, 680),
  node('d7', 'D', '7', 'near', 'secondary', 'g', 840, 210),
  node('e7', 'E', '7', 'near', 'secondary', 'am', 310, 360),
  node('cm', 'C', 'minor', 'near', 'borrowed', 'c', 545, 465),
  node('fm', 'F', 'minor', 'near', 'borrowed', 'f', 400, 550),
  node('ab', 'Ab', 'major', 'near', 'borrowed', 'fm', 245, 515),
  node('bb', 'Bb', 'major', 'near', 'borrowed', 'f', 630, 690),
  node('eb', 'Eb', 'major', 'near', 'borrowed', 'cm', 350, 230),
  node('csdim7', 'C#', 'dim7', 'near', 'diminished', 'dm', 745, 715),
  node('fsdim7', 'F#', 'dim7', 'near', 'diminished', 'g', 880, 300),
  node('gsdim7', 'G#', 'dim7', 'near', 'diminished', 'am', 310, 430),
  node('db', 'Db', 'major', 'near', 'borrowed', 'fm', 340, 710),
  node('db7', 'Db', '7', 'near', 'borrowed', 'db', 340, 780),
  node('fs7', 'F#', '7', 'outer', 'sharp', 'fsdim7', 1020, 230),
  node('dsdim7', 'D#', 'dim7', 'outer', 'sharp', 'b7', 465, 195),
  node('gm', 'G', 'minor', 'outer', 'borrowed', 'g', 715, 185),
  node('fm7', 'F', 'm7', 'outer', 'borrowed', 'fm', 270, 615),
  node('abmaj7', 'Ab', 'maj7', 'outer', 'borrowed', 'ab', 110, 490),
  node('bb7', 'Bb', '7', 'outer', 'borrowed', 'bb', 650, 790),
  node('eb7', 'Eb', '7', 'outer', 'borrowed', 'eb', 290, 170),
  node('ab7', 'Ab', '7', 'outer', 'borrowed', 'ab', 115, 555),
  node('f7', 'F', '7', 'outer', 'borrowed', 'c7', 440, 755),
  node('db-f', 'Db', 'major', 'outer', 'borrowed', 'db', 200, 765, 1),
  node('caug', 'C', 'aug', 'outer', 'color', 'c', 605, 330),
  node('gaug', 'G', 'aug', 'outer', 'color', 'g', 810, 110),
  node('am-maj7', 'A', 'm(maj7)', 'outer', 'color', 'am', 400, 305),
];

// Auditions are independent of timeline settings and previous/future notes.
// bass is a chord-member index: Db/F explicitly uses its third as the bass.
export function spaceEvent(node: SpaceNode): ChordEvent {
  const input = { chord: node.chord, bass: node.bass, policy: 'root' as const };
  return {
    ...input,
    id: `space-${node.id}`,
    key: SPACE_KEY,
    duration: 1,
    notes: chooseVoicing(input),
  };
}
