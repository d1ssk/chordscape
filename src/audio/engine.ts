import { LiveScheduler } from './live';
import type { MelodyNote, MelodySettings } from '../music/melody';
import * as Tone from 'tone';
import type { ChordEvent } from '../state/session';
import { Scheduler, type PlaybackState } from './scheduler';
import { createNoteVoice, type NoteVoice } from './voices';
import {
  FALLBACK_INSTRUMENT,
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
  private chordBus?: GainNode;
  private melodyBus?: GainNode;
  private melodyEnabled = false;
  private melodyVolume = 0.65;
  private liveActive = false;
  private live: LiveScheduler;
  private highpass?: BiquadFilterNode;
  private samples = new Map<number, AudioBuffer>();
  private instrument: Instrument = FALLBACK_INSTRUMENT;
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
    const port = {
      now: () => Tone.immediate(),
      schedule: (event: ChordEvent, time: number, duration: number) =>
        this.schedule(event, time, duration),
      scheduleMelody: (note: MelodyNote, time: number, duration: number) =>
        this.scheduleMelody(note, time, duration),
      cancel: () => this.cancel(),
      cancelAt: (time: number) => {
        for (const voice of this.voices) voice.stop(time);
      },
    };
    this.scheduler = new Scheduler(port, (state) => {
      this.playback = state;
    });
    this.live = new LiveScheduler(port, (state) => {
      this.playback = state;
    });
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
      this.chordBus = Tone.getContext().createGain();
      this.melodyBus = Tone.getContext().createGain();
      this.chordBus.connect(this.bus);
      this.melodyBus.connect(this.bus);
      this.melodyBus.gain.value = this.melodyVolume;
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
      this.instrument = FALLBACK_INSTRUMENT;
      this.sound({ instrument: this.instrument, loading: false, failed: true });
    }
  }
  private schedule(event: ChordEvent, time: number, duration: number) {
    if (!this.chordBus || this.disposed) return;
    for (const note of event.notes)
      this.voices.push(
        createNoteVoice(
          Tone.getContext(),
          this.chordBus,
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
  private scheduleMelody(note: MelodyNote, time: number, duration: number) {
    if (
      !this.melodyEnabled ||
      !this.melodyBus ||
      this.disposed ||
      note.midi === null
    )
      return;
    this.voices.push(
      createNoteVoice(
        Tone.getContext(),
        this.melodyBus,
        'soft',
        note.midi,
        time,
        duration,
        this.samples,
      ),
    );
  }
  setMelody(settings: MelodySettings) {
    this.melodyEnabled = settings.enabled;
    this.melodyVolume = settings.volume;
    this.melodyBus?.gain.setTargetAtTime(
      settings.volume,
      Tone.immediate(),
      0.015,
    );
  }
  startLive(
    event: ChordEvent,
    tempo: number,
    settings: MelodySettings,
    record: boolean,
    capacity: number,
  ) {
    this.stop();
    this.liveActive = true;
    this.setMelody(settings);
    this.live.start(event, tempo, settings, record, capacity);
    this.tick();
  }
  changeLive(
    event: ChordEvent,
    timing: MelodySettings['timing'],
    record: boolean,
  ) {
    if (this.liveActive) {
      this.live.change(event, timing, record);
      this.tick();
    }
  }
  private cancel() {
    this.auditioning = undefined;
    const now = Tone.immediate();
    for (const voice of this.voices) voice.stop(now);
  }
  private tick() {
    const now = Tone.immediate();
    if (this.liveActive) this.live.tick();
    else this.scheduler.tick();
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
    if (this.liveActive) this.stop();
    this.scheduler.play(events, tempo, loop, source, 0, cycle, peek);
    this.tick();
  }
  pause() {
    if (this.liveActive) this.live.pause();
    else this.scheduler.pause();
    this.cancel();
    this.tick();
  }
  resume() {
    if (this.liveActive) this.live.resume();
    else this.scheduler.resume();
    this.tick();
  }
  configure(tempo: number, loop: boolean) {
    if (this.liveActive) this.live.configure(tempo);
    else this.scheduler.configure(tempo, loop);
  }
  stop() {
    this.scheduler.stop();
    if (this.liveActive) this.live.stop();
    this.liveActive = false;
    this.tick();
  }
  dispose() {
    this.disposed = true;
    this.soundRequest++;
    this.abort.abort();
    clearInterval(this.interval);
    this.scheduler.stop();
    if (this.liveActive) this.live.stop();
    this.liveActive = false;
    this.voices.forEach((v) => {
      v.dispose();
    });
    this.voices = [];
    if (this.master) {
      Tone.getContext().off('statechange', this.contextChanged);
      document.removeEventListener('visibilitychange', this.visibilityChanged);
    }
    this.chordBus?.disconnect();
    this.melodyBus?.disconnect();
    this.bus?.disconnect();
    this.highpass?.disconnect();
    this.samples.clear();
    this.master?.dispose();
    this.limiter?.dispose();
    this.analyser?.dispose();
  }
}
