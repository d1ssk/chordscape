import {
  defaultKey,
  diatonic,
  parsePitch,
  transposeHarmony,
  pc,
  mod,
  type Key,
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

// Root-position display events; context.ts chooses the actual audition voicing.
// bass is a chord-member index: Db/F explicitly uses its third as the bass.
export function spaceEvent(node: SpaceNode, key = SPACE_KEY): ChordEvent {
  const input = { chord: node.chord, bass: node.bass, policy: 'root' as const };
  return {
    ...input,
    id: `space-${node.id}`,
    key,
    duration: 1,
    notes: chooseVoicing(input),
  };
}

// A portrait arrangement of the same landscape. These are layout coordinates,
// not transposed chords or a second set of musical definitions.
export const SPACE_PORTRAIT_SIZE = { width: 300, height: 450 };
export const SPACE_PORTRAIT_POSITIONS: Record<
  string,
  { x: number; y: number }
> = {
  c: { x: 169, y: 218 },
  'c-seventh': { x: 180, y: 245 },
  dm: { x: 205, y: 285 },
  'dm-seventh': { x: 205, y: 312 },
  em: { x: 133, y: 151 },
  'em-seventh': { x: 124, y: 178 },
  f: { x: 133, y: 285 },
  'f-seventh': { x: 133, y: 312 },
  g: { x: 205, y: 151 },
  'g-seventh': { x: 217, y: 178 },
  am: { x: 98, y: 218 },
  'am-seventh': { x: 98, y: 245 },
  bdim: { x: 240, y: 218 },
  'bdim-seventh': { x: 240, y: 245 },
  a7: { x: 257, y: 333 },
  b7: { x: 127, y: 79 },
  c7: { x: 123, y: 353 },
  d7: { x: 263, y: 106 },
  e7: { x: 35, y: 207 },
  cm: { x: 139, y: 249 },
  fm: { x: 81, y: 284 },
  ab: { x: 33, y: 296 },
  bb: { x: 173, y: 359 },
  eb: { x: 52, y: 120 },
  csdim7: { x: 228, y: 371 },
  fsdim7: { x: 273, y: 145 },
  gsdim7: { x: 45, y: 248 },
  db: { x: 78, y: 366 },
  db7: { x: 72, y: 420 },
  fs7: { x: 273, y: 178 },
  dsdim7: { x: 122, y: 112 },
  gm: { x: 200, y: 96 },
  fm7: { x: 73, y: 323 },
  abmaj7: { x: 24, y: 331 },
  bb7: { x: 182, y: 417 },
  eb7: { x: 30, y: 78 },
  ab7: { x: 24, y: 365 },
  f7: { x: 125, y: 403 },
  'db-f': { x: 24, y: 407 },
  caug: { x: 170, y: 186 },
  gaug: { x: 245, y: 61 },
  'am-maj7': { x: 72, y: 170 },
};

export const SPACE_TONICS = [
  'C',
  'D♭',
  'D',
  'E♭',
  'E',
  'F',
  'F♯',
  'G',
  'A♭',
  'A',
  'B♭',
  'B',
] as const;

export function spaceNodes(key: Key): SpaceNode[] {
  if (key.mode !== 'major')
    throw new Error('Harmonic Space supports major keys only');
  const semitones = mod(pc(key.tonic) - pc(SPACE_KEY.tonic));
  return SPACE_NODES.map((node) => ({
    ...node,
    chord: transposeHarmony(node.chord, SPACE_KEY, key, semitones),
  }));
}
