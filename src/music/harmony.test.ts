import { describe, expect, it } from 'vitest';
import {
  analyze,
  chordSymbol,
  defaultKey,
  diatonic,
  outside,
  MAJOR_KEYS,
  MINOR_KEYS,
  parsePitch,
  pc,
  pitchName,
  roman,
  scale,
  tones,
  voicedSymbol,
  midiName,
  transposeKey,
  transposeHarmony,
  type Harmony,
  type Key,
} from './harmony';
import {
  chooseVoicing,
  optimizeVoicings,
  rootVoicing,
  voiceDistance,
} from './voicing';
const chord = (
  name: string,
  quality: Harmony['quality'] = 'major',
): Harmony => ({ root: parsePitch(name), quality });
const key = (name: string, mode: Key['mode'] = 'major'): Key => ({
  tonic: parsePitch(name),
  mode,
});
describe('spelled harmony', () => {
  it('derives major and natural minor triads and sevenths', () => {
    expect(diatonic(defaultKey).map(chordSymbol)).toEqual([
      'C',
      'Dm',
      'Em',
      'F',
      'G',
      'Am',
      'Bdim',
    ]);
    expect(diatonic(defaultKey, true).map(chordSymbol)).toEqual([
      'Cmaj7',
      'Dm7',
      'Em7',
      'Fmaj7',
      'G7',
      'Am7',
      'Bm7♭5',
    ]);
    expect(diatonic(key('A', 'minor')).map(chordSymbol)).toEqual([
      'Am',
      'Bdim',
      'C',
      'Dm',
      'Em',
      'F',
      'G',
    ]);
    expect(
      diatonic(key('A', 'minor')).map((c) =>
        roman(analyze(c, key('A', 'minor'))),
      ),
    ).toEqual(['i', 'ii°', '♭III', 'iv', 'v', '♭VI', '♭VII']);
  });
  it('preserves F, F sharp and enharmonic spellings', () => {
    expect(scale(key('F')).map(pitchName)).toEqual([
      'F',
      'G',
      'A',
      'B♭',
      'C',
      'D',
      'E',
    ]);
    expect(scale(key('F♯')).map(pitchName)).toEqual([
      'F♯',
      'G♯',
      'A♯',
      'B',
      'C♯',
      'D♯',
      'E♯',
    ]);
    expect(scale(key('C♭')).map(pitchName)).toContain('F♭');
    expect(midiName(chord('C♭'), 59)).toBe('C♭4');
    for (const [names, mode] of [
      [MAJOR_KEYS, 'major'],
      [MINOR_KEYS, 'minor'],
    ] as const)
      for (const name of names)
        expect(new Set(scale(key(name, mode)).map(pc)).size).toBe(7);
  });
  it('distinguishes major, dominant, half and fully diminished sevenths', () => {
    expect(tones(chord('C', 'maj7')).map(pitchName)).toEqual([
      'C',
      'E',
      'G',
      'B',
    ]);
    expect(tones(chord('C', '7')).map(pitchName)).toEqual([
      'C',
      'E',
      'G',
      'B♭',
    ]);
    expect(tones(chord('B', 'm7♭5')).map(pitchName)).toEqual([
      'B',
      'D',
      'F',
      'A',
    ]);
    expect(tones(chord('B', 'dim7')).map(pitchName)).toEqual([
      'B',
      'D',
      'F',
      'A♭',
    ]);
  });
  it('returns context-dependent outside candidates with evidence', () => {
    const secondary = analyze(chord('A', '7'), defaultKey);
    expect(roman(secondary)).toBe('V7/ii');
    expect(secondary.kind).toBe('secondary');
    expect(secondary.changed.map(pitchName)).toEqual(['C♯']);
    expect(chordSymbol(secondary.target!)).toBe('Dm');
    expect(analyze(chord('F', 'minor'), defaultKey).kind).toBe('borrowed');
    expect(analyze(chord('E', '7'), key('A', 'minor')).kind).toBe(
      'minorDominant',
    );
    expect(roman(analyze(chord('E', '7'), key('A', 'minor')))).toBe('V7');
  });
  it('offers outside triads, sevenths and ninths with unique names and playable spelled tones in every key', () => {
    for (const [names, mode] of [
      [MAJOR_KEYS, 'major'],
      [MINOR_KEYS, 'minor'],
    ] as const) {
      for (const name of names) {
        const context = key(name, mode);
        const choices = outside(context);
        expect(choices.length).toBeGreaterThanOrEqual(24);
        expect(new Set(choices.map(chordSymbol)).size).toBe(choices.length);
        for (const choice of choices) {
          expect(analyze(choice, context).changed.length).toBeGreaterThan(0);
          expect(new Set(rootVoicing(choice).map((n) => n % 12))).toEqual(
            new Set(tones(choice).map(pc)),
          );
        }
      }
    }
    expect(outside(defaultKey).map(chordSymbol)).toEqual(
      expect.arrayContaining([
        'A',
        'A7',
        'A9',
        'Fm7',
        'A♭maj7',
        'B♭7',
        'Dm7♭5',
      ]),
    );
    expect(roman(analyze(chord('A', '9'), defaultKey))).toBe('V9/ii');
    expect(tones(chord('A', '9')).map(pitchName)).toEqual([
      'A',
      'C♯',
      'E',
      'G',
      'B',
    ]);
    const leading = outside(key('A', 'minor')).find(
      (c) => chordSymbol(c) === 'G♯dim7',
    )!;
    expect(analyze(leading, key('A', 'minor')).kind).toBe('minorLeading');
    expect(tones(leading).map(pitchName)).toEqual(['G♯', 'B', 'D', 'F']);
    expect(outside(key('C♯')).map(chordSymbol)).toContain('D♯9');
    expect(outside(key('C♭')).map(chordSymbol)).toContain('D♭9');
  });
  it('separates bass slash from applied Roman slash', () => {
    expect(voicedSymbol(chord('C'), [52, 55, 60])).toBe('C/E');
    expect(voicedSymbol(chord('C'), [43, 48, 52])).toBe('C/G');
    expect(voicedSymbol(chord('G', '7'), [53, 55, 59, 62])).toBe('G7/F');
    expect(roman(analyze(chord('G', '7'), defaultKey), 3)).toBe('V4/2');
    expect(() => voicedSymbol(chord('A', 'minor'), [43, 48, 52, 57])).toThrow();
    expect(voicedSymbol(chord('A', 'm7'), [43, 48, 52, 57])).toBe('Am7/G');
  });
  it('transposes pitch and context together', () => {
    const to = transposeKey(defaultKey, 2);
    expect(pitchName(to.tonic)).toBe('D');
    expect(
      chordSymbol(transposeHarmony(chord('F', 'minor'), defaultKey, to, 2)),
    ).toBe('Gm');
  });
});
describe('voicing', () => {
  it('uses insertion cost when voice counts differ', () => {
    expect(voiceDistance([48, 52, 55], [48, 50, 52, 55])).toBe(1);
  });
  it('retains chord membership and manual seventh bass in smooth mode', () => {
    const c = chord('G', '7');
    const notes = chooseVoicing(
      { chord: c, bass: 3, policy: 'smooth' },
      [48, 52, 55],
    );
    expect(notes[0] % 12).toBe(5);
    expect(new Set(notes.map((n) => n % 12))).toEqual(
      new Set(tones(c).map(pc)),
    );
  });
  it('optimizes deterministically with fixed events and loop boundary', () => {
    const inputs = [
      chord('C'),
      chord('G'),
      chord('A', 'minor'),
      chord('F'),
    ].map((c, i) => ({
      chord: c,
      bass: i === 1 ? 1 : null,
      policy: 'smooth' as const,
    }));
    const result = optimizeVoicings(inputs, true);
    expect(result[0]).toEqual(rootVoicing(chord('C')));
    expect(result[1][0] % 12).toBe(11);
    expect(optimizeVoicings(inputs, true)).toEqual(result);
    result.forEach((notes, i) =>
      expect(new Set(notes.map((n) => n % 12))).toEqual(
        new Set(tones(inputs[i].chord).map(pc)),
      ),
    );
  });
});
it('retains altered target degrees in minor secondary dominants', () => {
  expect(roman(analyze(chord('D', '7'), key('A', 'minor')))).toBe('V7/♭VII');
});

it('checks every C major triad tone and minor leading-tone evidence', () => {
  expect(diatonic(defaultKey).map((c) => tones(c).map(pitchName))).toEqual([
    ['C', 'E', 'G'],
    ['D', 'F', 'A'],
    ['E', 'G', 'B'],
    ['F', 'A', 'C'],
    ['G', 'B', 'D'],
    ['A', 'C', 'E'],
    ['B', 'D', 'F'],
  ]);
  expect(analyze(chord('G♯', 'dim'), key('A', 'minor')).kind).toBe(
    'minorLeading',
  );
});
