import { expect, it } from 'vitest';
import {
  defaultMelody,
  generateMelody,
  analyzeMelody,
  makeMotif,
  captureMelody,
  melodyKind,
  melodyPitch,
  type MelodyNote,
} from './melody';
import {
  defaultKey,
  diatonic,
  parsePitch,
  tones,
  pc,
  type Harmony,
  MAJOR_KEYS,
  MINOR_KEYS,
} from './harmony';
import {
  editSession,
  exportSession,
  importSession,
  makeEvent,
  newSession,
  reducer,
  keyFromName,
} from '../state/session';
import { buildBridge } from './modulation';
it('keeps melody, spelling and saved labels valid across all supported keys and transposed bridges', () => {
  for (const mode of ['major', 'minor'] as const)
    for (const name of mode === 'major' ? MAJOR_KEYS : MINOR_KEYS) {
      let session = editSession(newSession(), {
        type: 'melody',
        patch: { enabled: true, density: 1 },
      });
      const from = keyFromName(name, mode);
      session = editSession(session, {
        type: 'bridge',
        events: buildBridge({
          from,
          to: keyFromName(mode === 'major' ? 'D♭' : 'C♯', mode),
          duration: 4,
          seventh: true,
          policy: 'smooth',
          cadence: true,
        }),
      });
      expect(() => importSession(exportSession(session))).not.toThrow();
      for (const semitones of [-1, 1]) {
        const shifted = editSession(session, { type: 'transpose', semitones });
        expect(
          () => importSession(exportSession(shifted)),
          `${name} ${mode} ${semitones}`,
        ).not.toThrow();
        for (const event of shifted.events)
          expect(event.melody?.[0].kind).toBe('chord');
      }
    }
});
const settings = { ...defaultMelody(), enabled: true };
const events = [
  diatonic(defaultKey)[0],
  { root: parsePitch('A'), quality: '7' as const },
  diatonic(defaultKey)[1],
  diatonic(defaultKey)[4],
].map((chord, i) => makeEvent(chord, newSession(), `e${i}`));
it('reproduces motifs and notes from saved seeds; regeneration preserves accompaniment and supports undo', () => {
  const first = generateMelody(events, settings);
  expect(generateMelody(events, settings)).toEqual(first);
  expect(makeMotif({ ...settings, seed: 88 })).toEqual(makeMotif(settings));
  expect(generateMelody(events, { ...settings, seed: 88 })).not.toEqual(first);
  let session = newSession();
  session.events = events;
  session = editSession(session, { type: 'melody', patch: { enabled: true } });
  const history = reducer(
    { past: [], present: session, future: [] },
    { type: 'regenerateMelody' },
  );
  expect(
    history.present.events.map((e) => [
      e.id,
      e.chord,
      e.notes,
      e.key,
      e.duration,
    ]),
  ).toEqual(
    session.events.map((e) => [e.id, e.chord, e.notes, e.key, e.duration]),
  );
  expect(reducer(history, { type: 'undo' }).present).toEqual(session);
  expect(history.present.settings.melody.motifSeed).toBe(
    session.settings.melody.motifSeed,
  );
});
it('prioritizes actual altered chord tones on strong beats and fits all ranges and rhythms', () => {
  for (const density of [0, 0.5, 1])
    for (const min of [48, 60, 72, 84])
      for (const duration of [0.03123, 0.25, 1, 4, 16]) {
        const generated = generateMelody(
          events.map((e) => ({ ...e, duration })),
          { ...settings, density, min, max: min + 12 },
        );
        let start = 0;
        for (const event of generated) {
          let covered = 0;
          for (const note of event.melody!) {
            expect(note.beat).toBeCloseTo(covered);
            expect(note.duration).toBeGreaterThan(0);
            covered += note.duration;
            if (note.midi !== null) {
              expect(note.midi).toBeGreaterThanOrEqual(min);
              expect(note.midi).toBeLessThanOrEqual(min + 12);
              expect(pc(note.pitch!)).toBe(note.midi % 12);
            }
            if (note.beat === 0 || (start + note.beat) % 2 === 0)
              expect(note.kind).toBe('chord');
          }
          expect(covered).toBeCloseTo(duration);
          start += duration;
        }
      }
  const a7 = generateMelody([events[1]], settings)[0];
  expect(
    a7
      .melody!.filter((n) => n.kind === 'chord')
      .every((n) =>
        tones(a7.chord)
          .map(pc)
          .includes(n.midi! % 12),
      ),
  ).toBe(true);
});
it('classifies passing tones and approaches only from realized neighbors, with rests breaking the relation', () => {
  const note = (midi: number | null, beat: number): MelodyNote => ({
    midi,
    beat,
    duration: 1,
    pitch: midi === null ? null : melodyPitch(midi, events[0]),
    kind: melodyKind(midi, events[0]),
    ornament: null,
  });
  const event = {
    ...events[0],
    duration: 3,
    melody: [note(72, 0), note(74, 1), note(76, 2)],
  };
  expect(analyzeMelody([event])[0].melody![1].ornament).toBe('passing');
  expect(
    analyzeMelody([
      { ...event, melody: [note(null, 0), note(74, 1), note(76, 2)] },
    ])[0].melody![1].ornament,
  ).toBeNull();
  const before = { ...events[0], duration: 1, melody: [note(73, 0)] };
  const after = { ...events[2], duration: 1, melody: [note(74, 0)] };
  expect(analyzeMelody([before, after])[0].melody![0].ornament).toBe(
    'approach',
  );
  expect(
    analyzeMelody([before, after], true)[0].melody![0].ornament,
  ).toBeNull();
});
it('live uses only its current harmony, starts on a chord tone and does not promise a future chord', () => {
  for (const chord of [
    { root: parsePitch('F♯'), quality: '7' },
    { root: parsePitch('B♭'), quality: 'minor' },
  ] satisfies Harmony[]) {
    const event = makeEvent(chord, newSession(), 'live');
    const notes = generateMelody(
      [{ ...event, duration: 8 }],
      settings,
      true,
      75,
    )[0].melody!;
    expect(notes[0].kind).toBe('chord');
    expect(notes.every((n) => n.ornament !== 'approach')).toBe(true);
  }
});
it('clips live recording at actual offsets without drawing a different melody', () => {
  const event = generateMelody(
    [{ ...events[0], duration: 8 }],
    settings,
    true,
  )[0];
  const captured = captureMelody(event.melody!, 8, 0.35, 16);
  expect(captured[0].beat).toBe(0);
  expect(captured[0].midi).toBe(event.melody![0].midi);
  expect(captured[0].duration).toBeCloseTo(event.melody![0].duration - 0.35);
  expect(captured.at(-1)!.beat + captured.at(-1)!.duration).toBeCloseTo(16);
});
it('persists exact notes, transposes pitches, migrates v3 and rejects invalid notes or false labels', () => {
  let session = editSession(newSession(), { type: 'append', event: events[0] });
  session = editSession(session, {
    type: 'melody',
    patch: { enabled: true, density: 1 },
  });
  expect(importSession(exportSession(session)).events).toEqual(session.events);
  const shifted = editSession(session, { type: 'transpose', semitones: 2 });
  expect(shifted.events[0].melody!.map((n) => n.midi)).toEqual(
    session.events[0].melody!.map((n) => (n.midi === null ? null : n.midi + 2)),
  );
  expect(() => importSession(exportSession(shifted))).not.toThrow();
  const migrated = importSession(
    JSON.stringify({ ...session, schemaVersion: 3 }),
  );
  expect(migrated.settings.melody.enabled).toBe(false);
  for (const mutate of [
    (s: typeof session) => {
      s.events[0].melody![0].midi = 100;
    },
    (s: typeof session) => {
      s.events[0].melody![0].duration = 99;
    },
    (s: typeof session) => {
      s.events[0].melody![0].ornament = 'passing';
    },
    (s: typeof session) => {
      s.settings.melody.seed = -1;
    },
  ]) {
    const invalid = structuredClone(session);
    mutate(invalid);
    expect(() => importSession(exportSession(invalid))).toThrow();
  }
});

