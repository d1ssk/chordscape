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
    suffix: '°',
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
    suffix: 'M7',
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
    suffix: '°7',
    semitones: [0, 3, 6, 9],
    degrees: [0, 2, 4, 6],
    intervals: ['1', '♭3', '♭5', '♭♭7'],
    family: 'Diminished',
  },
  '6': {
    suffix: '6',
    semitones: [0, 4, 7, 9],
    degrees: [0, 2, 4, 5],
    intervals: ['1', '3', '5', '6'],
    family: 'Major',
  },
  m6: {
    suffix: 'm6',
    semitones: [0, 3, 7, 9],
    degrees: [0, 2, 4, 5],
    intervals: ['1', '♭3', '5', '6'],
    family: 'Minor',
  },
  add9: {
    suffix: 'add9',
    semitones: [0, 4, 7, 14],
    degrees: [0, 2, 4, 8],
    intervals: ['1', '3', '5', '9'],
    family: 'Major',
  },
  '9': {
    suffix: '9',
    semitones: [0, 4, 7, 10, 14],
    degrees: [0, 2, 4, 6, 8],
    intervals: ['1', '3', '5', '♭7', '9'],
    family: 'Dominant',
  },
  maj9: {
    suffix: 'M9',
    semitones: [0, 4, 7, 11, 14],
    degrees: [0, 2, 4, 6, 8],
    intervals: ['1', '3', '5', '7', '9'],
    family: 'Major',
  },
  m9: {
    suffix: 'm9',
    semitones: [0, 3, 7, 10, 14],
    degrees: [0, 2, 4, 6, 8],
    intervals: ['1', '♭3', '5', '♭7', '9'],
    family: 'Minor',
  },
  '7♭5': {
    suffix: '7♭5',
    semitones: [0, 4, 6, 10],
    degrees: [0, 2, 4, 6],
    intervals: ['1', '3', '♭5', '♭7'],
    family: 'Dominant',
    romanSuffix: '7♭5',
  },
  'm(maj7)': {
    suffix: 'm(M7)',
    semitones: [0, 3, 7, 11],
    degrees: [0, 2, 4, 6],
    intervals: ['1', '♭3', '5', '7'],
    family: 'Minor',
    romanSuffix: '(M7)',
  },
  '7sus4': {
    suffix: '7sus4',
    semitones: [0, 5, 7, 10],
    degrees: [0, 3, 4, 6],
    intervals: ['1', '4', '5', '♭7'],
    family: 'Dominant',
    romanSuffix: '7sus4',
  },
  '7♯5': {
    suffix: '7♯5',
    semitones: [0, 4, 8, 10],
    degrees: [0, 2, 4, 6],
    intervals: ['1', '3', '♯5', '♭7'],
    family: 'Dominant',
    romanSuffix: '7♯5',
  },
  'maj7♯5': {
    suffix: 'M7♯5',
    semitones: [0, 4, 8, 11],
    degrees: [0, 2, 4, 6],
    intervals: ['1', '3', '♯5', '7'],
    family: 'Major',
    romanSuffix: 'M7♯5',
  },
  '6/9': {
    suffix: '6/9',
    semitones: [0, 4, 7, 9, 14],
    degrees: [0, 2, 4, 5, 8],
    intervals: ['1', '3', '5', '6', '9'],
    family: 'Major',
    romanSuffix: '(add6,9)',
  },
  'm(add9)': {
    suffix: 'm(add9)',
    semitones: [0, 3, 7, 14],
    degrees: [0, 2, 4, 8],
    intervals: ['1', '♭3', '5', '9'],
    family: 'Minor',
    romanSuffix: 'add9',
  },
  '7♭9': {
    suffix: '7♭9',
    semitones: [0, 4, 7, 10, 13],
    degrees: [0, 2, 4, 6, 8],
    intervals: ['1', '3', '5', '♭7', '♭9'],
    family: 'Dominant',
    romanSuffix: '7♭9',
  },
  '7♯9': {
    suffix: '7♯9',
    semitones: [0, 4, 7, 10, 15],
    degrees: [0, 2, 4, 6, 8],
    intervals: ['1', '3', '5', '♭7', '♯9'],
    family: 'Dominant',
    romanSuffix: '7♯9',
  },
  'maj7(♯11)': {
    suffix: 'M7(♯11)',
    semitones: [0, 4, 7, 11, 18],
    degrees: [0, 2, 4, 6, 10],
    intervals: ['1', '3', '5', '7', '♯11'],
    family: 'Major',
    romanSuffix: 'M7(♯11)',
  },
  '11': {
    suffix: '11',
    semitones: [0, 4, 7, 10, 14, 17],
    degrees: [0, 2, 4, 6, 8, 10],
    intervals: ['1', '3', '5', '♭7', '9', '11'],
    family: 'Dominant',
    romanSuffix: '11',
  },
  m11: {
    suffix: 'm11',
    semitones: [0, 3, 7, 10, 14, 17],
    degrees: [0, 2, 4, 6, 8, 10],
    intervals: ['1', '♭3', '5', '♭7', '9', '11'],
    family: 'Minor',
    romanSuffix: '11',
  },
  '13': {
    suffix: '13',
    semitones: [0, 4, 7, 10, 14, 17, 21],
    degrees: [0, 2, 4, 6, 8, 10, 12],
    intervals: ['1', '3', '5', '♭7', '9', '11', '13'],
    family: 'Dominant',
    romanSuffix: '13',
  },
  m13: {
    suffix: 'm13',
    semitones: [0, 3, 7, 10, 14, 17, 21],
    degrees: [0, 2, 4, 6, 8, 10, 12],
    intervals: ['1', '♭3', '5', '♭7', '9', '11', '13'],
    family: 'Minor',
    romanSuffix: '13',
  },
  maj13: {
    suffix: 'M13',
    semitones: [0, 4, 7, 11, 14, 17, 21],
    degrees: [0, 2, 4, 6, 8, 10, 12],
    intervals: ['1', '3', '5', '7', '9', '11', '13'],
    family: 'Major',
    romanSuffix: 'M13',
  },
  '7(♭9,♯5)': {
    suffix: '7(♭9,♯5)',
    semitones: [0, 4, 8, 10, 13],
    degrees: [0, 2, 4, 6, 8],
    intervals: ['1', '3', '♯5', '♭7', '♭9'],
    family: 'Dominant',
    romanSuffix: '7(♭9,♯5)',
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
  kind:
    | 'diatonic'
    | 'secondary'
    | 'borrowed'
    | 'minorDominant'
    | 'minorLeading'
    | 'chromatic';
  appliedTo?: number;
  appliedAlteration?: number;
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
    (chord.quality === 'major' ||
      QUALITIES[chord.quality].family === 'Dominant') &&
    alteration === 0
  )
    return {
      ...basic,
      kind: 'minorDominant',
      target: diatonic(key)[0],
      functions: ['D'],
    };
  if (
    key.mode === 'minor' &&
    degree === 6 &&
    alteration === 0 &&
    (chord.quality === 'dim' || chord.quality === 'dim7')
  )
    return {
      ...basic,
      kind: 'minorLeading',
      target: diatonic(key)[0],
      functions: ['D'],
    };
  if (
    QUALITIES[chord.quality].family === 'Dominant' ||
    chord.quality === 'major'
  ) {
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
        appliedAlteration:
          key.mode === 'minor' && [2, 5, 6].includes(appliedTo) ? -1 : 0,
        target: diatonic(key)[appliedTo],
        functions: ['D'],
      };
  }
  const parallel = scale({
    ...key,
    mode: key.mode === 'major' ? 'minor' : 'major',
  });
  if (tones(chord).every((p) => parallel.some((s) => pc(s) === pc(p))))
    return { ...basic, kind: 'borrowed' };
  return basic;
}
const ROMANS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
function degreeLabel(degree: number, alteration: number, quality: Quality) {
  const lower = ['Minor', 'Diminished'].includes(QUALITIES[quality].family);
  return (
    (alteration < 0 ? '♭'.repeat(-alteration) : '♯'.repeat(alteration)) +
    (lower ? ROMANS[degree].toLowerCase() : ROMANS[degree])
  );
}
export function roman(analysis: Analysis, inversion = 0) {
  // A non-chord bass has no classical inversion figure.
  inversion = Math.max(0, inversion);
  const q = analysis.quality;
  const definition = QUALITIES[q];
  if ('romanSuffix' in definition) {
    const suffix = definition.romanSuffix;
    if (
      analysis.kind === 'secondary' &&
      analysis.appliedTo !== undefined &&
      analysis.target
    )
      return `V${suffix}/${degreeLabel(analysis.appliedTo, analysis.appliedAlteration ?? 0, analysis.target.quality)}`;
    return `${degreeLabel(analysis.degree, analysis.alteration, q)}${suffix}`;
  }
  const seventh = ['7', 'maj7', 'm7', 'm7♭5', 'dim7'].includes(q);
  const extended = ['6', 'm6', 'add9', '9', 'maj9', 'm9'].includes(q);
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
  const figure = extended
    ? (
        {
          '6': '(add6)',
          m6: '(add6)',
          add9: 'add9',
          '9': '9',
          maj9: 'M9',
          m9: '9',
        } as Record<string, string>
      )[q]
    : seventh
      ? ['7', '6/5', '4/3', '4/2'][inversion]
      : ['', '6', '6/4'][inversion];
  const maj = q === 'maj7' ? 'M' : '';
  if (
    analysis.kind === 'secondary' &&
    analysis.appliedTo !== undefined &&
    analysis.target
  )
    return `V${figure}/${degreeLabel(analysis.appliedTo, analysis.appliedAlteration ?? 0, analysis.target.quality)}`;
  return `${degreeLabel(analysis.degree, analysis.alteration, q)}${marker}${maj}${figure}`;
}
// A target triad can resolve to a seventh/ninth containing that same triad.
export function resolvesTo(analysis: Analysis, next?: Harmony) {
  return !!(
    analysis.target &&
    next &&
    pc(analysis.target.root) === pc(next.root) &&
    tones(analysis.target).every((p) =>
      tones(next).some((n) => pc(n) === pc(p)),
    )
  );
}
export function chromaticApproach(
  chord: Harmony,
  next?: Harmony,
): -1 | 1 | null {
  if (!next || chord.quality !== next.quality) return null;
  const difference = mod(pc(next.root) - pc(chord.root));
  return difference === 1 ? 1 : difference === 11 ? -1 : null;
}
// Ordered reference palettes in C; root spelling transposes by letter and pitch.
// The repeated F7 in minor is intentional. Slash-bass presets are not included.
const OUTSIDE_PRESETS: Record<
  Key['mode'],
  readonly (readonly [string, Quality])[]
