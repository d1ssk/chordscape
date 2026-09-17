import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  analyze,
  chordSymbol,
  diatonic,
  MAJOR_KEYS,
  LETTERS,
  MINOR_KEYS,
  parsePitch,
  pc,
  tones,
} from '../music/harmony';
import {
  buildListenPlan,
  cueAt,
  defaultListen,
  isListenSettings,
  LISTEN_RATE,
  listenItems,
  listenSpeechTokens,
  type ListenSettings,
} from './plan';
import {
  chordTokens,
  speechPhrases,
  SPEECH_QUALITIES,
  type SpeechToken,
} from './speech';
import { wavHeader, writePCM } from './render';
const durations = Object.fromEntries(
  Object.keys(speechPhrases).map((token) => [token, LISTEN_RATE]),
);
function take(s: ListenSettings, n = 100) {
  const iterator = listenItems(s);
  return Array.from({ length: n }, () => iterator.next().value!);
}
describe('listening sequences', () => {
  it('keeps fixed roots and all selected qualities, with stable seeds and actual inversion bass', () => {
    const settings = {
      ...defaultListen(parsePitch('D♭')),
      qualities: [...SPEECH_QUALITIES],
      inversions: true,
    };
    const items = take(settings, 400);
    expect(items).toEqual(take(settings, 400));
    expect(items).not.toEqual(take({ ...settings, seed: 43 }, 400));
    expect(new Set(items.map((c) => pc(c.chord.root)))).toEqual(new Set([1]));
    expect(new Set(items.map((c) => c.chord.quality)).size).toBe(17);
    expect(items.some((c) => c.notes[0] % 12 !== pc(c.chord.root))).toBe(true);
    for (const item of items)
      expect(new Set(item.notes.map((n) => n % 12))).toEqual(
        new Set(tones(item.chord).map(pc)),
      );
  });
  it('draws twelve roots independently, allowing repeats without an enharmonic weighting bias', () => {
    const items = take(
      { ...defaultListen(), mode: 'random', qualities: ['major'] },
      1000,
    );
    expect(new Set(items.map((c) => pc(c.chord.root))).size).toBe(12);
    expect(items.every((c) => c.chord.quality === 'major')).toBe(true);
    expect(
      items.some(
        (c, i) =>
          i > 0 && chordSymbol(c.chord) === chordSymbol(items[i - 1].chord),
      ),
    ).toBe(true);
  });
  it('uses all seven in-key chords in every key, with references only in the spoken key mode', () => {
    for (const [names, mode] of [
      [MAJOR_KEYS, 'major'],
      [MINOR_KEYS, 'minor'],
    ] as const)
      for (const name of names) {
        const key = { tonic: parsePitch(name), mode };
        const settings = { ...defaultListen(), key, seventh: true };
        const spoken = take({ ...settings, mode: 'key' }, 130);
        expect(spoken.filter((c) => c.reference)).toHaveLength(10);
        expect(spoken[0].reference).toBe(true);
        const ambient = take({ ...settings, mode: 'ambient' }, 100);
        expect(new Set(ambient.map((c) => chordSymbol(c.chord)))).toEqual(
          new Set(diatonic(key, true).map(chordSymbol)),
        );
        expect(
          ambient.every(
            (c) =>
              !c.reference &&
              !c.speech.length &&
              analyze(c.chord, key).kind === 'diatonic',
          ),
        ).toBe(true);
      }
  });
  it('spells spoken names, degrees and inversions separately from symbols', () => {
    const key = { tonic: parsePitch('A'), mode: 'minor' as const };
    expect(
      chordTokens({ root: parsePitch('C'), quality: 'major' }, key, true, 0),
    ).toEqual(['chord-C-p0-major', 'degree-3--1', 'inversion0']);
    expect(
      chordTokens({ root: parsePitch('E♯'), quality: 'm7♭5' }, key, false, 2),
    ).toEqual(['chord-E-p1-m7♭5', 'inversion2']);
  });
  it('creates an exact 20-minute file without cutting speech, chords, or answers at the boundary', () => {
    for (const order of ['nameFirst', 'soundFirst'] as const) {
      const plan = buildListenPlan({ ...defaultListen(), order }, durations);
      expect(plan.frames).toBe(20 * 60 * LISTEN_RATE);
      for (const cue of plan.cues) {
        expect(cue.end).toBeLessThanOrEqual(plan.frames);
        expect(
          cue.segments.every((s) => s.start >= cue.start && s.end <= cue.end),
        ).toBe(true);
        expect(cue.segments.filter((s) => s.kind === 'chord')).toHaveLength(
          order === 'nameFirst' ? 1 : 2,
        );
        expect(cue.segments[0].kind).toBe(
          order === 'nameFirst' ? 'speech' : 'chord',
        );
      }
      const first = plan.cues[0];
      expect(cueAt(plan, first.start / LISTEN_RATE)).toBe(first);
      expect(cueAt(plan, first.end / LISTEN_RATE)).toBe(plan.cues[1]);
      expect(cueAt(plan, 1200)).toBeUndefined();
      expect(cueAt(plan, 0)).toBe(first);
    }
  });
  it('needs no speech assets for ambient playback and rejects incomplete spoken sets', () => {
    const ambient = buildListenPlan(
      { ...defaultListen(), mode: 'ambient' },
      {},
    );
    expect(
      ambient.cues.every((c) => c.segments.every((s) => s.kind === 'chord')),
    ).toBe(true);
    expect(() => buildListenPlan(defaultListen(), {})).toThrow(
      'Missing speech',
    );
    for (const patch of [
      { qualities: [] },
      { mode: 'unknown' },
      { minutes: 120 },
      { root: { letter: 'X', accidental: 0 } },
      { seed: NaN },
      { gapSeconds: 0 },
    ])
      expect(isListenSettings({ ...defaultListen(), ...patch })).toBe(false);
  });
});
it('encodes bounded signed PCM samples into a standard mono WAV', () => {
  const buffer = wavHeader(4);
  const view = new DataView(buffer);
  expect(view.getUint32(24, true)).toBe(LISTEN_RATE);
  expect(view.getUint32(40, true)).toBe(8);
  writePCM(view, 0, new Float32Array([-2, -0.5, 0.5, 2]));
  expect([0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true))).toEqual([
    -32768, -16384, 16384, 32767,
  ]);
  expect(() => writePCM(view, 4, new Float32Array([1]))).toThrow('overflow');
});
it('bundles every pronunciation with its source license and reproducible hash', () => {
  const manifest = JSON.parse(
    readFileSync('public/speech/ja/manifest.json', 'utf8'),
  ) as {
    generator: string;
    version: string;
    speaker: number;
    files: {
      token: SpeechToken;
      phrase: string;
      file: string;
      bytes: number;
      sha256: string;
    }[];
  };
  expect(manifest.generator).toBe('VOICEVOX Nemo');
  expect(manifest.version).toBe('0.24.0');
  expect(manifest.speaker).toBe(10005);
  expect(new Set(manifest.files.map((f) => f.token))).toEqual(
    new Set(Object.keys(speechPhrases)),
  );
  for (const entry of manifest.files) {
    expect(entry.phrase).toBe(speechPhrases[entry.token]);
    const data = readFileSync(`public/speech/ja/${entry.file}`);
    expect(data.length).toBe(entry.bytes);
    expect(entry.file.endsWith('.mp3')).toBe(true);
    expect(data.includes(Buffer.from('VOICEVOX Nemo'))).toBe(true);
    expect(createHash('sha256').update(data).digest('hex')).toBe(entry.sha256);
  }
  expect(readFileSync('public/speech/ja/LICENSE-Nemo.txt', 'utf8')).toContain(
    'VOICEVOX Nemo',
  );
});

