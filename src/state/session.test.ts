import { expect, it } from 'vitest';
import {
  editSession,
  exportSession,
  importSession,
  keyFromName,
  makeEvent,
  newSession,
  reducer,
  MAX_EVENTS,
} from './session';
import {
  diatonic,
  pitchName,
  outside,
  MAJOR_KEYS,
  MINOR_KEYS,
  QUALITIES,
  parsePitch,
  tones,
  pc,
  type Quality,
} from '../music/harmony';
import { rootVoicing, EDITED_RANGE } from '../music/voicing';
function example() {
  const s = newSession();
  return editSession(s, {
    type: 'append',
    event: makeEvent(diatonic(s.settings.key)[0], s, 'one'),
  });
}
it('key/palette changes preserve recorded pitches and contexts; transpose updates both', () => {
  const session = example();
  const changed = editSession(session, {
    type: 'settings',
    patch: { key: keyFromName('D', 'major'), seventh: true },
  });
  expect(changed.events).toEqual(session.events);
  const transposed = editSession(session, { type: 'transpose', semitones: 2 });
  expect(transposed.events[0].notes).toEqual([50, 54, 57]);
  expect(pitchName(transposed.events[0].key.tonic)).toBe('D');
});
it('edits retain stable IDs; clear is undoable and redoable', () => {
  let h = { past: [], present: example(), future: [] } as Parameters<
    typeof reducer
  >[0];
  h = reducer(h, { type: 'duplicate', id: 'one', newId: 'two' });
  h = reducer(h, { type: 'move', id: 'two', direction: -1 });
  expect(h.present.events.map((e) => e.id)).toEqual(['two', 'one']);
  h = reducer(h, { type: 'clear' });
  expect(h.present.events).toHaveLength(0);
  h = reducer(h, { type: 'undo' });
  expect(h.present.events).toHaveLength(2);
  h = reducer(h, { type: 'redo' });
  expect(h.present.events).toHaveLength(0);
});
it('round trips validated sessions and rejects malformed/untrusted JSON', () => {
  const session = example();
  expect(importSession(exportSession(session)).events).toEqual(session.events);
  for (const mutate of [
    (s: typeof session) => {
      s.schemaVersion = 99 as 4;
    },
    (s: typeof session) => {
      s.settings.tempo = 201;
    },
    (s: typeof session) => {
      s.events[0].notes = [48, 52, 56];
    },
    (s: typeof session) => {
      s.events[0].bass = 2;
    },
    (s: typeof session) => {
      s.events = [s.events[0], s.events[0]];
    },
    (s: typeof session) => {
      s.events = Array.from({ length: MAX_EVENTS + 1 }, (_, i) => ({
        ...s.events[0],
        id: String(i),
      }));
    },
  ]) {
    const s = structuredClone(session);
    mutate(s);
    expect(() => importSession(exportSession(s))).toThrow();
  }
  expect(() => importSession('{')).toThrow();
});
it('manual inversion survives global voicing policy', () => {
  let s = example();
  s = editSession(s, { type: 'event', id: 'one', patch: { bass: 1 } });
  s = editSession(s, { type: 'policy', policy: 'smooth' });
  expect(s.events[0].notes[0] % 12).toBe(4);
});
it('transposing distinct event contexts preserves their relative pitch classes', () => {
  let s = example();
  const g = {
    ...s,
    settings: { ...s.settings, key: keyFromName('G', 'major') },
  };
  s = editSession(s, {
    type: 'append',
    event: makeEvent(diatonic(g.settings.key)[0], g, 'two'),
  });
  const shifted = editSession(s, { type: 'transpose', semitones: 1 });
  expect(
    (shifted.events[1].notes[0] - shifted.events[0].notes[0] + 12) % 12,
  ).toBe(7);
  expect(importSession(exportSession(shifted)).events).toEqual(shifted.events);
});

