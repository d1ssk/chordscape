import * as Tone from 'tone';
export class AudioEngine {
  private synth?: Tone.PolySynth;
  private timeout?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private disposed = false;
  private volume = 0.5;
  private createSynth() {
    const synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.015, decay: 0.2, sustain: 0.3, release: 0.035 },
    }).toDestination();
    synth.maxPolyphony = 12;
    synth.volume.value = this.volume === 0 ? -Infinity : -30 + this.volume * 20;
    this.synth = synth;
  }
  async unlock() {
    await Tone.start();
    if (this.disposed) return false;
    if (!this.synth) this.createSynth();
    return Tone.getContext().state === 'running';
  }
  setVolume(value: number) {
    this.volume = value;
    if (this.synth)
      this.synth.volume.value = value === 0 ? -Infinity : -30 + value * 20;
  }
  audition(notes: number[], ended: () => void) {
    this.stop();
    if (this.disposed || Tone.getContext().state !== 'running') {
      ended();
      return;
    }
    this.createSynth();
    this.synth!.triggerAttackRelease(
      notes.map((n) => Tone.Frequency(n, 'midi').toFrequency()),
      1,
      Tone.now(),
    );
    const generation = this.generation;
    this.timeout = setTimeout(() => {
      if (generation === this.generation) ended();
    }, 1050);
  }
  stop() {
    this.generation++;
    clearTimeout(this.timeout);
    this.synth?.releaseAll(Tone.immediate());
    this.synth?.dispose();
    this.synth = undefined;
  }
  dispose() {
    this.disposed = true;
    this.stop();
    this.synth?.dispose();
    this.synth = undefined;
  }
}
