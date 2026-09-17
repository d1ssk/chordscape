import {
  diatonic,
  outside,
  parsePitch,
  pc,
  pitchName,
  scale,
  spell,
  tones,
  transposeKey,
  type Harmony,
  type Key,
} from './harmony';
import { optimizeVoicings, type VoicingPolicy } from './voicing';
import type { ChordEvent } from '../state/session';

export const sameKey = (a: Key, b: Key) =>
  a.mode === b.mode && pitchName(a.tonic) === pitchName(b.tonic);
export const equivalentKey = (a: Key, b: Key) =>
  a.mode === b.mode && pc(a.tonic) === pc(b.tonic);
export function circleKeys(flats = false): { major: Key; minor: Key }[] {
  const names = flats
    ? ['C', 'G', 'D', 'A', 'E', 'C♭', 'G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F']
    : ['C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯', 'A♭', 'E♭', 'B♭', 'F'];
  return names.map((name) => {
    const major: Key = { tonic: parsePitch(name), mode: 'major' };
    return { major, minor: { tonic: scale(major)[5], mode: 'minor' } };
  });
}
export function sameChord(a: Harmony, b: Harmony) {
  return (
    pc(a.root) === pc(b.root) &&
    a.quality === b.quality &&
    tones(a).map(pc).sort().join() === tones(b).map(pc).sort().join()
  );
}
export function commonChords(from: Key, to: Key, seventh = false): Harmony[] {
  const target = diatonic(to, seventh);
  return diatonic(from, seventh).filter((chord) =>
    target.some((other) => sameChord(chord, other)),
  );
}
// An enharmonic pivot can have two legitimate names. Each analysis uses
// its context's spelling without changing the performed pitch classes.
export function chordInKey(chord: Harmony, key: Key): Harmony {
  return (
    [...diatonic(key), ...diatonic(key, true), ...outside(key)].find(
      (candidate) => sameChord(candidate, chord),
    ) ?? chord
  );
}
export function sharedTones(from: Key, to: Key) {
  const target = scale(to);
  return scale(from).flatMap((p) => {
    const other = target.find((q) => pc(p) === pc(q));
    return other ? [{ from: p, to: other }] : [];
  });
}
export interface ModulationIntent {
  from: Key;
  to: Key;
  method: 'pivot' | 'direct';
  role: 'departure' | 'pivot' | 'dominant' | 'arrival' | 'cadence';
}
export interface KeyEvent {
  eventId: string;
  beat: number;
  key: Key;
  intent: 'initial' | 'selection' | 'pivot' | 'direct';
}
// Event IDs anchor boundaries. Reordering/deleting/duration edits derive new
// beat positions and transitions from the retained event contexts atomically.
export function keyEventsFor(events: ChordEvent[]): KeyEvent[] {
  let beat = 0;
  return events.flatMap((event, i) => {
    const changes = i === 0 || !sameKey(events[i - 1].key, event.key);
    const result: KeyEvent[] = changes
      ? [
          {
            eventId: event.id,
            beat,
            key: event.key,
            intent:
              i === 0
                ? 'initial'
                : event.modulation && sameKey(event.key, event.modulation.to)
                  ? event.modulation.method
                  : 'selection',
          },
        ]
      : [];
    beat += event.duration;
    return result;
  });
}
export interface BridgeOptions {
  from: Key;
  to: Key;
  duration: number;
  seventh: boolean;
  policy: VoicingPolicy;
  cadence: boolean;
}
export function buildBridge(
  options: BridgeOptions,
  prefix = 'bridge',
): ChordEvent[] {
  const { from, to, duration, seventh, policy, cadence } = options;
  if (equivalentKey(from, to)) return [];
  const shared = commonChords(from, to, seventh);
  const target = diatonic(to, seventh);
  // Prefer a predominant in the destination; other common chords are valid
  // candidates but are not asserted to guarantee an audible modulation.
  const pivot = [target[1], target[3], target[5], ...target].find((chord) =>
    shared.some((other) => sameChord(chord, other)),
  );
  const method = pivot ? 'pivot' : 'direct';
  const dominant: Harmony = { root: spell(to.tonic, 4, 7), quality: '7' };
  const pairs: { chord: Harmony; key: Key; role: ModulationIntent['role'] }[] =
    [
      { chord: diatonic(from, seventh)[0], key: from, role: 'departure' },
      ...(pivot ? [{ chord: pivot, key: from, role: 'pivot' as const }] : []),
      { chord: dominant, key: from, role: 'dominant' },
      { chord: target[0], key: to, role: 'arrival' },
      ...(cadence
        ? [
            { chord: target[3], key: to, role: 'cadence' as const },
            { chord: dominant, key: to, role: 'cadence' as const },
            { chord: target[0], key: to, role: 'cadence' as const },
          ]
        : []),
    ];
  const inputs = pairs.map((p) => ({
    ...p,
    // Applied dominants keep the destination's spelling; palette choices in
    // the departure key must not respell C♯7 → F♯ as D♭7 → F♯.
    chord: p.role === 'dominant' ? p.chord : chordInKey(p.chord, p.key),
    bass: null,
    policy,
  }));
  const notes = optimizeVoicings(inputs, false);
  return inputs.map((p, i) => ({
    id: `${prefix}-${i}`,
    chord: p.chord,
    key: p.key,
    duration,
    bass: null,
    policy,
    notes: notes[i],
    modulation: { from, to, method, role: p.role },
  }));
}
// One complete, closed circuit is finite and reviewable; ordinary timeline
// looping makes travel continuous without another audio scheduler.
export function buildCircleTravel(
  options: Omit<BridgeOptions, 'to'>,
  direction: 1 | -1,
  prefix = 'travel',
): ChordEvent[] {
  let from = options.from;
  const events: ChordEvent[] = [];
  for (let i = 0; i < 12; i++) {
    const to = i === 11 ? options.from : transposeKey(from, direction * 7);
    const bridge = buildBridge({ ...options, from, to }, `${prefix}-${i}`);
    events.push(...(i === 0 ? bridge : bridge.slice(1)));
    from = to;
  }
  const notes = optimizeVoicings(events, true);
  return events.map((e, i) => ({ ...e, notes: notes[i] }));
}
