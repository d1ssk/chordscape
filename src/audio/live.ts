import type { ChordEvent } from '../state/session';
import {
  analyzeMelody,
  captureMelody,
  generateMelody,
  type MelodySettings,
} from '../music/melody';
import type { AudioPort, PlaybackState } from './scheduler';

export interface LiveState {
  pending: ChordEvent | null;
  pendingBeat: number | null;
  phraseBeat: number;
  recorded: ChordEvent[];
  recordVersion: number;
  limit: boolean;
}
interface Plan {
  event: ChordEvent;
  from: number;
  to: number;
  requested: number | null;
  record: boolean;
  applied: boolean;
  chordScheduled: boolean;
  noteIndex: number;
}
export interface LivePort extends AudioPort {
  cancelAt(time: number): void;
}
// Live owns only the current harmony and a replaceable next-beat choice.
// It shares the audio port with Timeline; AudioEngine activates just one.
export class LiveScheduler {
  private plans: Plan[] = [];
  private anchor = 0;
  private notBefore = 0;
  private minBeat = 0;
  private tempo = 90;
  private beat = 0;
  private recording?: {
    event: ChordEvent;
    from: number;
    phase: number;
    requested: number | null;
  };
  private recorded: ChordEvent[] = [];
  private version = 0;
  private limit = false;
  private capacity = 256;
  private settings!: MelodySettings;
  state: PlaybackState = {
    status: 'stopped',
    beat: 0,
    event: null,
    next: null,
  };
  constructor(
    private port: LivePort,
    private notify: (state: PlaybackState) => void,
  ) {}
  private time(beat: number) {
    return this.anchor + (beat * 60) / this.tempo;
  }
  private position() {
    return Math.max(
      this.minBeat,
      ((this.port.now() - this.anchor) * this.tempo) / 60,
    );
  }
  private plan(
    event: ChordEvent,
    from: number,
    requested: number | null,
    record: boolean,
  ): Plan {
    const prepared = this.settings.enabled
      ? generateMelody(
          [{ ...event, duration: 8 }],
          this.settings,
          true,
          this.state.melody?.midi ?? undefined,
        )[0]
      : { ...event, duration: 8, melody: [] };
    return {
      event: prepared,
      from,
      to: from + 8,
      requested,
      record,
      applied: false,
      chordScheduled: false,
      noteIndex: 0,
    };
  }
  start(
    event: ChordEvent,
    tempo: number,
    settings: MelodySettings,
    record: boolean,
    capacity = 256,
  ) {
    this.port.cancel();
    this.tempo = tempo;
    this.settings = structuredClone(settings);
    this.capacity = capacity;
    this.anchor = this.port.now() + 0.03;
    this.notBefore = this.anchor;
    this.minBeat = 0;
    this.beat = 0;
    this.recorded = [];
    this.recording = undefined;
    this.version++;
    this.limit = false;
    this.plans = [this.plan(event, 0, 0, record)];
    this.state = { status: 'playing', beat: 0, event: null, next: event };
    this.tick();
  }
  change(event: ChordEvent, timing: MelodySettings['timing'], record: boolean) {
    if (this.state.status !== 'playing') return;
    this.tick();
    if (this.state.status !== 'playing') return;
    const requested = this.position();
    const from =
      timing === 'nextBeat' ? Math.floor(requested + 1e-9) + 1 : requested;
    this.port.cancelAt(this.time(from));
    this.plans = this.plans.filter((p) => p.from < from);
    for (const p of this.plans) p.to = Math.min(p.to, from);
    this.plans.push(this.plan(event, from, requested, record));
    this.tick();
  }
  private capture(end: number) {
    const recording = this.recording;
    if (!recording || end <= recording.from + 1e-9) return;
    for (let from = recording.from; from < end - 1e-9; from += 16) {
      if (this.recorded.length >= this.capacity) {
        this.limit = true;
        break;
      }
      const duration = Math.min(16, end - from);
      const event = {
        ...recording.event,
        id: `${recording.event.id}-${this.recorded.length}`,
        duration,
        live: { appliedBeat: from, requestedBeat: recording.requested },
        melody: captureMelody(
          recording.event.melody ?? [],
          8,
          from - recording.phase,
          duration,
        ),
      };
      this.recorded.push(analyzeMelody([event], true)[0]);
    }
    this.recording = undefined;
    this.version++;
  }
  tick() {
    if (this.state.status !== 'playing') return;
    const now = this.port.now(),
      beat = this.position(),
      horizon = beat + (0.12 * this.tempo) / 60;
    this.beat = beat;
    const last = this.plans.at(-1)!;
    if (beat > last.to + (0.12 * this.tempo) / 60) {
      this.plans = [
        {
          ...last,
          from: last.to,
          to: last.to + 8,
          applied: true,
          chordScheduled: false,
          noteIndex: 0,
        },
      ];
      this.pauseAt(last.to);
      return;
    }
    if (last.to <= horizon) {
      const repeated = {
        ...last,
        from: last.to,
        to: last.to + 8,
        applied: true,
        chordScheduled: false,
        noteIndex: 0,
      };
      this.plans.push(repeated);
    }
    for (const p of this.plans) {
      if (!p.applied && now >= this.time(p.from)) {
        this.capture(p.from);
        p.applied = true;
        if (p.record)
          this.recording = {
            event: p.event,
            from: p.from,
            phase: p.from,
            requested: p.requested,
          };
      }
      if (p.from > horizon || p.to <= beat) continue;
      if (!p.chordScheduled) {
        p.chordScheduled = true;
        const start = Math.max(now, this.notBefore, this.time(p.from));
        this.port.schedule(p.event, start, this.time(p.to) - start);
      }
      const notes = p.event.melody ?? [];
      while (
        p.noteIndex < notes.length &&
        p.from + notes[p.noteIndex].beat <= horizon
      ) {
        const note = notes[p.noteIndex++];
        const start = Math.max(
          now,
          this.notBefore,
          this.time(p.from + note.beat),
        );
        const end = this.time(
          Math.min(p.to, p.from + note.beat + note.duration),
        );
        if (note.midi !== null && end > start)
          this.port.scheduleMelody?.(note, start, end - start);
      }
    }
    const active = this.plans.find(
      (p) => p.from <= beat && p.to > beat && now >= this.notBefore,
    );
    const pending = this.plans.find((p) => !p.applied);
    this.plans = this.plans.filter((p) => p.to > beat);
    const phraseBeat = active ? beat - active.from : 0;
    const melody =
      active?.event.melody?.find(
        (n) =>
          n.midi !== null &&
          n.beat <= phraseBeat &&
          n.beat + n.duration > phraseBeat,
      ) ?? null;
    this.state = {
      status: 'playing',
      beat,
      event: active?.event ?? null,
      next: pending?.event ?? null,
      melody,
      key: active?.event.key ?? this.state.key,
      live: {
        pending: pending?.event ?? null,
        pendingBeat: pending?.from ?? null,
        phraseBeat,
        recorded: this.recorded,
        recordVersion: this.version,
        limit: this.limit,
      },
    };
    this.notify(this.state);
  }
  private pauseAt(beat: number) {
    this.beat = beat;
    this.capture(beat);
    this.port.cancel();
    this.state = {
      ...this.state,
      status: 'paused',
      beat,
      event: null,
      melody: null,
      live: {
        ...this.state.live!,
        recorded: this.recorded,
        recordVersion: this.version,
        limit: this.limit,
      },
    };
    this.notify(this.state);
  }
  pause() {
    if (this.state.status === 'playing') {
      this.tick();
      if (this.state.status === 'playing') this.pauseAt(this.beat);
    }
  }
  resume() {
    if (this.state.status !== 'paused') return;
    this.notBefore = this.port.now() + 0.03;
    this.minBeat = this.beat;
    this.anchor = this.notBefore - (this.beat * 60) / this.tempo;
    const active = this.plans.find(
      (p) => p.from <= this.beat && p.to > this.beat,
    );
    if (!active) {
      this.stop();
      return;
    }
    if (active.record)
      this.recording = {
        event: active.event,
        from: this.beat,
        phase: active.from,
        requested: null,
      };
    for (const p of this.plans) {
      p.chordScheduled = false;
      p.noteIndex = 0;
    }
    this.state = { ...this.state, status: 'playing' };
    this.tick();
  }
  configure(tempo: number) {
    if (tempo === this.tempo) return;
    const playing = this.state.status === 'playing';
    if (playing) this.pause();
    this.tempo = tempo;
    if (playing) this.resume();
  }
  stop() {
    if (this.state.status === 'playing') {
      this.tick();
      this.capture(this.beat);
    }
    this.port.cancel();
    this.plans = [];
    this.state = {
      status: 'stopped',
      beat: 0,
      event: null,
      next: null,
      melody: null,
      live: {
        pending: null,
        pendingBeat: null,
        phraseBeat: 0,
        recorded: this.recorded,
        recordVersion: this.version,
        limit: this.limit,
      },
    };
    this.notify(this.state);
  }
}
