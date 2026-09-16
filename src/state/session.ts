import {
  defaultKey,
  QUALITIES,
  LETTERS,
  MAJOR_KEYS,
  MINOR_KEYS,
  parsePitch,
  pitchName,
  pc,
  tones,
  transposeKey,
  transposeHarmony,
  type Harmony,
  type Key,
  type Pitch,
} from '../music/harmony';
import {
  chooseVoicing,
  optimizeVoicings,
  type VoicingInput,
  type VoicingPolicy,
} from '../music/voicing';
import type { Locale } from '../i18n/messages';
export const MAX_EVENTS = 256;
export interface ChordEvent extends VoicingInput {
  id: string;
  key: Key;
  duration: number;
  notes: number[];
}
export interface Settings {
  key: Key;
  seventh: boolean;
  tempo: number;
  duration: number;
  volume: number;
  locale: Locale;
  record: boolean;
  loop: boolean;
  policy: VoicingPolicy;
}
export interface Session {
  schemaVersion: 1;
  revision: number;
  settings: Settings;
  events: ChordEvent[];
}
export function newSession(): Session {
  return {
    schemaVersion: 1,
    revision: 0,
    settings: {
      key: defaultKey,
      seventh: false,
      tempo: 90,
      duration: 4,
      volume: 0.5,
      locale: 'ja',
      record: true,
      loop: false,
      policy: 'root',
    },
    events: [],
  };
}
export function makeEvent(
  chord: Harmony,
  session: Session,
  id: string,
  previous?: number[],
): ChordEvent {
  const input = { chord, bass: null, policy: session.settings.policy };
  return {
    ...input,
    id,
    key: session.settings.key,
    duration: session.settings.duration,
    notes: chooseVoicing(input, previous),
  };
}
export function revoice(events: ChordEvent[], loop: boolean): ChordEvent[] {
  const notes = optimizeVoicings(events, loop);
  return events.map((event, i) => ({ ...event, notes: notes[i] }));
}
export type Edit =
  | { type: 'settings'; patch: Partial<Settings> }
  | { type: 'append'; event: ChordEvent }
  | { type: 'delete'; id: string }
  | { type: 'duplicate'; id: string; newId: string }
  | { type: 'move'; id: string; direction: -1 | 1 }
  | {
      type: 'event';
      id: string;
      patch: Partial<Pick<ChordEvent, 'duration' | 'bass'>>;
    }
  | { type: 'clear' }
  | { type: 'policy'; policy: VoicingPolicy }
  | { type: 'transpose'; semitones: number }
  | { type: 'replace'; session: Session };
