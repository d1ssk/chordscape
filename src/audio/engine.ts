import * as Tone from 'tone';
import type { ChordEvent } from '../state/session';
import { Scheduler, type PlaybackState } from './scheduler';
import { createNoteVoice, type NoteVoice } from './voices';
import {
  DEFAULT_INSTRUMENT,
  PIANO_NOTES,
  pianoFile,
  type Instrument,
} from './instruments';
export interface SoundState {
  instrument: Instrument;
  loading: boolean;
  failed: boolean;
}
export class AudioEngine {
  private voices: NoteVoice[] = [];
  private bus?: GainNode;
  private highpass?: BiquadFilterNode;
  private samples = new Map<number, AudioBuffer>();
  private instrument: Instrument = DEFAULT_INSTRUMENT;
  private soundRequest = 0;
  private sampleLoad?: Promise<void>;
  private abort = new AbortController();
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
    private sound: (state: SoundState) => void,
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
      this.bus = Tone.getContext().createGain();
      this.highpass = Tone.getContext().createBiquadFilter();
      this.highpass.type = 'highpass';
      this.highpass.frequency.value = 35;
      this.highpass.Q.value = 0.5;
      this.bus.connect(this.highpass);
      Tone.connect(this.highpass, this.master);
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
  async setInstrument(instrument: Instrument) {
    if (
      instrument === this.instrument &&
      (instrument !== 'piano' || this.samples.size)
    ) {
      this.soundRequest++;
      this.sound({ instrument, loading: false, failed: false });
      return;
    }
    const request = ++this.soundRequest;
    this.stop();
    this.sound({
      instrument: this.instrument,
      loading: instrument === 'piano' && !this.samples.size,
      failed: false,
    });
    try {
      if (instrument === 'piano' && !this.samples.size) {
        this.sampleLoad ??= Promise.all(
          PIANO_NOTES.map(async (midi) => {
            const response = await fetch(
              `${import.meta.env.BASE_URL}samples/salamander/${pianoFile(midi)}`,
              {
                signal: AbortSignal.any([
                  this.abort.signal,
                  AbortSignal.timeout(12000),
                ]),
              },
            );
            if (!response.ok) throw new Error('Piano sample unavailable');
            return [
              midi,
              await Tone.getContext().decodeAudioData(
                await response.arrayBuffer(),
              ),
            ] as const;
          }),
        )
          .then((entries) => {
            if (!this.disposed) this.samples = new Map(entries);
          })
          .catch((error) => {
            this.sampleLoad = undefined;
            throw error;
          });
        await this.sampleLoad;
      }
      if (this.disposed || request !== this.soundRequest) return;
      this.instrument = instrument;
      this.sound({ instrument, loading: false, failed: false });
    } catch {
      if (this.disposed || request !== this.soundRequest) return;
      this.instrument = DEFAULT_INSTRUMENT;
      this.sound({ instrument: this.instrument, loading: false, failed: true });
    }
  }
  private schedule(event: ChordEvent, time: number, duration: number) {
    if (!this.bus || this.disposed) return;
    for (const note of event.notes)
      this.voices.push(
        createNoteVoice(
          Tone.getContext(),
          this.bus,
          this.instrument,
          note,
          time,
          duration,
          this.samples,
        ),
      );
    while (this.voices.length > 48) {
      const voice = this.voices.shift()!;
      voice.stop(Tone.immediate());
      voice.dispose();
    }
  }
  private cancel() {
    this.auditioning = undefined;
    const now = Tone.immediate();
    for (const voice of this.voices) voice.stop(now);
  }
  private tick() {
    const now = Tone.immediate();
    this.scheduler.tick();
    this.voices = this.voices.filter((voice) => {
      if (voice.end <= now) {
        voice.dispose();
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
    source: (index: number) => ChordEvent[],
    cycle = 0,
    peek?: (index: number) => ChordEvent[],
  ) {
    this.scheduler.play(events, tempo, loop, source, 0, cycle, peek);
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
    this.soundRequest++;
    this.abort.abort();
    clearInterval(this.interval);
    this.scheduler.stop();
    this.voices.forEach((v) => {
      v.dispose();
    });
    this.voices = [];
    if (this.master) {
      Tone.getContext().off('statechange', this.contextChanged);
      document.removeEventListener('visibilitychange', this.visibilityChanged);
    }
    this.bus?.disconnect();
    this.highpass?.disconnect();
    this.samples.clear();
    this.master?.dispose();
    this.limiter?.dispose();
    this.analyser?.dispose();
  }
}
