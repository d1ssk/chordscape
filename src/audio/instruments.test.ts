import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PIANO_NOTES, pianoFile } from './instruments';
import { exportSession, importSession, newSession } from '../state/session';
it('bundled samples match the licensed upstream manifest', () => {
  const path = 'public/samples/salamander/';
  const manifest = JSON.parse(readFileSync(path + 'manifest.json', 'utf8')) as {
    files: { file: string; bytes: number; sha256: string }[];
  };
  expect(
    manifest.files
      .filter((f) => f.file.endsWith('.mp3'))
      .map((f) => f.file)
      .sort(),
  ).toEqual(PIANO_NOTES.map(pianoFile).sort());
  for (const entry of manifest.files) {
    const contents = readFileSync(path + entry.file);
    expect(contents.length).toBe(entry.bytes);
    expect(createHash('sha256').update(contents).digest('hex')).toBe(
      entry.sha256,
    );
  }
  expect(readFileSync(path + 'README', 'utf8')).toContain(
    'Author: Alexander Holm',
  );
  expect(readFileSync(path + 'LICENSE.txt', 'utf8')).toContain(
    'Attribution 3.0 Unported',
  );
});
it('sound settings round trip while old sessions migrate and invalid names are rejected', () => {
  const session = newSession();
  session.settings.instrument = 'pad';
  expect(importSession(exportSession(session)).settings.instrument).toBe('pad');
  const legacy = JSON.parse(exportSession(session));
  delete legacy.settings.instrument;
  expect(importSession(JSON.stringify(legacy)).settings.instrument).toBe(
    'electric',
  );
  legacy.settings.instrument = 'invalid';
  expect(() => importSession(JSON.stringify(legacy))).toThrow();
});
