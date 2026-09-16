export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
export type Letter = (typeof LETTERS)[number];
const NATURALS = [0, 2, 4, 5, 7, 9, 11];
export const mod = (value: number, base = 12) => ((value % base) + base) % base;
export interface Pitch {
  letter: Letter;
  accidental: number;
}
export interface Key {
  tonic: Pitch;
  mode: 'major' | 'minor';
}
export const QUALITIES = {
  major: {
    suffix: '',
    semitones: [0, 4, 7],
    degrees: [0, 2, 4],
    intervals: ['1', '3', '5'],
    family: 'Major',
  },
  minor: {
    suffix: 'm',
    semitones: [0, 3, 7],
    degrees: [0, 2, 4],
    intervals: ['1', '♭3', '5'],
    family: 'Minor',
  },
  dim: {
    suffix: 'dim',
    semitones: [0, 3, 6],
    degrees: [0, 2, 4],
    intervals: ['1', '♭3', '♭5'],
    family: 'Diminished',
  },
  aug: {
    suffix: 'aug',
    semitones: [0, 4, 8],
    degrees: [0, 2, 4],
    intervals: ['1', '3', '♯5'],
    family: 'Augmented',
  },
  sus2: {
    suffix: 'sus2',
    semitones: [0, 2, 7],
    degrees: [0, 1, 4],
    intervals: ['1', '2', '5'],
    family: 'Suspended',
  },
  sus4: {
    suffix: 'sus4',
    semitones: [0, 5, 7],
    degrees: [0, 3, 4],
    intervals: ['1', '4', '5'],
    family: 'Suspended',
  },
  '7': {
    suffix: '7',
    semitones: [0, 4, 7, 10],
    degrees: [0, 2, 4, 6],
    intervals: ['1', '3', '5', '♭7'],
    family: 'Dominant',
  },
  maj7: {
    suffix: 'maj7',
    semitones: [0, 4, 7, 11],
    degrees: [0, 2, 4, 6],
    intervals: ['1', '3', '5', '7'],
    family: 'Major',
  },
  m7: {
    suffix: 'm7',
    semitones: [0, 3, 7, 10],
    degrees: [0, 2, 4, 6],
    intervals: ['1', '♭3', '5', '♭7'],
    family: 'Minor',
  },
  'm7♭5': {
    suffix: 'm7♭5',
    semitones: [0, 3, 6, 10],
    degrees: [0, 2, 4, 6],
    intervals: ['1', '♭3', '♭5', '♭7'],
    family: 'Diminished',
  },
  dim7: {
    suffix: 'dim7',
    semitones: [0, 3, 6, 9],
    degrees: [0, 2, 4, 6],
    intervals: ['1', '♭3', '♭5', '♭♭7'],
    family: 'Diminished',
  },
} as const;
export type Quality = keyof typeof QUALITIES;
export interface Harmony {
  root: Pitch;
  quality: Quality;
}
export const pc = (pitch: Pitch) =>
  mod(NATURALS[LETTERS.indexOf(pitch.letter)] + pitch.accidental);
export const pitchName = (pitch: Pitch) =>
  pitch.letter +
  (pitch.accidental < 0
    ? '♭'.repeat(-pitch.accidental)
    : '♯'.repeat(pitch.accidental));
