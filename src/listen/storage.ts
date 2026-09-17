import { isListenSettings, type ListenSettings } from './plan';
export const LISTEN_STORAGE = 'chordscape.listen.v1';
export function loadListen(fallback: ListenSettings): ListenSettings {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(LISTEN_STORAGE) ?? 'null',
    );
    return isListenSettings(value) ? value : fallback;
  } catch {
    return fallback;
  }
}
