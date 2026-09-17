import { useEffect, useState } from 'react';
export type Scene =
  'play' | 'library' | 'settings' | 'generate' | 'circle' | 'listen' | 'space';
function readScene(): Scene {
  const raw = window.location.hash.slice(1);
  const hash = raw === 'melody' ? 'generate' : raw;
  return hash === 'library' ||
    hash === 'settings' ||
    hash === 'generate' ||
    hash === 'circle' ||
    hash === 'listen' ||
    hash === 'space'
    ? hash
    : 'play';
}
export function useScene() {
  const [scene, setScene] = useState(readScene);
  useEffect(() => {
    const changed = () => {
      setScene(readScene());
      window.scrollTo(0, 0);
      requestAnimationFrame(() =>
        document.getElementById('scene-heading')?.focus(),
      );
    };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  function navigate(next: Scene) {
    if (next !== scene) window.location.hash = next;
  }
  return { scene, navigate };
}