> = {
  major: [
    ['A', '7'],
    ['B', '7'],
    ['C', '7'],
    ['D', '7'],
    ['E', '7'],
    ['F♯', '7'],
    ['C♯', 'dim7'],
    ['D♯', 'dim7'],
    ['F♯', 'dim7'],
    ['G♯', 'dim7'],
    ['C', 'minor'],
    ['E♭', 'major'],
    ['F', 'minor'],
    ['G', 'minor'],
    ['A♭', 'major'],
    ['B♭', 'major'],
    ['F', 'm7'],
    ['A♭', 'maj7'],
    ['B♭', '7'],
    ['D♭', '7'],
    ['E♭', '7'],
    ['A♭', '7'],
    ['F', '7'],
    ['D♭', 'major'],
    ['C', 'aug'],
    ['G', 'aug'],
    ['A', 'm(maj7)'],
  ],
  minor: [
    ['G', 'major'],
    ['G', '7'],
    ['B', 'dim'],
    ['B', 'dim7'],
    ['C', 'm(maj7)'],
    ['E♭', 'aug'],
    ['E♭', 'maj7♯5'],
    ['D', 'm7'],
    ['F', 'major'],
    ['F', '7'],
    ['A', 'm7♭5'],
    ['B', 'm7♭5'],
    ['C', 'major'],
    ['C', 'maj7'],
    ['D', 'minor'],
    ['E', 'minor'],
    ['E', 'm7'],
    ['A', 'major'],
    ['A', 'minor'],
    ['A', 'm7'],
    ['C', '7'],
    ['D', '7'],
    ['E♭', '7'],
    ['F', '7'],
    ['A', '7'],
    ['D♭', 'major'],
    ['A♭', '7'],
  ],
};
export function outside(key: Key): Harmony[] {
  return OUTSIDE_PRESETS[key.mode].map(([name, quality]) => {
    const reference = parsePitch(name);
    return {
      root: spell(key.tonic, LETTERS.indexOf(reference.letter), pc(reference)),
      quality,
    };
  });
}
export function inversionOf(chord: Harmony, notes: number[]) {
  return tones(chord).findIndex((p) => pc(p) === mod(Math.min(...notes)));
}
export function bassPitch(
  chord: Harmony,
  notes: number[],
  addedBass?: Pitch | null,
) {
  const lowest = mod(Math.min(...notes));
  const pitch = addedBass ?? tones(chord).find((p) => pc(p) === lowest);
  if (!pitch || pc(pitch) !== lowest)
    throw new Error('Bass contradicts sounding notes');
  return pitch;
}
export function voicedSymbol(
  chord: Harmony,
  notes: number[],
  addedBass?: Pitch | null,
) {
  if (addedBass)
    return `${chordSymbol(chord)}/${pitchName(bassPitch(chord, notes, addedBass))}`;
  const inversion = inversionOf(chord, notes);
  if (inversion < 0) throw new Error('Non-chord bass is unsupported');
  return (
    chordSymbol(chord) +
    (inversion ? `/${pitchName(tones(chord)[inversion])}` : '')
  );
}
export function midiName(
  chord: Harmony,
  midi: number,
  addedBass?: Pitch | null,
) {
  const pitch =
    addedBass && pc(addedBass) === mod(midi)
      ? addedBass
      : tones(chord).find((p) => pc(p) === mod(midi));
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
