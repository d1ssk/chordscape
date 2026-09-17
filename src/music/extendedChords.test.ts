import { expect, it } from 'vitest';
import {
  analyze,
  defaultKey,
  parsePitch,
  pc,
  pitchName,
  QUALITIES,
  ROOTS,
  roman,
  tones,
  type Harmony,
} from './harmony';
import { chooseVoicing, rootVoicing } from './voicing';
import {
  exportSession,
  editSession,
  importSession,
  makeEvent,
  newSession,
} from '../state/session';
import { defaultListen, isListenSettings } from '../listen/plan';

const added: [Harmony['quality'], string[]][] = [
  ['7♭5', ['C', 'E', 'G♭', 'B♭']],
  ['m(maj7)', ['C', 'E♭', 'G', 'B']],
  ['7sus4', ['C', 'F', 'G', 'B♭']],
  ['7♯5', ['C', 'E', 'G♯', 'B♭']],
  ['maj7♯5', ['C', 'E', 'G♯', 'B']],
  ['6/9', ['C', 'E', 'G', 'A', 'D']],
  ['m(add9)', ['C', 'E♭', 'G', 'D']],
  ['7♭9', ['C', 'E', 'G', 'B♭', 'D♭']],
  ['7♯9', ['C', 'E', 'G', 'B♭', 'D♯']],
  ['maj7(♯11)', ['C', 'E', 'G', 'B', 'F♯']],
  ['11', ['C', 'E', 'G', 'B♭', 'D', 'F']],
  ['m11', ['C', 'E♭', 'G', 'B♭', 'D', 'F']],
  ['13', ['C', 'E', 'G', 'B♭', 'D', 'F', 'A']],
  ['m13', ['C', 'E♭', 'G', 'B♭', 'D', 'F', 'A']],
  ['maj13', ['C', 'E', 'G', 'B', 'D', 'F', 'A']],
  ['7(♭9,♯5)', ['C', 'E', 'G♯', 'B♭', 'D♭']],
];
it('spells every added quality, including altered extensions, without losing its roman suffix', () => {
  expect(Object.keys(QUALITIES)).toHaveLength(33);
  for (const [quality, expected] of added) {
    const chord = { root: parsePitch('C'), quality };
    expect(tones(chord).map(pitchName), quality).toEqual(expected);
    expect(roman(analyze(chord, defaultKey))).not.toMatch(/undefined/);
  }
  expect(
    roman(analyze({ root: parsePitch('C'), quality: 'm(maj7)' }, defaultKey)),
  ).toBe('i(M7)');
  expect(
    roman(analyze({ root: parsePitch('D'), quality: '7♭5' }, defaultKey)),
  ).toBe('V7♭5/V');
  expect(
    roman(analyze({ root: parsePitch('C'), quality: 'maj13' }, defaultKey), 6),
  ).toBe('IM13');
});
it('plays and round-trips all new chords at every dictionary root and inversion', () => {
  for (const root of ROOTS)
    for (const [quality] of added) {
      const chord = { root: parsePitch(root), quality };
      const pitches = tones(chord);
      for (let bass = 0; bass < pitches.length; bass++) {
        const notes = rootVoicing(chord, bass);
        expect(notes[0] % 12).toBe(pc(pitches[bass]));
        expect(new Set(notes.map((n) => n % 12))).toEqual(
          new Set(pitches.map(pc)),
        );
        const smooth = chooseVoicing(
          { chord, bass, policy: 'smooth' },
          [48, 52, 55],
        );
        expect(smooth).toHaveLength(pitches.length);
        const session = newSession();
        const saved = editSession(session, {
          type: 'append',
          event: { ...makeEvent(chord, session, 'extended'), bass, notes },
        });
        expect(
          importSession(exportSession(saved)).events[0].notes,
          `${root}${quality} bass ${bass}`,
        ).toEqual(notes);
      }
    }
});
it('does not offer missing name recordings to the listening renderer', () => {
  for (const [quality] of added)
    expect(isListenSettings({ ...defaultListen(), qualities: [quality] })).toBe(
      false,
    );
});
