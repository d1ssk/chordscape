import * as Tone from 'tone';
import type { ChordEvent } from '../state/session';
import { Scheduler, type PlaybackState } from './scheduler';
interface Voice {
  synth: Tone.PolySynth;
  gate: Tone.Gain;
  end: number;
}
export class AudioEngine {
  private voices: Voice[] = [];
  private master?: Tone.Gain;
  private limiter?: Tone.Limiter;
  private analyser?: Tone.Analyser;
  private interval?: ReturnType<typeof setInterval>;
  private disposed = false;
  private volume = 0.5;
  private auditioning?: { event: ChordEvent; start: number; end: number };
  private playback: PlaybackState = {
    status: 'stopped',
    beat: 0,
    event: null,
    next: null,
  };
  private scheduler: Scheduler;
  constructor(
    private notify: (state: PlaybackState, level: number) => void,
    private ready: (ready: boolean) => void,
  ) {
    this.scheduler = new Scheduler(
      {
        now: () => Tone.immediate(),
        schedule: (event, time, duration) =>
          this.schedule(event, time, duration),
        cancel: () => this.cancel(),
      },
      (state) => {
        this.playback = state;
      },
    );
  }
  private contextChanged = () => {
    if (Tone.getContext().state !== 'running') {
      this.pause();
      this.ready(false);
    }
  };
  private visibilityChanged = () => {
    if (document.hidden) this.pause();
  };
  async unlock() {
    await Tone.start();
    if (this.disposed) return false;
    if (!this.master) {
      this.master = new Tone.Gain(this.volume);
      this.limiter = new Tone.Limiter(-3).toDestination();
      this.analyser = new Tone.Analyser('waveform', 256);
      this.master.connect(this.limiter);
      this.limiter.connect(this.analyser);
      Tone.getContext().on('statechange', this.contextChanged);
      document.addEventListener('visibilitychange', this.visibilityChanged);
      this.interval = setInterval(() => this.tick(), 25);
    }
    const running = Tone.getContext().state === 'running';
    this.ready(running);
    return running;
  }
  private schedule(event: ChordEvent, time: number, duration: number) {
    if (!this.master || this.disposed) return;
    const gate = new Tone.Gain(1).connect(this.master);
    const synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.012, decay: 0.2, sustain: 0.35, release: 0.018 },
    }).connect(gate);
    synth.maxPolyphony = 4;
    synth.volume.value = -17;
    synth.triggerAttackRelease(
      event.notes.map((n) => Tone.Frequency(n, 'midi').toFrequency()),
      Math.max(0.015, duration - 0.018),
      time,
    );
    this.voices.push({ synth, gate, end: time + duration + 0.025 });
    // Bounded even under extremely fast repeated pointer/keyboard input.
    while (this.voices.length > 8) {
      const old = this.voices.shift()!;
      old.synth.dispose();
      old.gate.dispose();
    }
  }
  private cancel() {
    const now = Tone.immediate();
    this.auditioning = undefined;
    for (const voice of this.voices) {
      voice.gate.gain.cancelScheduledValues(now);
      voice.gate.gain.setValueAtTime(voice.gate.gain.value, now);
      voice.gate.gain.linearRampToValueAtTime(0, now + 0.012);
      voice.end = Math.min(voice.end, now + 0.02);
    }
  }
  private tick() {
    const now = Tone.immediate();
    this.scheduler.tick();
    this.voices = this.voices.filter((voice) => {
      if (voice.end <= now) {
        voice.synth.dispose();
        voice.gate.dispose();
        return false;
      }
      return true;
    });
    let state = this.playback;
    if (this.auditioning) {
      const audition = this.auditioning;
      if (now >= audition.end) this.auditioning = undefined;
      state = {
        status: 'stopped',
        beat: 0,
        event:
          now >= audition.start && now < audition.end ? audition.event : null,
        next: now < audition.start ? audition.event : null,
      };
    }
    const waveform = this.analyser?.getValue();
    const level =
      Tone.getContext().state === 'running' && waveform instanceof Float32Array
        ? waveform.reduce((max, value) => Math.max(max, Math.abs(value)), 0)
        : 0;
    this.notify(state, level);
  }
  setVolume(value: number) {
    this.volume = value;
    if (this.master) this.master.gain.rampTo(value, 0.02);
  }
  audition(event: ChordEvent) {
    this.stop();
    if (!this.master || Tone.getContext().state !== 'running') return;
    const start = Tone.immediate() + 0.03;
    this.schedule(event, start, 1);
    this.auditioning = { event, start, end: start + 1 };
    this.tick();
  }
  play(
    events: ChordEvent[],
    tempo: number,
    loop: boolean,
    source: () => ChordEvent[],
  ) {
    this.scheduler.play(events, tempo, loop, source);
    this.tick();
  }
  pause() {
    this.scheduler.pause();
    this.cancel();
    this.tick();
  }
  resume() {
    this.scheduler.resume();
    this.tick();
  }
  configure(tempo: number, loop: boolean) {
    this.scheduler.configure(tempo, loop);
  }
  stop() {
    this.scheduler.stop();
    this.tick();
  }
  dispose() {
    this.disposed = true;
    clearInterval(this.interval);
    this.scheduler.stop();
    this.voices.forEach((v) => {
      v.synth.dispose();
      v.gate.dispose();
    });
    this.voices = [];
    if (this.master) {
      Tone.getContext().off('statechange', this.contextChanged);
      document.removeEventListener('visibilitychange', this.visibilityChanged);
    }
    this.master?.dispose();
    this.limiter?.dispose();
    this.analyser?.dispose();
  }
}
