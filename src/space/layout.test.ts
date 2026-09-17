import { describe, expect, it } from 'vitest';
import { SPACE_KEY, SPACE_NODES, spaceEvent } from './layout';
import {
  chordSymbol,
  pc,
  pitchName,
  tones,
  voicedSymbol,
} from '../music/harmony';

describe('Harmonic Space musical data', () => {
  it('contains the full 42-chord landscape and only seven diatonic satellites', () => {
    expect(SPACE_NODES).toHaveLength(42);
    expect(new Set(SPACE_NODES.map((n) => n.id)).size).toBe(42);
    expect(SPACE_NODES.filter((n) => n.layer === 'near')).toHaveLength(15);
    expect(SPACE_NODES.filter((n) => n.layer === 'outer')).toHaveLength(13);
    const satellites = SPACE_NODES.filter((n) => n.satelliteOf);
    expect(satellites).toHaveLength(7);
    expect(satellites.map((n) => chordSymbol(n.chord))).toEqual([
      'Cmaj7',
      'Dm7',
      'Em7',
      'Fmaj7',
      'G7',
      'Am7',
      'Bm7♭5',
    ]);
    for (const node of SPACE_NODES) {
      if (node.anchor)
        expect(SPACE_NODES.some((n) => n.id === node.anchor)).toBe(true);
      if (node.satelliteOf) expect(node.layer).toBe('core');
      const event = spaceEvent(node);
      expect(event.key).toEqual(SPACE_KEY);
      expect(event.policy).toBe('root');
      expect(event.melody).toBeUndefined();
      expect(event.notes.map((n) => n % 12).sort()).toEqual(
        tones(node.chord).map(pc).sort(),
      );
      expect(event.notes[0] % 12).toBe(pc(tones(node.chord)[node.bass ?? 0]));
    }
  });
  it('keeps enharmonic spellings, seventh qualities and the explicit slash bass', () => {
    const get = (id: string) =>
      spaceEvent(SPACE_NODES.find((n) => n.id === id)!);
    expect(tones(get('csdim7').chord).map(pitchName)).toEqual([
      'C♯',
      'E',
      'G',
      'B♭',
    ]);
    expect(tones(get('db7').chord).map(pitchName)).toEqual([
      'D♭',
      'F',
      'A♭',
      'C♭',
    ]);
    expect(tones(get('am-maj7').chord).map(pitchName)).toEqual([
      'A',
      'C',
      'E',
      'G♯',
    ]);
    const slash = get('db-f');
    expect(voicedSymbol(slash.chord, slash.notes)).toBe('D♭/F');
    expect(slash.notes[0] % 12).toBe(5);
    expect(get('c-seventh').notes).not.toEqual(get('c7').notes);
  });
});
