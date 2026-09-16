import { expect, it } from 'vitest';
import {
  analyze,
  chordSymbol,
  diatonic,
  MAJOR_KEYS,
  MINOR_KEYS,
  pc,
  roman,
  scale,
  tones,
} from './harmony';
import {
  buildBridge,
  chordInKey,
  buildCircleTravel,
  circleKeys,
  commonChords,
  keyEventsFor,
  sameChord,
} from './modulation';
import {
  editSession,
  exportSession,
  importSession,
  keyFromName,
  newSession,
  reducer,
} from '../state/session';

const c = keyFromName('C', 'major'),
  g = keyFromName('G', 'major');
const options = {
  from: c,
  to: g,
  duration: 4,
  seventh: false,
  policy: 'root' as const,
  cadence: false,
};
it('spells an enharmonic pivot separately in its old and new keys', () => {
  const from = keyFromName('F♯', 'major'),
    to = keyFromName('D♭', 'major');
  const events = buildBridge({ ...options, from, to });
  const pivot = events.find((e) => e.modulation?.role === 'pivot')!;
  expect(chordSymbol(pivot.chord)).toBe('D♯m');
  expect(roman(analyze(pivot.chord, from))).toBe('vi');
  const inTarget = chordInKey(pivot.chord, to);
  expect(chordSymbol(inTarget)).toBe('E♭m');
  expect(roman(analyze(inTarget, to))).toBe('ii');
});
it('compares quality and every pitch, with different triad/seventh intersections', () => {
  expect(commonChords(c, g).map(chordSymbol)).toEqual(['C', 'Em', 'G', 'Am']);
  expect(commonChords(c, g, true).map(chordSymbol)).toEqual([
    'Cmaj7',
    'Em7',
    'Am7',
  ]);
  expect(sameChord(diatonic(c)[4], diatonic(g)[0])).toBe(true);
  expect(sameChord(diatonic(c, true)[4], diatonic(g, true)[0])).toBe(false);
});
it('builds the C–Am–D7–G pivot with dual analyses and changes key only at G', () => {
  const events = buildBridge(options);
  expect(events.map((e) => chordSymbol(e.chord))).toEqual([
    'C',
    'Am',
    'D7',
    'G',
  ]);
  expect(events.map((e) => roman(analyze(e.chord, c)))).toEqual([
    'I',
    'vi',
    'V7/V',
    'V',
  ]);
  expect(events.map((e) => roman(analyze(e.chord, g)))).toEqual([
    'IV',
    'ii',
    'V7',
    'I',
  ]);
  expect(keyEventsFor(events).map((k) => [k.beat, k.key, k.intent])).toEqual([
    [0, c, 'initial'],
    [12, g, 'pivot'],
  ]);
  expect(
    buildBridge({ ...options, cadence: true })
      .slice(-3)
      .map((e) => chordSymbol(e.chord)),
  ).toEqual(['C', 'D7', 'G']);
});
it('does not invent pivots for distant keys or modulate to an equivalent key', () => {
  const events = buildBridge({ ...options, to: keyFromName('F♯', 'major') });
  expect(events.map((e) => e.modulation?.method)).toEqual([
    'direct',
    'direct',
    'direct',
  ]);
  expect(events.map((e) => chordSymbol(e.chord))).toEqual(['C', 'C♯7', 'F♯']);
  expect(buildBridge({ ...options, to: c })).toEqual([]);
  expect(
    buildBridge({
      ...options,
      from: keyFromName('F♯', 'major'),
      to: keyFromName('G♭', 'major'),
    }),
  ).toEqual([]);
});
it('keeps 12 circle slots, valid spellings, and relative major/minor signatures', () => {
  for (const flats of [false, true]) {
    const slots = circleKeys(flats);
    expect(new Set(slots.map((s) => pc(s.major.tonic))).size).toBe(12);
    for (const slot of slots) {
      expect(scale(slot.major).map(pc).sort()).toEqual(
        scale(slot.minor).map(pc).sort(),
      );
      expect(pc(slot.minor.tonic)).toBe((pc(slot.major.tonic) + 9) % 12);
    }
  }
});
it('builds closed travel in both directions for every supported key and round trips transposed intentions', () => {
  for (const mode of ['major', 'minor'] as const)
    for (const name of mode === 'major' ? MAJOR_KEYS : MINOR_KEYS)
      for (const direction of [1, -1] as const) {
        const from = keyFromName(name, mode);
        const events = buildCircleTravel(
          { ...options, from, seventh: direction === -1, policy: 'smooth' },
          direction,
        );
        const keys = keyEventsFor(events);
        expect(keys).toHaveLength(13);
        expect(keys.at(-1)?.key).toEqual(from);
        for (let i = 1; i < keys.length; i++)
          expect(
            (pc(keys[i].key.tonic) - pc(keys[i - 1].key.tonic) + 12) % 12,
          ).toBe(direction === 1 ? 7 : 5);
        for (const event of events)
          expect(event.notes.map((n) => n % 12).sort()).toEqual(
            tones(event.chord).map(pc).sort(),
          );
        const session = editSession(newSession(), { type: 'travel', events });
        expect(importSession(exportSession(session)).keyEvents).toEqual(keys);
        for (const semitones of [-1, 1, 7]) {
          const moved = editSession(session, { type: 'transpose', semitones });
          expect(
            () => importSession(exportSession(moved)),
            `${name} ${mode} ${direction} ${semitones}`,
          ).not.toThrow();
          expect(moved.keyEvents.map((k) => k.beat)).toEqual(
            keys.map((k) => k.beat),
          );
        }
      }
});
it('anchors boundaries to retained event IDs through duration edits, moves, deletion, undo and redo', () => {
  let session = editSession(newSession(), {
    type: 'bridge',
    events: buildBridge(options),
  });
  expect(session.settings.key).toEqual(c); // Appending is not an early modulation.
  session = editSession(session, {
    type: 'event',
    id: 'bridge-0',
    patch: { duration: 2 },
  });
  expect(session.keyEvents[1].beat).toBe(10);
  session = editSession(session, {
    type: 'move',
    id: 'bridge-3',
    direction: -1,
  });
  expect(session.keyEvents.map((k) => k.beat)).toEqual([0, 6, 10]);
  let history = { past: [], present: session, future: [] } as Parameters<
    typeof reducer
  >[0];
  history = reducer(history, { type: 'delete', id: 'bridge-3' });
  expect(history.present.keyEvents).toHaveLength(1);
  history = reducer(history, { type: 'undo' });
  expect(history.present.keyEvents).toEqual(session.keyEvents);
  history = reducer(history, { type: 'redo' });
  expect(history.present.keyEvents).toHaveLength(1);
  expect(importSession(exportSession(history.present)).events).toEqual(
    history.present.events,
  );
});
it('migrates v1/v2 exact notes and rejects orphan, mistimed and contradictory key events', () => {
  const session = editSession(newSession(), {
    type: 'bridge',
    events: buildBridge(options),
  });
  for (const version of [1, 2]) {
    const legacy = { ...session, schemaVersion: version, keyEvents: undefined };
    const migrated = importSession(JSON.stringify(legacy));
    expect(migrated.events).toEqual(session.events);
    expect(migrated.keyEvents).toEqual(session.keyEvents);
  }
  for (const mutate of [
    (s: typeof session) => {
      s.keyEvents[1].beat = 8;
    },
    (s: typeof session) => {
      s.keyEvents[1].eventId = 'missing';
    },
    (s: typeof session) => {
      s.keyEvents[1].key = c;
    },
    (s: typeof session) => {
      s.events[1].modulation!.to = keyFromName('F♯', 'major');
    },
  ]) {
    const invalid = structuredClone(session);
    mutate(invalid);
    expect(() => importSession(exportSession(invalid))).toThrow();
  }
});