export function editSession(session: Session, action: Edit): Session {
  let settings = session.settings;
  let events = session.events;
  switch (action.type) {
    case 'settings':
      settings = { ...settings, ...action.patch };
      break;
    case 'append':
      if (events.length >= MAX_EVENTS) return session;
      events = [...events, action.event];
      break;
    case 'delete':
      events = events.filter((e) => e.id !== action.id);
      break;
    case 'duplicate': {
      if (events.length >= MAX_EVENTS) return session;
      const index = events.findIndex((e) => e.id === action.id);
      if (index < 0) return session;
      events = [
        ...events.slice(0, index + 1),
        { ...events[index], id: action.newId },
        ...events.slice(index + 1),
      ];
      break;
    }
    case 'move': {
      const index = events.findIndex((e) => e.id === action.id);
      const to = index + action.direction;
      if (index < 0 || to < 0 || to >= events.length) return session;
      events = [...events];
      [events[index], events[to]] = [events[to], events[index]];
      break;
    }
    case 'event':
      events = events.map((e) =>
        e.id === action.id ? { ...e, ...action.patch } : e,
      );
      if (Object.hasOwn(action.patch, 'bass'))
        events = revoice(events, settings.loop);
      break;
    case 'clear':
      events = [];
      break;
    case 'policy':
      settings = { ...settings, policy: action.policy };
      events = revoice(
        events.map((e) => ({ ...e, policy: action.policy })),
        settings.loop,
      );
      break;
    case 'transpose': {
      settings = {
        ...settings,
        key: transposeKey(settings.key, action.semitones),
      };
      events = events.map((e) => {
        const key = transposeKey(e.key, action.semitones);
        const chord = transposeHarmony(e.chord, e.key, key, action.semitones);
        let notes = e.notes.map((n) => n + action.semitones);
        while (notes[0] < 36) notes = notes.map((n) => n + 12);
        while (notes.at(-1)! > 84) notes = notes.map((n) => n - 12);
        return { ...e, key, chord, notes };
      });
      break;
    }
    case 'replace':
      return { ...action.session, revision: session.revision + 1 };
  }
  return { ...session, settings, events, revision: session.revision + 1 };
}
export interface History {
  past: Session[];
  present: Session;
  future: Session[];
}
export type Action = Edit | { type: 'undo' } | { type: 'redo' };
export function reducer(history: History, action: Action): History {
  if (action.type === 'undo') {
    const previous = history.past.at(-1);
    return previous
      ? {
          past: history.past.slice(0, -1),
          present: previous,
          future: [history.present, ...history.future],
        }
      : history;
  }
  if (action.type === 'redo') {
    const next = history.future[0];
    return next
      ? {
          past: [...history.past, history.present],
          present: next,
          future: history.future.slice(1),
        }
      : history;
  }
  const next = editSession(history.present, action);
  if (next === history.present) return history;
  return {
    past: [...history.past.slice(-49), history.present],
    present: next,
    future: [],
  };
}
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const numberIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max;
function isPitch(value: unknown): value is Pitch {
  return (
    object(value) &&
    LETTERS.includes(value.letter as Pitch['letter']) &&
    numberIn(value.accidental, -2, 2) &&
    Number.isInteger(value.accidental)
  );
}
function isKey(value: unknown): value is Key {
  return (
    object(value) &&
    isPitch(value.tonic) &&
    (value.mode === 'major' || value.mode === 'minor') &&
    (value.mode === 'major' ? MAJOR_KEYS : MINOR_KEYS).includes(
      pitchName(value.tonic),
    )
  );
}
function isHarmony(value: unknown): value is Harmony {
  return (
    object(value) &&
    isPitch(value.root) &&
    typeof value.quality === 'string' &&
    Object.hasOwn(QUALITIES, value.quality)
  );
}
export function importSession(text: string): Session {
  if (text.length > 1_000_000) throw new Error('Session too large');
  const value: unknown = JSON.parse(text);
  if (!object(value) || value.schemaVersion !== 1)
    throw new Error('Unsupported schema');
  const s = value.settings;
  if (
    !object(s) ||
    !isKey(s.key) ||
    !numberIn(s.tempo, 40, 200) ||
    !numberIn(s.duration, 0.25, 16) ||
    !numberIn(s.volume, 0, 1) ||
    !['ja', 'en'].includes(String(s.locale)) ||
    !['root', 'smooth'].includes(String(s.policy)) ||
    !['seventh', 'record', 'loop'].every((k) => typeof s[k] === 'boolean')
  )
    throw new Error('Invalid settings');
  if (!Array.isArray(value.events) || value.events.length > MAX_EVENTS)
    throw new Error('Invalid events');
  const ids = new Set<string>();
  const events: ChordEvent[] = value.events.map((e: unknown) => {
    if (
      !object(e) ||
      typeof e.id !== 'string' ||
      !/^[\w-]{1,80}$/.test(e.id) ||
      ids.has(e.id) ||
      !isKey(e.key) ||
      !isHarmony(e.chord) ||
      !numberIn(e.duration, 0.25, 16) ||
      !['root', 'smooth'].includes(String(e.policy))
    )
      throw new Error('Invalid event');
    ids.add(e.id);
    const pitches = tones(e.chord).map(pc);
    if (!(
      e.bass === null ||
      (numberIn(e.bass, 0, pitches.length - 1) && Number.isInteger(e.bass))
    ))
      throw new Error('Invalid bass');
    if (
      !Array.isArray(e.notes) ||
      e.notes.length !== pitches.length ||
      !e.notes.every((n) => numberIn(n, 36, 84) && Number.isInteger(n)) ||
      e.notes.some((n, i) => i > 0 && n <= (e.notes as number[])[i - 1])
    )
      throw new Error('Invalid notes');
    const notes = e.notes as number[];
    if (
      new Set(notes.map((n) => n % 12)).size !== pitches.length ||
      notes.some((n) => !pitches.includes(n % 12)) ||
      (e.bass !== null && notes[0] % 12 !== pitches[e.bass as number])
    )
      throw new Error('Notes contradict chord or bass');
    return {
      id: e.id,
      key: e.key,
      chord: e.chord,
      duration: e.duration,
      bass: e.bass as number | null,
      policy: e.policy as VoicingPolicy,
      notes,
    };
  });
  return {
    schemaVersion: 1,
    revision: 0,
    settings: {
      key: s.key,
      tempo: s.tempo,
      duration: s.duration,
      volume: s.volume,
      locale: s.locale as Locale,
      seventh: s.seventh as boolean,
      record: s.record as boolean,
      loop: s.loop as boolean,
      policy: s.policy as VoicingPolicy,
    },
    events,
  };
}
export function keyFromName(name: string, mode: Key['mode']): Key {
  return { tonic: parsePitch(name), mode };
}
export function exportSession(session: Session) {
  return JSON.stringify(session, null, 2);
}
export const STORAGE_KEY = 'chordscape.session.v1';
export function loadSession(): { session: Session; failed: boolean } {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    return {
      session: text ? importSession(text) : newSession(),
      failed: false,
    };
  } catch {
    return { session: newSession(), failed: true };
  }
}
