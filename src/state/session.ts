import {
  defaultMelody,
  isMelodySettings,
  generateMelody,
  analyzeMelody,
  melodyKind,
  type MelodySettings,
  type MelodyNote,
} from '../music/melody';
import {
  keyEventsFor,
  sameKey,
  commonChords,
  sameChord,
  type KeyEvent,
  type ModulationIntent,
} from '../music/modulation';
import {
  DEFAULT_INSTRUMENT,
  isInstrument,
  type Instrument,
} from '../audio/instruments';
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
  canShiftOctave,
  manualInversion,
  EDITED_RANGE,
  type VoicingInput,
  type VoicingPolicy,
} from '../music/voicing';
import type { Locale } from '../i18n/messages';
import {
  defaultGenerator,
  generateProgression,
  isGeneratorSettings,
  isGenerationIntent,
  type GeneratorSettings,
  type GenerationIntent,
  type GenerationRecord,
  type GeneratedPhrase,
} from '../music/generation';
export const MAX_EVENTS = 256;
export interface ChordEvent extends VoicingInput {
  id: string;
  key: Key;
  duration: number;
  notes: number[];
  intent?: GenerationIntent;
  modulation?: ModulationIntent;
  melody?: MelodyNote[];
  live?: { appliedBeat: number; requestedBeat: number | null };
}
export interface Settings {
  generator: GeneratorSettings;
  melody: MelodySettings;
  instrument: Instrument;
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
  schemaVersion: 4;
  revision: number;
  settings: Settings;
  events: ChordEvent[];
  keyEvents: KeyEvent[];
  generation: (GenerationRecord & { modified: boolean }) | null;
}
export function newSession(): Session {
  return {
    schemaVersion: 4,
    revision: 0,
    settings: {
      generator: defaultGenerator(),
      melody: defaultMelody(),
      instrument: DEFAULT_INSTRUMENT,
      key: defaultKey,
      seventh: false,
      tempo: 90,
      duration: 4,
      volume: 0.5,
      locale: 'ja',
      record: true,
      loop: false,
      policy: 'manual',
    },
    events: [],
    keyEvents: [],
    generation: null,
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
  | { type: 'melody'; patch: Partial<MelodySettings> }
  | { type: 'regenerateMelody' }
  | { type: 'beginLive' }
  | { type: 'liveCapture'; events: ChordEvent[] }
  | { type: 'bridge'; events: ChordEvent[] }
  | { type: 'travel'; events: ChordEvent[] }
  | { type: 'clockKey'; key: Key }
  | { type: 'generate'; phrase: GeneratedPhrase }
  | { type: 'autoPhrase'; phrase: GeneratedPhrase }
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
  | { type: 'octave'; id: string; octaves: -1 | 1 }
  | { type: 'policy'; policy: VoicingPolicy }
  | { type: 'transpose'; semitones: number }
  | { type: 'replace'; session: Session };
export function editSession(session: Session, action: Edit): Session {
  let settings = session.settings;
  let events = session.events;
  let generation = session.generation;
  switch (action.type) {
    case 'beginLive':
      break;
    case 'liveCapture':
      events = action.events.slice(0, MAX_EVENTS);
      generation = generation ? { ...generation, modified: true } : null;
      break;
    case 'melody':
      settings = {
        ...settings,
        melody: {
          ...settings.melody,
          ...action.patch,
          version: Object.keys(action.patch).some((key) =>
            ['density', 'min', 'max', 'activity', 'seed', 'motifSeed'].includes(
              key,
            ),
          )
            ? 2
            : settings.melody.version,
        },
      };
      if (action.patch.seed !== undefined && !settings.melody.holdMotif)
        settings.melody.motifSeed = settings.melody.seed;
      if (
        Object.keys(action.patch).some(
          (k) => !['volume', 'timing', 'enabled', 'holdMotif'].includes(k),
        ) ||
        (action.patch.enabled && events.some((e) => !e.melody))
      )
        events = generateMelody(events, settings.melody);
      break;
    case 'regenerateMelody': {
      const seed = (settings.melody.seed + 1) >>> 0;
      settings = {
        ...settings,
        melody: {
          ...settings.melody,
          version: 2,
          enabled: true,
          seed,
          motifSeed: settings.melody.holdMotif
            ? settings.melody.motifSeed
            : seed,
        },
      };
      events = generateMelody(events, settings.melody);
      break;
    }
    case 'clockKey':
      if (sameKey(settings.key, action.key)) return session;
      settings = { ...settings, key: action.key };
      break;
    case 'bridge':
      if (events.length + action.events.length > MAX_EVENTS) return session;
      // Append preserves existing, possibly manually edited voicings.
      events = [...events];
      for (const event of action.events)
        events.push({
          ...event,
          notes: chooseVoicing(event, events.at(-1)?.notes),
        });
      break;
    case 'travel':
      if (action.events.length > MAX_EVENTS) return session;
      events = action.events;
      settings = { ...settings, loop: true };
      generation = null;
      break;
    case 'generate':
    case 'autoPhrase':
      events = action.phrase.events;
      generation = { ...action.phrase.record, modified: false };
      if (action.type === 'generate')
        settings = {
          ...settings,
          key: generation.options.key,
          policy: generation.options.policy,
          seventh: generation.options.seventh,
          loop: generation.options.ending === 'loop',
        };
      break;
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
    case 'octave': {
      const event = events.find((e) => e.id === action.id);
      if (!event || !canShiftOctave(event.notes, action.octaves))
        return session;
      settings = { ...settings, policy: 'manual' };
      events = events.map((e) => ({
        ...e,
        policy: 'manual',
        notes:
          e.id === action.id
            ? e.notes.map((n) => n + action.octaves * 12)
            : e.notes,
      }));
      break;
    }
    case 'event':
      events = events.map((e) =>
        e.id === action.id
          ? {
              ...e,
              ...action.patch,
              ...(Object.hasOwn(action.patch, 'bass')
                ? { notes: manualInversion(e, action.patch.bass ?? null) }
                : {}),
            }
          : e,
      );
      if (Object.hasOwn(action.patch, 'bass')) {
        settings = { ...settings, policy: 'manual' };
        events = events.map((e) => ({ ...e, policy: 'manual' }));
      }
      break;
    case 'clear':
      events = [];
      generation = null;
      break;
    case 'policy':
      settings = { ...settings, policy: action.policy };
      events = revoice(
        events.map((e) => ({ ...e, policy: action.policy })),
        settings.loop,
      );
      break;
    case 'transpose': {
      const shift = Math.max(
        48 - settings.melody.min,
        Math.min(96 - settings.melody.max, action.semitones),
      );
      settings = {
        ...settings,
        key: transposeKey(settings.key, action.semitones),
        melody: {
          ...settings.melody,
          min: settings.melody.min + shift,
          max: settings.melody.max + shift,
        },
      };
      events = events.map((e) => {
        const key = transposeKey(e.key, action.semitones);
        const chord = transposeHarmony(e.chord, e.key, key, action.semitones);
        let notes = e.notes.map((n) => n + action.semitones);
        while (notes[0] < EDITED_RANGE.low) notes = notes.map((n) => n + 12);
        while (notes.at(-1)! > EDITED_RANGE.high)
          notes = notes.map((n) => n - 12);
        const modulation = e.modulation
          ? {
              ...e.modulation,
              from: transposeKey(e.modulation.from, action.semitones),
              to: transposeKey(e.modulation.to, action.semitones),
            }
          : undefined;
        const melody = e.melody?.map((note) => {
          let midi = note.midi === null ? null : note.midi + action.semitones;
          if (midi !== null) {
            while (midi < settings.melody.min) midi += 12;
            while (midi > settings.melody.max) midi -= 12;
          }
          return { ...note, midi };
        });
        return {
          ...e,
          key,
          chord,
          notes,
          ...(melody ? { melody } : {}),
          ...(modulation ? { modulation } : {}),
        };
      });
      break;
    }
    case 'replace':
      return { ...action.session, revision: session.revision + 1 };
  }
  if (
    events !== session.events &&
    !['melody', 'regenerateMelody', 'liveCapture'].includes(action.type)
  ) {
    events = events.map((e) => {
      const { live: _live, ...retained } = e;
      void _live;
      return retained;
    });
    if (action.type === 'transpose') events = analyzeMelody(events);
    else if (settings.melody.enabled)
      events = generateMelody(events, settings.melody);
    else
      events = events.map((e) => {
        const { melody: _melody, ...retained } = e;
        void _melody;
        return retained;
      });
  }
  if (
    generation &&
    events !== session.events &&
    action.type !== 'generate' &&
    action.type !== 'autoPhrase' &&
    action.type !== 'melody' &&
    action.type !== 'regenerateMelody'
  )
    generation = { ...generation, modified: true };
  return {
    ...session,
    settings,
    events,
    keyEvents: keyEventsFor(events),
    generation,
    revision: session.revision + 1,
  };
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
  if (
    action.type === 'autoPhrase' ||
    action.type === 'clockKey' ||
    action.type === 'liveCapture'
  )
    return { ...history, present: next };
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
  if (text.length > 5_000_000) throw new Error('Session too large');
  const value: unknown = JSON.parse(text);
  if (
    !object(value) ||
    (value.schemaVersion !== 1 &&
      value.schemaVersion !== 2 &&
      value.schemaVersion !== 3 &&
      value.schemaVersion !== 4)
  )
    throw new Error('Unsupported schema');
  const s = value.settings;
  if (
    !object(s) ||
    !isKey(s.key) ||
    (value.schemaVersion === 4 && !isMelodySettings(s.melody)) ||
    (value.schemaVersion !== 1 && !isGeneratorSettings(s.generator)) ||
    (s.instrument !== undefined && !isInstrument(s.instrument)) ||
    !numberIn(s.tempo, 40, 200) ||
    !numberIn(s.duration, 0.25, 16) ||
    !numberIn(s.volume, 0, 1) ||
    !['ja', 'en'].includes(String(s.locale)) ||
    !['manual', 'root', 'smooth'].includes(String(s.policy)) ||
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
      !numberIn(e.duration, Number.MIN_VALUE, 16) ||
      !['manual', 'root', 'smooth'].includes(String(e.policy))
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
      !e.notes.every(
        (n) =>
          numberIn(n, EDITED_RANGE.low, EDITED_RANGE.high) &&
          Number.isInteger(n),
      ) ||
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
    if (e.intent !== undefined && !isGenerationIntent(e.intent, e.chord, e.key))
      throw new Error('Generation intent contradicts chord');
    if (e.modulation !== undefined) {
      const m = e.modulation;
      if (
        !object(m) ||
        !isKey(m.from) ||
        !isKey(m.to) ||
        !['pivot', 'direct'].includes(String(m.method)) ||
        !['departure', 'pivot', 'dominant', 'arrival', 'cadence'].includes(
          String(m.role),
        ) ||
        !sameKey(
          e.key,
          ['arrival', 'cadence'].includes(String(m.role)) ? m.to : m.from,
        ) ||
        (m.role === 'pivot' &&
          (m.method !== 'pivot' ||
            !commonChords(m.from, m.to, tones(e.chord).length === 4).some((c) =>
              sameChord(c, e.chord as Harmony),
            )))
      )
        throw new Error('Invalid modulation intent');
    }
    let melody: MelodyNote[] | undefined;
    if (e.melody !== undefined) {
      if (!Array.isArray(e.melody) || e.melody.length > 128)
        throw new Error('Invalid melody');
      let end = 0;
      melody = e.melody.map((n: unknown) => {
        if (
          !object(n) ||
          !numberIn(n.beat, 0, e.duration as number) ||
          !numberIn(n.duration, Number.MIN_VALUE, e.duration as number) ||
          n.beat + n.duration > (e.duration as number) + 1e-7 ||
          n.beat < end - 1e-7 ||
          !(
            n.midi === null ||
            (numberIn(n.midi, 48, 96) && Number.isInteger(n.midi))
          ) ||
          (n.midi === null
            ? n.pitch !== null
            : !isPitch(n.pitch) || pc(n.pitch) !== n.midi % 12) ||
          !['chord', 'scale', 'chromatic', 'rest'].includes(String(n.kind)) ||
          !(
            n.ornament === null ||
            ['passing', 'approach'].includes(String(n.ornament))
          )
        )
          throw new Error('Invalid melody note');
        end = n.beat + n.duration;
        if (
          n.kind !==
          melodyKind(n.midi as number | null, e as unknown as ChordEvent)
        )
          throw new Error('Contradictory melody category');
        return structuredClone(n) as unknown as MelodyNote;
      });
    }
    if (
      e.live !== undefined &&
      (!object(e.live) ||
        !numberIn(e.live.appliedBeat, 0, 1e9) ||
        !(
          e.live.requestedBeat === null ||
          numberIn(e.live.requestedBeat, 0, e.live.appliedBeat)
        ))
    )
      throw new Error('Invalid live timing');
    return {
      id: e.id,
      key: e.key,
      chord: e.chord,
      duration: e.duration,
      bass: e.bass as number | null,
      policy: e.policy as VoicingPolicy,
      notes,
      ...(melody === undefined ? {} : { melody }),
      ...(e.live === undefined
        ? {}
        : { live: structuredClone(e.live) as ChordEvent['live'] }),
      ...(e.modulation === undefined
        ? {}
        : { modulation: structuredClone(e.modulation) as ModulationIntent }),
      ...(e.intent === undefined
        ? {}
        : { intent: e.intent as GenerationIntent }),
    };
  });
  if (value.schemaVersion === 3 || value.schemaVersion === 4) {
    const expected = keyEventsFor(events);
    if (
      !Array.isArray(value.keyEvents) ||
      value.keyEvents.length !== expected.length ||
      value.keyEvents.some(
        (k: unknown, i: number) =>
          !object(k) ||
          !isKey(k.key) ||
          k.eventId !== expected[i].eventId ||
          k.beat !== expected[i].beat ||
          !sameKey(k.key, expected[i].key) ||
          k.intent !== expected[i].intent,
      )
    )
      throw new Error('Key events contradict timeline');
  }
  if (events.reduce((n, e) => n + (e.melody?.length ?? 0), 0) > 32768)
    throw new Error('Too many melody notes');
  const analyzed = analyzeMelody(events);
  for (let i = 0; i < events.length; i++)
    for (let j = 0; j < (events[i].melody?.length ?? 0); j++) {
      const note = events[i].melody![j];
      if (
        note.ornament !== null &&
        note.ornament !== analyzed[i].melody![j].ornament
      )
        throw new Error('Unsubstantiated melody ornament');
    }
  let generation: Session['generation'] = null;
  if (value.schemaVersion !== 1 && value.generation !== null) {
    const g = value.generation;
    if (
      !object(g) ||
      !object(g.options) ||
      !isGeneratorSettings(g.options) ||
      !isKey(g.options.key) ||
      !['manual', 'root', 'smooth'].includes(String(g.options.policy)) ||
      !numberIn(g.phrase, 0, Number.MAX_SAFE_INTEGER) ||
      !Number.isSafeInteger(g.phrase) ||
      !(
        g.fallback === null ||
        ['shortPhrase', 'constraints'].includes(String(g.fallback))
      ) ||
      typeof g.modified !== 'boolean'
    )
      throw new Error('Invalid generation record');
    generation = structuredClone(g) as unknown as NonNullable<
      Session['generation']
    >;
    if (!generation.modified) {
      const expected = generateProgression(
        generation.options,
        generation.phrase,
      );
      if (
        generation.fallback !== expected.record.fallback ||
        events.length !== expected.events.length ||
        events.some((event, i) => {
          const original = expected.events[i];
          return (
            event.id !== original.id ||
            event.duration !== original.duration ||
            event.bass !== original.bass ||
            event.policy !== original.policy ||
            pitchName(event.key.tonic) !== pitchName(original.key.tonic) ||
            event.key.mode !== original.key.mode ||
            pitchName(event.chord.root) !== pitchName(original.chord.root) ||
            event.chord.quality !== original.chord.quality ||
            event.notes.join() !== original.notes.join() ||
            event.intent?.purpose !== original.intent.purpose
          );
        })
      )
        throw new Error(
          'Unedited generation does not match its seed and settings',
        );
    }
  }
  return {
    schemaVersion: 4,
    revision: 0,
    settings: {
      melody:
        value.schemaVersion === 4
          ? (structuredClone(s.melody) as MelodySettings)
          : defaultMelody(),
      generator:
        value.schemaVersion === 1
          ? defaultGenerator()
          : (structuredClone(s.generator) as GeneratorSettings),
      instrument: isInstrument(s.instrument)
        ? s.instrument
        : DEFAULT_INSTRUMENT,
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
    keyEvents: keyEventsFor(events),
    generation,
  };
}
export function keyFromName(name: string, mode: Key['mode']): Key {
  return { tonic: parsePitch(name), mode };
}
export function exportSession(session: Session) {
  return JSON.stringify(session, null, 2);
}
export const STORAGE_KEY = 'chordscape.session.v4';
export function loadSession(): { session: Session; failed: boolean } {
  try {
    const text =
      localStorage.getItem(STORAGE_KEY) ??
      localStorage.getItem('chordscape.session.v3') ??
      localStorage.getItem('chordscape.session.v2') ??
      localStorage.getItem('chordscape.session.v1');
    return {
      session: text ? importSession(text) : newSession(),
      failed: false,
    };
  } catch {
    return { session: newSession(), failed: true };
  }
}
