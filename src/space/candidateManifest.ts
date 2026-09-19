import { LETTERS, tones, type Pitch, type Quality } from '../music/harmony';
import { SPACE_NODES } from './layout';

type Components = {
  quality: 'major' | 'minor' | 'diminished' | 'augmented';
  seventh: 'none' | 'minor7' | 'major7' | 'diminished7';
  extensions: number[];
  alterations: string[];
};

const COMPONENTS: Partial<Record<Quality, Components>> = {
  major: {
    quality: 'major',
    seventh: 'none',
    extensions: [],
    alterations: [],
  },
  minor: {
    quality: 'minor',
    seventh: 'none',
    extensions: [],
    alterations: [],
  },
  dim: {
    quality: 'diminished',
    seventh: 'none',
    extensions: [],
    alterations: [],
  },
  aug: {
    quality: 'augmented',
    seventh: 'none',
    extensions: [],
    alterations: [],
  },
  '7': {
    quality: 'major',
    seventh: 'minor7',
    extensions: [],
    alterations: [],
  },
  maj7: {
    quality: 'major',
    seventh: 'major7',
    extensions: [],
    alterations: [],
  },
  m7: {
    quality: 'minor',
    seventh: 'minor7',
    extensions: [],
    alterations: [],
  },
  'm7♭5': {
    quality: 'diminished',
    seventh: 'minor7',
    extensions: [],
    alterations: [],
  },
  dim7: {
    quality: 'diminished',
    seventh: 'diminished7',
    extensions: [],
    alterations: [],
  },
  'm(maj7)': {
    quality: 'minor',
    seventh: 'major7',
    extensions: [],
    alterations: [],
  },
};

function relative(pitch: Pitch) {
  return {
    degree: LETTERS.indexOf(pitch.letter) + 1,
    accidental: pitch.accidental,
  };
}

export function chordscapeCandidateManifest() {
  return {
    schema_version: 1,
    version: 'chordscape-space-v1',
    source: 'src/space/layout.ts:SPACE_NODES',
    key: 'C:major',
    nodes: SPACE_NODES.map((node) => {
      const components = COMPONENTS[node.chord.quality];
      if (!components)
        throw new Error(`Unmapped candidate quality: ${node.chord.quality}`);
      const bass = node.bass === null ? null : tones(node.chord)[node.bass];
      const root = relative(node.chord.root);
      const relativeBass = bass ? relative(bass) : null;
      return [
        node.id,
        root.degree,
        root.accidental,
        components.quality,
        components.seventh,
        components.extensions,
        components.alterations,
        relativeBass ? [relativeBass.degree, relativeBass.accidental] : null,
      ];
    }),
  };
}
