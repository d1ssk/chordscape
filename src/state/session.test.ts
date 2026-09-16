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
import { diatonic, pitchName } from '../music/harmony';
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
      s.schemaVersion = 2 as 1;
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
