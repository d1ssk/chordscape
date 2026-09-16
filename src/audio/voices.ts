import type { Instrument } from './instruments';
export type VoiceContext = Pick<
  BaseAudioContext,
  | 'createOscillator'
  | 'createBufferSource'
  | 'createGain'
  | 'createPeriodicWave'
>;
export interface NoteVoice {
  end: number;
  stop(now: number): void;
  dispose(): void;
}
// Each source starts at its final frequency. No pitch ramps, sub-oscillators,
// distortion, or random detuning; all envelopes and stops use the audio clock.
export function createNoteVoice(
  context: VoiceContext,
  output: AudioNode,
  instrument: Instrument,
  midi: number,
  time: number,
  duration: number,
  samples: Map<number, AudioBuffer>,
): NoteVoice {
  const frequency = 440 * 2 ** ((midi - 69) / 12);
  const gate = context.createGain();
  gate.gain.value = 0;
  const cutoff = context.createGain();
  gate.connect(cutoff);
  cutoff.connect(output);
  const nodes: AudioNode[] = [gate, cutoff];
  const sources: AudioScheduledSourceNode[] = [];
  if (instrument === 'piano') {
    const sampled = [...samples.keys()].reduce((best, n) =>
      Math.abs(n - midi) < Math.abs(best - midi) ? n : best,
    );
    const source = context.createBufferSource();
    source.buffer = samples.get(sampled)!;
    source.playbackRate.value = 2 ** ((midi - sampled) / 12);
    source.connect(gate);
    sources.push(source);
  } else {
    const oscillator = context.createOscillator();
    oscillator.frequency.value = frequency;
    if (instrument === 'electric') {
      oscillator.type = 'sine';
      const modulator = context.createOscillator();
      modulator.frequency.value = frequency * 2;
      const depth = context.createGain();
      depth.gain.setValueAtTime(frequency * 1.15, time);
      depth.gain.exponentialRampToValueAtTime(frequency * 0.035, time + 0.7);
      modulator.connect(depth);
      depth.connect(oscillator.frequency);
      nodes.push(depth);
      sources.push(modulator);
    } else {
      const partials =
        instrument === 'pad' ? [0, 1, 0.35, 0.14, 0.06] : [0, 1, 0.3, 0.1];
      oscillator.setPeriodicWave(
        context.createPeriodicWave(
          new Float32Array(partials.length),
          new Float32Array(partials),
        ),
      );
    }
    oscillator.connect(gate);
    sources.push(oscillator);
  }
  const attack = Math.min(
    instrument === 'pad' ? 0.14 : instrument === 'piano' ? 0.008 : 0.025,
    duration * 0.25,
  );
  const release = Math.min(instrument === 'pad' ? 0.09 : 0.04, duration * 0.3);
  const peak =
    instrument === 'piano' ? 0.48 : instrument === 'electric' ? 0.13 : 0.095;
  const sustain =
    instrument === 'electric'
      ? peak * 0.27
      : instrument === 'soft'
        ? peak * 0.7
        : peak;
  const decayEnd = Math.min(time + attack + 0.7, time + duration - release);
  gate.gain.setValueAtTime(0, time);
  gate.gain.linearRampToValueAtTime(peak, time + attack);
  gate.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain), decayEnd);
  gate.gain.setValueAtTime(sustain, time + duration - release);
  gate.gain.linearRampToValueAtTime(0, time + duration);
  for (const source of sources) {
    source.start(time);
    source.stop(time + duration + 0.005);
    nodes.push(source);
  }
  let stopped = false;
  let disposed = false;
  const voice: NoteVoice = {
    end: time + duration + 0.01,
    stop(now) {
      if (stopped || disposed) return;
      stopped = true;
      // A future source never starts. A sounding source fades out in 18ms.
      const end =
        now < time || now >= time + duration
          ? now
          : Math.min(now + 0.018, time + duration);
      // Keep the timbre envelope intact. A separate unity gain avoids jumps
      // from replacing an in-progress exponential ramp with a stop ramp.
      cutoff.gain.setValueAtTime(1, now);
      cutoff.gain.linearRampToValueAtTime(0, end);
      for (const source of sources) source.stop(end);
      voice.end = end + 0.005;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const node of nodes) node.disconnect();
    },
  };
  return voice;
}
