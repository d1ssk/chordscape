import type { Key } from '../music/harmony';
import type { ChordEvent } from '../state/session';
import type { MelodyNote } from '../music/melody';
import type { LiveState } from './live';
export interface AudioPort {
  now(): number;
  schedule(event: ChordEvent, time: number, durationSeconds: number): void;
  scheduleMelody?(
    note: MelodyNote,
    time: number,
    durationSeconds: number,
  ): void;
  cancel(): void;
}
export interface PlaybackState {
  melody?: MelodyNote | null;
  live?: LiveState;
  key?: Key | null;
  status: 'stopped' | 'playing' | 'paused';
  beat: number;
  event: ChordEvent | null;
  next: ChordEvent | null;
  previous?: ChordEvent | null;
  cycle?: number;
}
interface Cycle {
  index: number;
  start: number;
  end: number;
  events: ChordEvent[];
  total: number;
}
interface Slot {
  event: ChordEvent;
  melody?: MelodyNote;
  start: number;
  end: number;
}
export class Scheduler {
  private cycles: Cycle[] = [];
  private slots: Slot[] = [];
  private tempo = 90;
  private loop = false;
  private source: (index: number) => ChordEvent[] = () => [];
  private peek?: (index: number) => ChordEvent[];
  private cycleIndex = 0;
  private snapshot: ChordEvent[] = [];
  private resumeBeat = 0;
  private anchor = 0;
  state: PlaybackState = {
    status: 'stopped',
    beat: 0,
    event: null,
    next: null,
  };
  constructor(
    private port: AudioPort,
    private notify: (state: PlaybackState) => void,
  ) {}
  private emit(state: PlaybackState) {
    this.state = state;
    this.notify(state);
  }
  private addCycle(events: ChordEvent[], start: number, offset = 0, index = 0) {
    const seconds = 60 / this.tempo;
    const total = events.reduce((sum, e) => sum + e.duration, 0);
    const cycle = {
      index,
      events: structuredClone(events),
      start,
      end: start + total * seconds,
      total,
    };
    this.cycles.push(cycle);
    let beat = 0;
    for (const event of cycle.events) {
      const end = beat + event.duration;
      if (end > offset)
        this.slots.push({
          event,
          start: start + Math.max(beat, offset) * seconds,
          end: start + end * seconds,
        });
      for (const note of event.melody ?? []) {
        const noteStart = beat + note.beat;
        const noteEnd = noteStart + note.duration;
        if (note.midi !== null && noteEnd > offset)
          this.slots.push({
            event,
            melody: note,
            start: start + Math.max(noteStart, offset) * seconds,
            end: start + noteEnd * seconds,
          });
      }
      beat = end;
    }
    this.slots.sort((a, b) => a.start - b.start);
    return cycle;
  }
  play(
    events: ChordEvent[],
    tempo: number,
    loop: boolean,
    source: (index: number) => ChordEvent[],
    beat = 0,
    cycleIndex = 0,
    peek?: (index: number) => ChordEvent[],
  ) {
    this.port.cancel();
    this.cycles = [];
    this.slots = [];
    this.tempo = tempo;
    this.loop = loop;
    this.source = source;
    this.peek = peek;
    this.cycleIndex = cycleIndex;
    if (!events.length) {
      this.stop();
      return;
    }
    this.snapshot = structuredClone(events);
    this.resumeBeat = beat;
    this.anchor = this.port.now() + 0.03;
    this.addCycle(events, this.anchor - (beat * 60) / tempo, beat, cycleIndex);
    this.emit({
      status: 'playing',
      beat,
      event: null,
      next: events[0],
      cycle: cycleIndex,
    });
    this.tick();
  }
  tick() {
    if (this.state.status !== 'playing') return;
    const now = this.port.now();
    const horizon = now + 0.12;
    let last = this.cycles.at(-1)!;
    if (this.loop && now > last.end + 0.12) {
      this.snapshot = last.events;
      this.cycleIndex = last.index;
      this.resumeBeat = 0;
      this.port.cancel();
      this.cycles = [];
      this.slots = [];
      this.emit({
        status: 'paused',
        beat: 0,
        event: null,
        next: null,
        cycle: last.index,
      });
      return;
    }
    let additions = 0;
    while (this.loop && last.end <= horizon) {
      if (++additions > 256) {
        this.stop();
        return;
      }
      const next = this.source(last.index + 1);
      if (next.length) last = this.addCycle(next, last.end, 0, last.index + 1);
      else this.loop = false;
    }
    // Missed a whole event after a long browser stall? Never burst stale notes.
    while (this.slots.length && this.slots[0].start <= horizon) {
      const slot = this.slots.shift()!;
      if (slot.end > now) {
        if (slot.melody)
          this.port.scheduleMelody?.(
            slot.melody,
            Math.max(slot.start, now),
            slot.end - Math.max(slot.start, now),
          );
        else
          this.port.schedule(
            slot.event,
            Math.max(slot.start, now),
            slot.end - Math.max(slot.start, now),
          );
      }
    }
    if (now >= last.end && !this.loop) {
      this.stop();
      return;
    }
    const cycle = this.cycles.find((c) => now < c.end) ?? last;
    const precedingCycle = this.cycles[this.cycles.indexOf(cycle) - 1];
    this.cycles = this.cycles.filter((c) => c.end > now || c === last);
    this.snapshot = cycle.events;
    this.cycleIndex = cycle.index;
    const beat = Math.max(
      this.resumeBeat && now < this.anchor ? this.resumeBeat : 0,
      Math.min(cycle.total, ((now - cycle.start) * this.tempo) / 60),
    );
    let cursor = 0;
    let event: ChordEvent | null = null;
    let next: ChordEvent | null = null;
    let previous: ChordEvent | null = null;
    let melody: MelodyNote | null = null;
    for (let i = 0; i < cycle.events.length; i++) {
      const e = cycle.events[i];
      if (beat >= cursor && beat < cursor + e.duration) {
        event = now >= this.anchor ? e : null;
        melody =
          event?.melody?.find(
            (n) =>
              n.midi !== null &&
              beat - cursor >= n.beat &&
              beat - cursor < n.beat + n.duration,
          ) ?? null;
        previous =
          cycle.events[i - 1] ??
          precedingCycle?.events.at(-1) ??
          (this.state.cycle === cycle.index
            ? (this.state.previous ?? null)
            : null);
        const nextCycle = this.cycles.find((c) => c.index === cycle.index + 1);
        next =
          cycle.events[i + 1] ??
          (this.loop
            ? (nextCycle?.events[0] ??
              (this.peek
                ? (this.peek(cycle.index + 1)[0] ?? null)
                : cycle.events[0]))
            : null);
        break;
      }
      cursor += e.duration;
    }
    this.emit({
      status: 'playing',
      beat,
      event,
      next,
      previous,
      melody,
      key: event?.key ?? this.state.key,
      cycle: cycle.index,
    });
  }
  pause() {
    if (this.state.status !== 'playing') return;
    this.tick();
    if (this.state.status !== 'playing') return;
    this.resumeBeat = this.state.beat;
    this.port.cancel();
    this.slots = [];
    this.cycles = [];
    this.emit({
      ...this.state,
      status: 'paused',
      event: null,
      next: null,
      melody: null,
    });
  }
  resume() {
    if (this.state.status === 'paused')
      this.play(
        this.snapshot,
        this.tempo,
        this.loop,
        this.source,
        this.resumeBeat,
        this.cycleIndex,
        this.peek,
      );
  }
  configure(tempo: number, loop: boolean) {
    if (tempo === this.tempo && loop === this.loop) return;
    if (this.state.status === 'playing') {
      this.pause();
      this.tempo = tempo;
      this.loop = loop;
      this.resume();
    } else {
      this.tempo = tempo;
      this.loop = loop;
    }
  }
  stop() {
    this.port.cancel();
    this.cycles = [];
    this.slots = [];
    this.resumeBeat = 0;
    this.emit({ status: 'stopped', beat: 0, event: null, next: null });
  }
}
