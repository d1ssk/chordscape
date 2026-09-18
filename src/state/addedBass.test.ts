import { expect, it, vi } from 'vitest';
import {
  parsePitch,
  pc,
  pitchName,
  tones,
  voicedSymbol,
  midiName,
  QUALITIES,
  type Quality,
} from '../music/harmony';
import {
  canShiftOctave,
  changeAddedBass,
  chooseVoicing,
  rootVoicing,
  upperNotes,
} from '../music/voicing';
import {
  editSession,
  newSession,
  makeEvent,
  importSession,
  exportSession,
  revoice,
  reducer,
  loadSession,
  STORAGE_KEY,
  type Session,
} from './session';

function example(quality: Quality = 'major') {
  const session = newSession();
  return editSession(session, {
    type: 'append',
    event: makeEvent({ root: parsePitch('D'), quality }, session, 'one'),
  });
}
function setBass(session: Session, name: string | null) {
  return editSession(session, {
    type: 'event',
    id: 'one',
    patch: { addedBass: name ? parsePitch(name) : null },
  });
}

it('adds, replaces and removes exactly one bass without moving an open upper chord', () => {
  const original = example();
  original.events[0].notes = [50, 57, 66];
  let session = setBass(original, 'E');
  expect(session.events[0].notes).toEqual([40, 50, 57, 66]);
  expect(
    voicedSymbol(
      session.events[0].chord,
      session.events[0].notes,
      session.events[0].addedBass,
    ),
  ).toBe('D/E');
  for (let i = 0; i < 30; i++) {
    session = setBass(session, i % 2 ? 'E' : 'G');
    expect(upperNotes(session.events[0])).toEqual(original.events[0].notes);
    expect(session.events[0].notes).toHaveLength(4);
  }
  session = setBass(session, null);
  expect(session.events[0].notes).toEqual(original.events[0].notes);
  expect(original.events[0].addedBass).toBeUndefined();
});

it('keeps chord-member and enharmonic basses independent, including their spelling', () => {
  for (const name of ['D', 'F♯', 'G♭', 'C♭', 'E♯']) {
    const session = setBass(example(), name);
    const event = session.events[0];
    expect(event.notes).toHaveLength(4);
    expect(event.notes.slice(1)).toEqual([50, 54, 57]);
    expect(event.notes[0] % 12).toBe(pc(parsePitch(name)));
    expect(voicedSymbol(event.chord, event.notes, event.addedBass)).toBe(
      `D/${name}`,
    );
    expect(midiName(event.chord, event.notes[0], event.addedBass)).toMatch(
      new RegExp(`^${name}`),
    );
    expect(importSession(exportSession(session)).events).toEqual(
      session.events,
    );
  }
});

it('upper inversion edits keep the added bass; octave moves affect the whole event', () => {
  let session = setBass(example(), 'E');
  session = editSession(session, {
    type: 'event',
    id: 'one',
    patch: { bass: 1 },
  });
  expect(session.events[0].notes).toEqual([40, 54, 57, 62]);
  session = editSession(session, { type: 'octave', id: 'one', octaves: -1 });
  expect(session.events[0].notes).toEqual([28, 42, 45, 50]);
  expect(
    canShiftOctave(session.events[0].notes, -1, session.events[0].addedBass),
  ).toBe(false);
  const unchanged = editSession(session, {
    type: 'octave',
    id: 'one',
    octaves: -1,
  });
  expect(unchanged).toBe(session);
  expect(importSession(exportSession(session)).events).toEqual(session.events);
  session = setBass(session, null);
  expect(session.events[0].notes).toEqual([42, 45, 50]);
});

it('manual playback, Root and Smooth comparisons honor explicit bass without mutating saved notes', () => {
  let session = setBass(example(), 'E');
  session = editSession(session, {
    type: 'append',
    event: {
      ...session.events[0],
      id: 'two',
      addedBass: parsePitch('G'),
      notes: [43, 54, 57, 62],
      bass: 1,
    },
  });
  const saved = structuredClone(session.events);
  for (const policy of ['manual', 'root', 'smooth'] as const) {
    const voiced = revoice(
      session.events.map((e) => ({ ...e, policy })),
      true,
    );
    voiced.forEach((event) => {
      expect(event.notes[0] % 12).toBe(pc(event.addedBass!));
      expect(event.notes).toHaveLength(4);
      expect(new Set(event.notes.slice(1).map((n) => n % 12))).toEqual(
        new Set(tones(event.chord).map(pc)),
      );
    });
    expect(
      importSession(exportSession({ ...session, events: voiced })).events,
    ).toEqual(voiced);
  }
  expect(session.events).toEqual(saved);
});

