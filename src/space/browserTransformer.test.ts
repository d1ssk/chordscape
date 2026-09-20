import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BrowserTransformer,
  type BrowserModelManifest,
} from './browserTransformer';
import reference from './browserTransformer.reference.json';

describe('published pop/jazz Transformer', () => {
  it('matches the reviewed PyTorch checkpoint across styles and long context', () => {
    const manifest = JSON.parse(
      readFileSync('public/model/pop-jazz-v1.json', 'utf8'),
    ) as BrowserModelManifest;
    const bytes = readFileSync('public/model/pop-jazz-v1.bin');
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const model = new BrowserTransformer(manifest, buffer);
    for (const sample of reference) {
      const prediction = model.predict(sample.history, sample.style);
      const actual = new Map(
        prediction.candidates.map((candidate) => [
          candidate.ids[0],
          candidate.probability,
        ]),
      );
      let largestDifference = 0;
      for (const [id, probability] of Object.entries(sample.probabilities))
        largestDifference = Math.max(
          largestDifference,
          Math.abs(actual.get(id)! - probability),
        );
      expect(largestDifference).toBeLessThan(0.0002);
      const expectedTop = Object.entries(sample.probabilities).sort(
        (a, b) => b[1] - a[1],
      )[0][0];
      expect(prediction.candidates[0].ids[0]).toBe(expectedTop);
    }
  });
});
