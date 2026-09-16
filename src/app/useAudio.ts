import { useEffect, useRef, useState } from 'react';
import { DEFAULT_INSTRUMENT } from '../audio/instruments';
import { AudioEngine, type SoundState } from '../audio/engine';
import type { PlaybackState } from '../audio/scheduler';
export function useAudio() {
  const engine = useRef<AudioEngine | null>(null);
  const [sound, setSound] = useState<SoundState>({
    instrument: DEFAULT_INSTRUMENT,
    loading: false,
    failed: false,
  });
  const [ready, setReady] = useState(false);
  const [level, setLevel] = useState(0);
  const [playback, setPlayback] = useState<PlaybackState>({
    status: 'stopped',
    beat: 0,
    event: null,
    next: null,
  });
  useEffect(() => {
    const audio = new AudioEngine(
      (state, value) => {
        setPlayback(state);
        setLevel(value);
      },
      setReady,
      setSound,
    );
    engine.current = audio;
    return () => {
      audio.dispose();
      engine.current = null;
    };
  }, []);
  return { engine, ready, level, playback, sound };
}