export function parsePitch(name: string): Pitch {
  if (!/^[A-G][♯♭#b]{0,2}$/.test(name)) throw new Error('Invalid pitch');
  return {
    letter: name[0] as Letter,
    accidental: [...name.slice(1)].reduce(
      (sum, char) => sum + ('♯#'.includes(char) ? 1 : -1),
      0,
    ),
  };
}
export function spell(root: Pitch, degree: number, semitones: number): Pitch {
  const index = mod(LETTERS.indexOf(root.letter) + degree, 7);
  return {
    letter: LETTERS[index],
    accidental: mod(pc(root) + semitones - NATURALS[index] + 6) - 6,
  };
}
export const MAJOR_KEYS = [
  'C♭',
  'G♭',
  'D♭',
  'A♭',
  'E♭',
  'B♭',
  'F',
  'C',
  'G',
  'D',
  'A',
  'E',
  'B',
  'F♯',
  'C♯',
];
export const MINOR_KEYS = [
  'A♭',
  'E♭',
  'B♭',
  'F',
  'C',
  'G',
  'D',
  'A',
  'E',
  'B',
  'F♯',
  'C♯',
  'G♯',
  'D♯',
  'A♯',
];
export const ROOTS = [
  'C',
  'C♯',
  'D♭',
  'D',
  'D♯',
  'E♭',
  'E',
  'F',
  'F♯',
  'G♭',
  'G',
  'G♯',
  'A♭',
  'A',
  'A♯',
  'B♭',
  'B',
];
export const defaultKey: Key = { tonic: parsePitch('C'), mode: 'major' };
export function scale(key: Key) {
  return (
    key.mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10]
  ).map((step, i) => spell(key.tonic, i, step));
}
export function tones(chord: Harmony): Pitch[] {
  const quality = QUALITIES[chord.quality];
  return quality.semitones.map((step, i) =>
    spell(chord.root, quality.degrees[i], step),
  );
}
export function chordSymbol(chord: Harmony) {
  return pitchName(chord.root) + QUALITIES[chord.quality].suffix;
}
export function diatonic(key: Key, seventh = false): Harmony[] {
  const pitches = scale(key);
  return pitches.map((root, index) => {
    const intervals = Array.from({ length: seventh ? 4 : 3 }, (_, offset) =>
      mod(pc(pitches[(index + offset * 2) % 7]) - pc(root)),
    );
    const quality = (Object.keys(QUALITIES) as Quality[]).find(
      (q) => QUALITIES[q].semitones.join() === intervals.join(),
    );
    if (!quality) throw new Error('Unknown diatonic chord');
    return { root, quality };
  });
}
export interface Analysis {
  degree: number;
  alteration: number;
  quality: Quality;
  kind: 'diatonic' | 'secondary' | 'borrowed' | 'minorDominant' | 'chromatic';
  appliedTo?: number;
  target?: Harmony;
  changed: Pitch[];
  functions: ('T' | 'P' | 'D')[];
}
export function analyze(chord: Harmony, key: Key): Analysis {
  const pitches = scale(key);
  const degree = mod(
    LETTERS.indexOf(chord.root.letter) - LETTERS.indexOf(key.tonic.letter),
    7,
  );
  const alteration =
    mod(pc(chord.root) - pc(key.tonic) - [0, 2, 4, 5, 7, 9, 11][degree] + 6) -
    6;
  const changed = tones(chord).filter(
    (p) => !pitches.some((s) => pc(s) === pc(p)),
  );
  const basic: Analysis = {
    degree,
    alteration,
    quality: chord.quality,
    kind: 'chromatic',
    changed,
    functions: [],
  };
  if (changed.length === 0)
    return {
      ...basic,
      kind: 'diatonic',
      functions:
        degree === 0
          ? ['T']
          : degree === 1 || degree === 3
            ? ['P']
            : degree === 4 || degree === 6
              ? ['D']
              : ['T', 'P'],
    };
  if (
    key.mode === 'minor' &&
    degree === 4 &&
    (chord.quality === 'major' || chord.quality === '7') &&
    alteration === 0
  )
    return {
      ...basic,
      kind: 'minorDominant',
      target: diatonic(key)[0],
      functions: ['D'],
    };
  if (chord.quality === '7' || chord.quality === 'major') {
    const appliedTo = diatonic(key).findIndex(
      (target, i) =>
        i !== 0 &&
        target.quality !== 'dim' &&
        mod(pc(chord.root) + 5) === pc(target.root),
    );
    if (appliedTo >= 0)
      return {
        ...basic,
        kind: 'secondary',
        appliedTo,
        target: diatonic(key)[appliedTo],
        functions: ['D'],
      };
  }
  const parallel = diatonic(
    { ...key, mode: key.mode === 'major' ? 'minor' : 'major' },
    tones(chord).length === 4,
  );
  if (parallel.some((c) => chordSymbol(c) === chordSymbol(chord)))
    return { ...basic, kind: 'borrowed' };
  return basic;
}
const ROMANS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
function degreeLabel(degree: number, alteration: number, quality: Quality) {
  const lower = ['minor', 'dim', 'm7', 'm7♭5', 'dim7'].includes(quality);
  return (
    (alteration < 0 ? '♭'.repeat(-alteration) : '♯'.repeat(alteration)) +
    (lower ? ROMANS[degree].toLowerCase() : ROMANS[degree])
  );
}
export function roman(analysis: Analysis, inversion = 0) {
  const q = analysis.quality;
  const seventh = QUALITIES[q].semitones.length === 4;
  const marker =
    q === 'dim' || q === 'dim7'
      ? '°'
      : q === 'm7♭5'
        ? 'ø'
        : q === 'aug'
          ? '+'
          : q === 'sus2' || q === 'sus4'
            ? q
            : '';
  const figure = seventh
    ? ['7', '6/5', '4/3', '4/2'][inversion]
    : ['', '6', '6/4'][inversion];
  const maj = q === 'maj7' ? 'maj' : '';
  if (
    analysis.kind === 'secondary' &&
    analysis.appliedTo !== undefined &&
    analysis.target
  )
    return `V${figure}/${degreeLabel(analysis.appliedTo, 0, analysis.target.quality)}`;
  return `${degreeLabel(analysis.degree, analysis.alteration, q)}${marker}${maj}${figure}`;
}
export function outside(key: Key): Harmony[] {
  const candidates: Harmony[] = diatonic(key)
    .filter((c) => c.quality !== 'dim')
    .map((target) => ({ root: spell(target.root, 4, 7), quality: '7' }));
  candidates.push(
    ...diatonic({ ...key, mode: key.mode === 'major' ? 'minor' : 'major' }),
  );
  if (key.mode === 'minor')
    candidates.push({ root: spell(key.tonic, 6, 11), quality: 'dim' });
  return candidates.filter(
    (c, i) =>
      analyze(c, key).changed.length > 0 &&
      candidates.findIndex((other) => chordSymbol(other) === chordSymbol(c)) ===
        i,
  );
}
export function inversionOf(chord: Harmony, notes: number[]) {
  return tones(chord).findIndex((p) => pc(p) === mod(Math.min(...notes)));
}
export function voicedSymbol(chord: Harmony, notes: number[]) {
  const inversion = inversionOf(chord, notes);
  if (inversion < 0) throw new Error('Non-chord bass is unsupported');
  return (
    chordSymbol(chord) +
    (inversion ? `/${pitchName(tones(chord)[inversion])}` : '')
  );
}
export function midiName(chord: Harmony, midi: number) {
  const pitch = tones(chord).find((p) => pc(p) === mod(midi));
  if (!pitch) throw new Error('Non-chord tone');
  const octave =
    Math.floor(
      (midi - pitch.accidental - NATURALS[LETTERS.indexOf(pitch.letter)]) / 12,
    ) - 1;
  return `${pitchName(pitch)}${octave}`;
}
export function transposeKey(key: Key, semitones: number): Key {
  const names = key.mode === 'major' ? MAJOR_KEYS : MINOR_KEYS;
  const options = names
    .map(parsePitch)
    .filter((p) => pc(p) === mod(pc(key.tonic) + semitones));
  options.sort(
    (a, b) =>
      Math.abs(a.accidental) - Math.abs(b.accidental) ||
      (key.tonic.accidental < 0
        ? a.accidental - b.accidental
        : b.accidental - a.accidental),
  );
  return { tonic: options[0], mode: key.mode };
}
export function transposeHarmony(
  chord: Harmony,
  from: Key,
  to: Key,
  semitones: number,
): Harmony {
  const letterShift = mod(
    LETTERS.indexOf(to.tonic.letter) - LETTERS.indexOf(from.tonic.letter),
    7,
  );
  return { ...chord, root: spell(chord.root, letterShift, semitones) };
}
