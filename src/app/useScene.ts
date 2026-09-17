import { useEffect, useState } from 'react';
export type Scene =
  'play' | 'library' | 'settings' | 'generate' | 'circle' | 'melody' | 'listen';
function readScene(): Scene {
  const hash = window.location.hash.slice(1);
  return hash === 'library' ||
    hash === 'settings' ||
    hash === 'generate' ||
    hash === 'circle' ||
    hash === 'melody' ||
    hash === 'listen'
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