it('all qualities, inversions and twelve bass pitches fit the supported range with at most eight notes', () => {
  const basses = [
    'C',
    'C♯',
    'D',
    'E♭',
    'E',
    'F',
    'F♯',
    'G',
    'A♭',
    'A',
    'B♭',
    'B',
  ];
  for (const quality of Object.keys(QUALITIES) as Quality[]) {
    const original = example(quality).events[0];
    for (let bass = 0; bass < tones(original.chord).length; bass++) {
      const input = {
        ...original,
        bass,
        notes: rootVoicing(original.chord, bass).map((n) => n - 12),
      };
      for (const name of basses) {
        const event = changeAddedBass(input, parsePitch(name));
        expect(event.notes.slice(1)).toEqual(input.notes);
        expect(event.notes.length).toBeLessThanOrEqual(8);
        for (const policy of ['manual', 'root', 'smooth'] as const) {
          const notes = chooseVoicing({ ...event, policy }, [48, 52, 55]);
          expect(notes[0]).toBeGreaterThanOrEqual(24);
          expect(notes[0] % 12).toBe(pc(parsePitch(name)));
          expect(notes[0]).toBeLessThan(notes[1]);
          expect(notes[1]).toBeGreaterThanOrEqual(36);
          expect(notes.at(-1)).toBeLessThanOrEqual(96);
          expect(notes.length).toBe(tones(input.chord).length + 1);
        }
      }
    }
  }
});

it('transpose, duplication, undo, melody regeneration and JSON preserve bass intent', () => {
  let session = setBass(example(), 'E');
  session = editSession(session, { type: 'transpose', semitones: 2 });
  expect(pitchName(session.events[0].addedBass!)).toBe('F♯');
  expect(session.events[0].notes).toEqual([42, 52, 56, 59]);
  session = editSession(session, {
    type: 'duplicate',
    id: 'one',
    newId: 'two',
  });
  session = editSession(session, { type: 'regenerateMelody' });
  expect(session.events.map((e) => e.notes)).toEqual([
    [42, 52, 56, 59],
    [42, 52, 56, 59],
  ]);
  const history = reducer(
    { past: [], present: session, future: [] },
    { type: 'event', id: 'one', patch: { addedBass: null } },
  );
  expect(reducer(history, { type: 'undo' }).present).toEqual(session);
  expect(importSession(exportSession(session)).events).toEqual(session.events);
});

it('low-register transposition keeps bass and upper voices in the same octave shift', () => {
  let session = setBass(example(), 'E');
  session = editSession(session, { type: 'octave', id: 'one', octaves: -1 });
  expect(session.events[0].notes).toEqual([28, 38, 42, 45]);
  session = editSession(session, { type: 'transpose', semitones: -3 });
  expect(session.events[0].notes).toEqual([37, 47, 51, 54]);
  expect(importSession(exportSession(session)).events).toEqual(session.events);
});

it('rejects missing, mismatched, extra and out-of-range basses without weakening chord validation', () => {
  const session = setBass(example(), 'E');
  for (const mutate of [
    (s: Session) => {
      delete s.events[0].addedBass;
    },
    (s: Session) => {
      s.events[0].addedBass = parsePitch('F');
    },
    (s: Session) => {
      s.events[0].addedBass = { letter: 'Q', accidental: 0 } as never;
    },
    (s: Session) => {
      s.events[0].notes[0] = 16;
    },
    (s: Session) => {
      s.events[0].notes = [40, 52, 54, 57];
    },
    (s: Session) => {
      s.events[0].notes.push(64);
    },
    (s: Session) => {
      s.events[0].notes = [50, 54, 57, 64];
    },
    (s: Session) => {
      s.events[0].bass = 1;
    },
  ]) {
    const invalid = structuredClone(session);
    mutate(invalid);
    expect(() => importSession(exportSession(invalid))).toThrow();
  }
});

it('loads existing v4 local sessions and exports them as v5 without changing their notes', () => {
  const legacy = { ...example(), schemaVersion: 4 };
  const getItem = vi.fn((key: string) =>
    key === 'chordscape.session.v4' ? JSON.stringify(legacy) : null,
  );
  vi.stubGlobal('localStorage', { getItem });
  try {
    const loaded = loadSession();
    expect(loaded.failed).toBe(false);
    expect(loaded.session.schemaVersion).toBe(5);
    expect(loaded.session.events).toEqual(legacy.events);
    expect(getItem).toHaveBeenCalledWith(STORAGE_KEY);
  } finally {
    vi.unstubAllGlobals();
  }
});
