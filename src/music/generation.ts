import {
  analyze,
  chordSymbol,
  diatonic,
  spell,
  type Harmony,
  type Key,
  type Quality,
} from './harmony';
import { optimizeVoicings, type VoicingPolicy } from './voicing';

export const GENERATOR_VERSION = 1;
export interface GeneratorSettings {
  version: 1;
  style: 'pop' | 'jazz';
  bars: 4 | 8 | 16;
  beatsPerChord: 2 | 4 | 8;
  seventh: boolean;
  outside: number;
  ending: 'cadence' | 'loop';
  seed: number;
}
export interface GenerationOptions extends GeneratorSettings {
  key: Key;
  policy: VoicingPolicy;
}
export interface GenerationIntent {
  version: 1;
  degree: number;
  alteration: number;
  quality: Quality;
  purpose: 'template' | 'secondary' | 'borrowed' | 'cadence';
  appliedTo?: number;
}
export interface GeneratedEvent {
  id: string;
  chord: Harmony;
  key: Key;
  bass: null;
  policy: VoicingPolicy;
  duration: number;
  notes: number[];
  intent: GenerationIntent;
}
export interface GenerationRecord {
  options: GenerationOptions;
  phrase: number;
  fallback: 'shortPhrase' | 'constraints' | null;
}
export interface GeneratedPhrase {
  events: GeneratedEvent[];
  record: GenerationRecord;
}
export const defaultGenerator = (): GeneratorSettings => ({
  version: GENERATOR_VERSION,
  style: 'pop',
  bars: 4,
  beatsPerChord: 4,
  seventh: false,
  outside: 0,
  ending: 'loop',
  seed: 42,
});
export function isGeneratorSettings(
  value: unknown,
): value is GeneratorSettings {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  return (
    s.version === GENERATOR_VERSION &&
    ['pop', 'jazz'].includes(String(s.style)) &&
    [4, 8, 16].includes(s.bars as number) &&
    [2, 4, 8].includes(s.beatsPerChord as number) &&
    typeof s.seventh === 'boolean' &&
    typeof s.outside === 'number' &&
    Number.isFinite(s.outside) &&
    s.outside >= 0 &&
    s.outside <= 1 &&
    ['cadence', 'loop'].includes(String(s.ending)) &&
    typeof s.seed === 'number' &&
    Number.isInteger(s.seed) &&
    s.seed >= 0 &&
    s.seed <= 0xffffffff
  );
}
// Mulberry32: fixed 32-bit operations, independent of Date, audio and the DOM.
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
export function realizeIntent(intent: GenerationIntent, key: Key): Harmony {
  return {
    root: spell(
      key.tonic,
      intent.degree,
      [0, 2, 4, 5, 7, 9, 11][intent.degree] + intent.alteration,
    ),
    quality: intent.quality,
  };
}
function intentFor(
  chord: Harmony,
  key: Key,
  purpose: GenerationIntent['purpose'],
): GenerationIntent {
  const a = analyze(chord, key);
  return {
    version: GENERATOR_VERSION,
    degree: a.degree,
    alteration: a.alteration,
    quality: chord.quality,
    purpose,
    ...(a.appliedTo === undefined ? {} : { appliedTo: a.appliedTo }),
  };
}
const templates = {
  pop: [
    [0, 4, 5, 3],
    [5, 3, 0, 4],
    [0, 3, 1, 4],
    [0, 5, 3, 4],
  ],
  jazz: [
    [0, 5, 1, 4],
    [1, 4, 0, 0],
    [0, 3, 1, 4],
    [2, 5, 1, 4],
  ],
};
function pickTemplate(
  style: GeneratorSettings['style'],
  previous: number | undefined,
  random: () => number,
) {
  const choices = templates[style];
  // Favor a tonic after a dominant; Jazz also favors ii–V and turnarounds.
  const weights = choices.map(
    (degrees, i) =>
      (style === 'jazz' && i === 0 ? 4 : 2) +
      (previous === 4 && [0, 5].includes(degrees[0]) ? 3 : 0),
  );
  let roll = random() * weights.reduce((a, b) => a + b, 0);
  return (
    choices[weights.findIndex((weight) => (roll -= weight) < 0)] ?? choices[0]
  );
}
function buildSteps(
  options: GenerationOptions,
  random: () => number,
  fallback = false,
) {
  const count = (options.bars * 4) / options.beatsPerChord;
  const degrees: number[] = [];
  while (degrees.length < count) {
    const motif = fallback
      ? templates[options.style][0]
      : pickTemplate(options.style, degrees.at(-1), random);
    degrees.push(...motif.slice(0, count - degrees.length));
  }
  if (options.ending === 'loop') {
    degrees[0] = 0;
    // Pop can loop IV → I: preserve I–V–vi–IV instead of forcing V.
    if (options.style === 'jazz' || ![3, 4].includes(degrees[count - 1]))
      degrees[count - 1] = 4;
  } else {
    degrees[count - 1] = 0;
    degrees[count - 2] = 4;
    if (count > 2) degrees[count - 3] = options.style === 'jazz' ? 1 : 3;
  }
  const chords = diatonic(options.key, options.seventh);
  const steps = degrees.map((degree, i) =>
    intentFor(
      chords[degree],
      options.key,
      i >= count - (options.ending === 'cadence' ? 2 : 1)
        ? 'cadence'
        : 'template',
    ),
  );
  if (fallback || options.outside === 0) return steps;
  const protectedTargets = new Set<number>();
  for (let i = 1; i < steps.length - 1; i++) {
    if (protectedTargets.has(i) || random() >= options.outside) continue;
    const target = realizeIntent(steps[i + 1], options.key);
    const current = realizeIntent(steps[i], options.key);
    const dominant: Harmony = {
      root: spell(target.root, 4, 7),
      quality: options.seventh ? '7' : 'major',
    };
    const analysis = analyze(dominant, options.key);
    if (
      (analysis.kind === 'secondary' || analysis.kind === 'minorDominant') &&
      !['dim', 'm7♭5'].includes(target.quality) &&
      (options.style === 'jazz' || random() < 0.65)
    ) {
      steps[i] = intentFor(
        dominant,
        options.key,
        analysis.kind === 'secondary' ? 'secondary' : 'cadence',
      );
      protectedTargets.add(i + 1);
    } else if (
      options.key.mode === 'major' &&
      [3, 5, 6].includes(steps[i].degree) &&
      i < steps.length - 2
    ) {
      const borrowed = diatonic(
        { ...options.key, mode: 'minor' },
        options.seventh,
      )[steps[i].degree];
      if (
        analyze(borrowed, options.key).kind === 'borrowed' &&
        chordSymbol(borrowed) !== chordSymbol(current)
      )
        steps[i] = intentFor(borrowed, options.key, 'borrowed');
    }
  }
  return steps;
}
function validSteps(steps: GenerationIntent[], options: GenerationOptions) {
  const names = steps.map((step) =>
    chordSymbol(realizeIntent(step, options.key)),
  );
  return names.every(
    (name, i) => i < 2 || name !== names[i - 1] || name !== names[i - 2],
  );
}
function fingerprint(options: GenerationOptions) {
  const text = [
    options.version,
    options.style,
    options.bars,
    options.beatsPerChord,
    options.seventh,
    options.outside,
    options.ending,
    options.seed,
    options.key.tonic.letter,
    options.key.tonic.accidental,
    options.key.mode,
    options.policy,
  ].join('|');
  let hash = 2166136261;
  for (const char of text)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16);
}
export function generateProgression(
  options: GenerationOptions,
  phrase = 0,
): GeneratedPhrase {
  if (
    !isGeneratorSettings(options) ||
    !Number.isSafeInteger(phrase) ||
    phrase < 0
  )
    throw new Error('Invalid generation settings');
  const random = seededRandom(
    (options.seed ^ Math.imul(phrase, 0x9e3779b9)) >>> 0,
  );
  let steps: GenerationIntent[] = [];
  let fallback: GenerationRecord['fallback'] = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    steps = buildSteps(options, random);
    if (validSteps(steps, options)) break;
  }
  if (!validSteps(steps, options)) {
    steps = buildSteps(options, random, true);
    fallback = 'constraints';
  }
  if (steps.length === 2 && options.outside > 0) fallback = 'shortPhrase';
  const inputs = steps.map((intent) => ({
    chord: realizeIntent(intent, options.key),
    bass: null,
    policy: options.policy,
  }));
  const notes = optimizeVoicings(inputs, options.ending === 'loop');
  return {
    record: { options: structuredClone(options), phrase, fallback },
    events: inputs.map((input, i) => ({
      ...input,
      id: `g${GENERATOR_VERSION}-${fingerprint(options)}-${phrase}-${i}`,
      key: structuredClone(options.key),
      duration: options.beatsPerChord,
      notes: notes[i],
      intent: steps[i],
    })),
  };
}
export function isGenerationIntent(
  value: unknown,
  chord: Harmony,
  key: Key,
): value is GenerationIntent {
  if (!value || typeof value !== 'object') return false;
  const s = value as GenerationIntent;
  if (
    s.version !== GENERATOR_VERSION ||
    !Number.isInteger(s.degree) ||
    s.degree < 0 ||
    s.degree > 6 ||
    !Number.isInteger(s.alteration) ||
    s.alteration < -2 ||
    s.alteration > 2 ||
    s.quality !== chord.quality ||
    !['template', 'secondary', 'borrowed', 'cadence'].includes(s.purpose)
  )
    return false;
  if (chordSymbol(realizeIntent(s, key)) !== chordSymbol(chord)) return false;
  const analysis = analyze(chord, key);
  if (
    s.appliedTo !== undefined &&
    (s.appliedTo !== analysis.appliedTo || s.purpose !== 'secondary')
  )
    return false;
  if (
    s.purpose === 'secondary' &&
    (analysis.kind !== 'secondary' || s.appliedTo !== analysis.appliedTo)
  )
    return false;
  if (s.purpose === 'borrowed' && analysis.kind !== 'borrowed') return false;
  return true;
}
// Only a small window is kept. Reading never runs the generator on the audio tick.
export class PreparedProgressions {
  private phrases = new Map<number, GeneratedPhrase>();
  private active = true;
  constructor(
    readonly options: GenerationOptions,
    readonly startPhrase = 0,
  ) {
    this.prepare(startPhrase);
    this.prepare(startPhrase + 1);
  }
  prepare(index: number) {
    if (!this.active || this.phrases.has(index)) return;
    this.phrases.set(index, generateProgression(this.options, index));
    for (const key of this.phrases.keys())
      if (key < index - 2) this.phrases.delete(key);
  }
  get(index: number) {
    return this.active ? this.phrases.get(index) : undefined;
  }
  stop() {
    this.active = false;
    this.phrases.clear();
  }
}
