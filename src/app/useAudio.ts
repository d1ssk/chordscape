import { useEffect, useRef, useState } from 'react';
import { AudioEngine } from '../audio/engine';
import type { PlaybackState } from '../audio/scheduler';
export function useAudio() {
  const engine = useRef<AudioEngine | null>(null);
  const [ready, setReady] = useState(false);
  const [level, setLevel] = useState(0);
  const [playback, setPlayback] = useState<PlaybackState>({
    status: 'stopped',
    beat: 0,
    event: null,
    next: null,
  });
  useEffect(() => {
    const audio = new AudioEngine((state, value) => {
      setPlayback(state);
      setLevel(value);
    }, setReady);
    engine.current = audio;
    return () => {
      audio.dispose();
      engine.current = null;
    };
  }, []);
  return { engine, ready, level, playback };
}