it('adds rhythmic and pitch variety across seeds while keeping wide leaps rare', () => {
  const measure = (version: 1 | 2, activity = settings.activity) => {
    let repeats = 0,
      moves = 0,
      wide = 0,
      unique = 0,
      rhythms = 0,
      distance = 0;
    for (let seed = 1; seed <= 32; seed++) {
      const line = generateMelody(events, {
        ...settings,
        version,
        seed,
        motifSeed: seed,
        activity,
      }).flatMap((e) => e.melody!);
      unique += new Set(line.flatMap((n) => (n.midi === null ? [] : [n.midi])))
        .size;
      rhythms += new Set(line.map((n) => n.duration)).size;
      for (let i = 1; i < line.length; i++) {
        if (line[i].midi === null || line[i - 1].midi === null) continue;
        const leap = Math.abs(line[i].midi! - line[i - 1].midi!);
        moves++;
        repeats += Number(leap === 0);
        wide += Number(leap > 7);
        distance += leap;
      }
    }
    return {
      repeats: repeats / moves,
      wide: wide / moves,
      unique: unique / 32,
      rhythms: rhythms / 32,
      distance: distance / moves,
    };
  };
  const old = measure(1),
    improved = measure(2);
  expect(improved.repeats).toBeLessThan(old.repeats * 0.7);
  expect(improved.unique).toBeGreaterThan(old.unique);
  expect(improved.rhythms).toBeGreaterThanOrEqual(2);
  expect(improved.wide).toBeLessThanOrEqual(0.1);
  expect(measure(2, 1).distance).toBeGreaterThan(measure(2, 0).distance);
});

it('preserves version-one saved music and upgrades only when regeneration is requested', () => {
  const oldSettings = { ...settings, version: 1 as const };
  const old = generateMelody(events, oldSettings);
  expect(makeMotif(oldSettings).every((step) => step.duration === 1)).toBe(
    true,
  );
  let session = newSession();
  session.settings.melody = oldSettings;
  for (const event of old)
    session = editSession(session, { type: 'append', event });
  const restored = importSession(exportSession(session));
  expect(restored.settings.melody.version).toBe(1);
  expect(restored.events).toEqual(session.events);
  const changed = editSession(restored, { type: 'regenerateMelody' });
  expect(changed.settings.melody.version).toBe(2);
  expect(changed.events.map((e) => e.notes)).toEqual(
    restored.events.map((e) => e.notes),
  );
  expect(changed.events.map((e) => e.melody)).not.toEqual(
    restored.events.map((e) => e.melody),
  );
  expect(importSession(exportSession(changed)).events).toEqual(changed.events);
});

it('covers fractional motif boundaries without gaps or nonpositive notes', () => {
  for (const duration of [
    0.117, 0.463, 1.9999999999, 7.9999999999, 8.0000000001,
  ]) {
    const result = generateMelody(
      Array.from({ length: 8 }, (_, i) => ({
        ...events[i % events.length],
        duration,
      })),
      settings,
    );
    for (const event of result) {
      let end = 0;
      for (const note of event.melody!) {
        expect(note.beat).toBeCloseTo(end, 7);
        expect(note.duration).toBeGreaterThan(0);
        end += note.duration;
      }
      expect(end).toBeCloseTo(duration, 7);
    }
  }
});
