import { describe, expect, it } from 'vitest';
import manifest from '../../harmony_model/datasets/chordscape_candidates.v1.json';
import { chordscapeCandidateManifest } from './candidateManifest';

describe('Chordscape candidate manifest', () => {
  it('is a versioned export of the actual 42-node TypeScript palette', () => {
    expect(chordscapeCandidateManifest()).toEqual(manifest);
  });
});
