import { expect, it } from 'vitest';
import {
  analyze,
  chromaticApproach,
  chordSymbol,
  defaultKey,
  MAJOR_KEYS,
  MINOR_KEYS,
  parsePitch,
  pc,
  pitchName,
  QUALITIES,
  resolvesTo,
  roman,
  tones,
  voicedSymbol,
  type Harmony,
} from './harmony';
import {
  defaultGenerator,
  generateProgression,
  isGenerationIntent,
  PreparedProgressions,
  realizeIntent,
  type GenerationOptions,
} from './generation';
import { candidates, rootVoicing } from './voicing';
import {
  editSession,
  exportSession,
  importSession,
  newSession,
  reducer,
} from '../state/session';

const options = (
  patch: Partial<GenerationOptions> = {},
): GenerationOptions => ({
  ...defaultGenerator(),
  key: defaultKey,
  policy: 'root',
  ...patch,
});
it('reproduces the requested Jazz turnaround with spelled intent and saved notes', () => {
  const input = options({ style: 'jazz', seventh: true, outside: 1, seed: 42 });
  const result = generateProgression(input);
  expect(result.events.map((e) => chordSymbol(e.chord))).toEqual([
    'CM7',
    'A7',
    'Dm7',
    'G7',
  ]);
  expect(result.events.map((e) => roman(analyze(e.chord, e.key)))).toEqual([
    'IM7',
    'V7/ii',
    'ii7',
    'V7',
  ]);
  expect(result.events[1].intent.purpose).toBe('secondary');
  expect(
    resolvesTo(
      analyze(result.events[1].chord, defaultKey),
      result.events[2].chord,
    ),
  ).toBe(true);
  expect(
    resolvesTo(
      analyze(result.events[1].chord, defaultKey),
      result.events[0].chord,
    ),
  ).toBe(false);
  expect(generateProgression(input)).toEqual(result);
  expect(generateProgression(input, 5)).toEqual(generateProgression(input, 5));
});
it('preserves phrase length, ending constraints and membership across generator settings', () => {
  for (const style of ['pop', 'jazz'] as const)
    for (const bars of [4, 8, 16] as const)
      for (const beatsPerChord of [2, 4, 8] as const)
        for (const ending of ['cadence', 'loop'] as const)
          for (const seventh of [false, true]) {
            const input = options({
              style,
              bars,
              beatsPerChord,
              ending,
              seventh,
              policy: seventh ? 'smooth' : 'root',
              seed: bars * 15 + beatsPerChord,
            });
            const result = generateProgression(input);
            expect(result.events.reduce((sum, e) => sum + e.duration, 0)).toBe(
              bars * 4,
            );
            expect(result.events).toHaveLength((bars * 4) / beatsPerChord);
            expect(
              ending === 'cadence' ? [0] : style === 'pop' ? [3, 4] : [4],
            ).toContain(result.events.at(-1)!.intent.degree);
            if (ending === 'loop')
              expect(result.events[0].intent.degree).toBe(0);
            for (const e of result.events) {
              expect(e.notes).toHaveLength(seventh ? 4 : 3);
              expect(analyze(e.chord, e.key).changed).toHaveLength(0);
              expect(new Set(e.notes.map((n) => n % 12))).toEqual(
                new Set(tones(e.chord).map(pc)),
              );
              expect(isGenerationIntent(e.intent, e.chord, e.key)).toBe(true);
            }
          }
});
it('generates and transposes importable major/minor phrases in every supported key', () => {
  for (const mode of ['major', 'minor'] as const)
    for (const name of mode === 'major' ? MAJOR_KEYS : MINOR_KEYS) {
      const key = { tonic: parsePitch(name), mode };
      for (const outside of [0, 1]) {
        const phrase = generateProgression(
          options({
            key,
            style: 'jazz',
            seventh: true,
            outside,
            policy: 'smooth',
          }),
        );
        let session = editSession(newSession(), { type: 'generate', phrase });
        expect(importSession(exportSession(session)).events).toEqual(
          session.events,
        );
        if (!outside)
          expect(
            phrase.events.every(
              (e) => analyze(e.chord, key).changed.length === 0,
            ),
          ).toBe(true);
        session = editSession(session, { type: 'transpose', semitones: 1 });
        expect(importSession(exportSession(session)).events).toEqual(
          session.events,
        );
        expect(session.generation!.modified).toBe(true);
        for (const e of session.events)
          expect(realizeIntent(e.intent!, e.key)).toEqual(e.chord);
      }
    }
});
it('varies motifs by seed and falls back transparently when two slots leave no outside position', () => {
  const patterns = new Set(
    Array.from({ length: 16 }, (_, seed) =>
      generateProgression(options({ seed, bars: 8, outside: 0.5 }))
        .events.map((e) => chordSymbol(e.chord))
        .join(),
    ),
  );
  expect(patterns.size).toBeGreaterThan(4);
  const popLoops = Array.from({ length: 16 }, (_, seed) =>
    generateProgression(options({ seed }))
      .events.map((e) => chordSymbol(e.chord))
      .join(),
  );
  expect(popLoops).toContain('C,G,Am,F');
  const short = generateProgression(
    options({ beatsPerChord: 8, outside: 1, ending: 'cadence' }),
  );
  expect(short.record.fallback).toBe('shortPhrase');
  expect(short.events.map((e) => chordSymbol(e.chord))).toEqual(['G', 'C']);
  expect(() => generateProgression(options({ version: 99 as 1 }))).toThrow();
});
it('generation is one undoable edit and automatic phrase changes do not flood history', () => {
  const first = generateProgression(options());
  const second = generateProgression(options(), 1);
  let history = { past: [], present: newSession(), future: [] } as Parameters<
    typeof reducer
  >[0];
  history = reducer(history, { type: 'generate', phrase: first });
  history = reducer(history, { type: 'autoPhrase', phrase: second });
  expect(history.past).toHaveLength(1);
  expect(history.present.events).toEqual(second.events);
  history = reducer(history, { type: 'undo' });
  expect(history.present.events).toHaveLength(0);
  history = reducer(history, { type: 'redo' });
  expect(history.present.events).toEqual(second.events);
});
it('validates generation metadata and migrates legacy schema without changing the notes', () => {
  const original = editSession(newSession(), {
    type: 'generate',
    phrase: generateProgression(
      options({ style: 'jazz', seventh: true, outside: 1 }),
    ),
  });
  expect(importSession(exportSession(original)).generation).toEqual(
    original.generation,
  );
  for (const mutate of [
    (s: typeof original) => {
      s.settings.generator.seed = -1;
    },
    (s: typeof original) => {
      s.generation!.options.version = 99 as 1;
    },
    (s: typeof original) => {
      s.generation!.phrase = 1.5;
    },
    (s: typeof original) => {
      s.generation!.options.seed = 12;
    },
    (s: typeof original) => {
      s.events[1].intent!.degree = 4;
    },
    (s: typeof original) => {
      s.events[1].intent!.appliedTo = 5;
    },
  ]) {
    const changed = structuredClone(original);
    mutate(changed);
    expect(() => importSession(exportSession(changed))).toThrow();
  }
  const legacy = JSON.parse(exportSession(original));
  legacy.schemaVersion = 1;
  delete legacy.generation;
  delete legacy.settings.generator;
  for (const event of legacy.events) delete event.intent;
  const migrated = importSession(JSON.stringify(legacy));
  expect(migrated.schemaVersion).toBe(4);
  expect(migrated.events.map((e) => e.notes)).toEqual(
    original.events.map((e) => e.notes),
  );
  expect(migrated.settings.generator).toEqual(defaultGenerator());
});
it('prepares deterministic phrases before reading and ignores preparation after Stop', () => {
  const queue = new PreparedProgressions(options());
  const first = queue.get(0);
  expect(queue.get(1)).toEqual(generateProgression(options(), 1));
  expect(queue.get(2)).toBeUndefined();
  queue.prepare(2);
  expect(queue.get(0)).toBe(first);
  expect(queue.get(2)).toEqual(generateProgression(options(), 2));
  for (let n = 3; n < 10; n++) queue.prepare(n);
  expect(queue.get(0)).toBeUndefined();
  expect(queue.get(8)).toBeDefined();
  queue.stop();
  queue.prepare(10);
  expect(queue.get(10)).toBeUndefined();
});
it('distinguishes added tones and ninths, including fifth-member bass without omissions', () => {
  const chord = (quality: Harmony['quality']): Harmony => ({
    root: parsePitch('C'),
    quality,
  });
  expect(tones(chord('add9')).map(pitchName)).toEqual(['C', 'E', 'G', 'D']);
  expect(tones(chord('9')).map(pitchName)).toEqual(['C', 'E', 'G', 'B♭', 'D']);
  expect(tones(chord('maj9')).map(pitchName)).toEqual([
    'C',
    'E',
    'G',
    'B',
    'D',
  ]);
  expect(tones(chord('m6')).map(pitchName)).toEqual(['C', 'E♭', 'G', 'A']);
  expect(roman(analyze(chord('6'), defaultKey))).toBe('I(add6)');
  expect(roman(analyze(chord('add9'), defaultKey), 3)).toBe('Iadd9');
  expect(voicedSymbol(chord('9'), rootVoicing(chord('9'), 4))).toBe('C9/D');
  for (const root of ['C♭', 'C', 'F♯', 'B'])
    for (const quality of Object.keys(QUALITIES) as Harmony['quality'][])
      for (
        let bass = 0;
        bass < tones({ root: parsePitch(root), quality }).length;
        bass++
      ) {
        const c = { root: parsePitch(root), quality };
        const choices = candidates({ chord: c, bass, policy: 'smooth' });
        expect(
          choices.length,
          `${root} ${quality} bass ${bass}`,
        ).toBeGreaterThan(0);
        for (const notes of choices) {
          expect(notes[0] % 12).toBe(pc(tones(c)[bass]));
          expect(notes).toHaveLength(tones(c).length);
        }
      }
  expect(
    chromaticApproach(
      { root: parsePitch('A♭'), quality: 'major' },
      { root: parsePitch('G'), quality: 'major' },
    ),
  ).toBe(-1);
  expect(
    chromaticApproach(
      { root: parsePitch('A♭'), quality: 'minor' },
      { root: parsePitch('G'), quality: 'major' },
    ),
  ).toBeNull();
});