it('loads only the selected pool and covers every accepted spelling, degree and inversion', () => {
  expect(listenSpeechTokens(defaultListen()).size).toBe(5);
  expect(listenSpeechTokens({ ...defaultListen(), mode: 'ambient' }).size).toBe(
    0,
  );
  expect(speechPhrases['chord-F-p1-m7']).toBe('エフシャープマイナーセブンス');
  expect(speechPhrases['chord-B-p0-m7♭5']).toBe(
    'ビーマイナーセブンス、フラットファイブ',
  );
  for (const letter of LETTERS)
    for (let accidental = -2; accidental <= 2; accidental++)
      for (const mode of ['major', 'minor'] as const)
        for (const seventh of [false, true]) {
          const settings = {
            ...defaultListen(
              { letter, accidental },
              { tonic: { letter, accidental }, mode },
            ),
            seventh,
            inversions: true,
            qualities: [...SPEECH_QUALITIES],
          };
          for (const listenMode of ['fixed', 'key', 'random'] as const) {
            const selected = { ...settings, mode: listenMode };
            const pool = listenSpeechTokens(selected);
            for (const token of pool)
              expect(speechPhrases[token], token).toBeTruthy();
            for (const item of take(selected, 15))
              for (const token of item.speech)
                expect(pool.has(token), token).toBe(true);
          }
        }
});