it('all supported keys and outside palettes remain importable after transposition', () => {
  for (const mode of ['major', 'minor'] as const)
    for (const name of mode === 'major' ? MAJOR_KEYS : MINOR_KEYS) {
      const base = newSession();
      base.settings.key = keyFromName(name, mode);
      base.events = [
        ...diatonic(base.settings.key),
        ...diatonic(base.settings.key, true),
        ...outside(base.settings.key),
      ].map((chord, i) => makeEvent(chord, base, String(i)));
      for (const semitones of [-12, -7, -1, 0, 1, 5, 12]) {
        const moved = editSession(base, { type: 'transpose', semitones });
        expect(
          () => importSession(exportSession(moved)),
          `${name} ${mode}, ${semitones}`,
        ).not.toThrow();
      }
    }
});
it('duration-only edits keep a saved open voicing exactly', () => {
  const s = example();
  s.events[0].notes = [48, 55, 64];
  const changed = editSession(s, {
    type: 'event',
    id: 'one',
    patch: { duration: 2 },
  });
  expect(changed.events[0].notes).toEqual([48, 55, 64]);
});

it('manual is the default and preserves edits through reordering, melody, undo and JSON', () => {
  let s = example();
  expect(s.settings.policy).toBe('manual');
  s = editSession(s, {
    type: 'append',
    event: makeEvent(diatonic(s.settings.key)[4], s, 'two'),
  });
  const other = s.events[1].notes;
  s = editSession(s, { type: 'event', id: 'one', patch: { bass: 1 } });
  s = editSession(s, { type: 'octave', id: 'one', octaves: 1 });
  expect(s.events[0].notes).toEqual([64, 67, 72]);
  s = editSession(s, { type: 'event', id: 'one', patch: { bass: 2 } });
  expect(s.events[0].notes).toEqual([67, 72, 76]);
  expect(s.events[1].notes).toEqual(other);
  const edited = s.events.map((e) => e.notes);
  s = editSession(s, { type: 'policy', policy: 'manual' });
  s = editSession(s, { type: 'regenerateMelody' });
  expect(s.events.map((e) => e.notes)).toEqual(edited);
  expect(importSession(exportSession(s)).events).toEqual(s.events);
  const history = reducer(
    { past: [], present: s, future: [] },
    { type: 'octave', id: 'one', octaves: -1 },
  );
  expect(reducer(history, { type: 'undo' }).present).toEqual(s);
  s = editSession(s, { type: 'move', id: 'one', direction: 1 });
  expect(s.events.map((e) => e.notes)).toEqual([...edited].reverse());
  // Automatic policies remain explicit operations; switching back freezes them.
  s = editSession(s, { type: 'policy', policy: 'smooth' });
  const smooth = s.events.map((e) => e.notes);
  s = editSession(s, { type: 'policy', policy: 'manual' });
  expect(s.events.map((e) => e.notes)).toEqual(smooth);
});

it('all chord inversions support an octave above and below and validate on reload', () => {
  for (const root of ['C', 'B'])
    for (const quality of Object.keys(QUALITIES) as Quality[]) {
      const chord = { root: parsePitch(root), quality };
      for (let bass = 0; bass < tones(chord).length; bass++)
        for (const octaves of [-1, 1] as const) {
          let s = newSession();
          s.events = [
            {
              ...makeEvent(chord, s, 'one'),
              bass,
              notes: rootVoicing(chord, bass),
            },
          ];
          const original = s.events[0].notes;
          s = editSession(s, { type: 'octave', id: 'one', octaves });
          expect(s.events[0].notes).toEqual(
            original.map((n) => n + octaves * 12),
          );
          expect(s.events[0].notes[0] % 12).toBe(pc(tones(chord)[bass]));
          expect(importSession(exportSession(s)).events).toEqual(s.events);
        }
    }
  let s = example();
  for (let n = 0; n < 8; n++)
    s = editSession(s, { type: 'octave', id: 'one', octaves: -1 });
  expect(s.events[0].notes[0]).toBe(EDITED_RANGE.low);
  const invalid = structuredClone(s);
  invalid.events[0].notes = invalid.events[0].notes.map((n) => n + 72);
  expect(() => importSession(exportSession(invalid))).toThrow();
});
