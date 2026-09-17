import {
  type Pitch,
  type Harmony,
  type Key,
  analyze,
  LETTERS,
  QUALITIES,
  diatonic,
} from '../music/harmony';
// Pronunciation is separate from chord symbols. These phrases also form the
// reproducible input manifest for the bundled Japanese speech clips.
const words = {
  C: 'シー',
  D: 'ディー',
  E: 'イー',
  F: 'エフ',
  G: 'ジー',
  A: 'エー',
  B: 'ビー',
  sharp: 'シャープ',
  flat: 'フラット',
  major: 'メジャー',
  minor: 'マイナー',
  dim: 'ディミニッシュ',
  aug: 'オーギュメント',
  sus2: 'サスツー',
  sus4: 'サスフォー',
  '7': 'セブンス',
  maj7: 'メジャーセブンス',
  m7: 'マイナーセブンス',
  'm7♭5': 'マイナーセブンス、フラットファイブ',
  dim7: 'ディミニッシュセブンス',
  '6': 'シックス',
  m6: 'マイナーシックス',
  add9: 'アドナイン',
  '9': 'ナインス',
  maj9: 'メジャーナインス',
  m9: 'マイナーナインス',
  degree1: '一度',
  degree2: '二度',
  degree3: '三度',
  degree4: '四度',
  degree5: '五度',
  degree6: '六度',
  degree7: '七度',
  inversion0: '基本形',
  inversion1: '第一転回形',
  inversion2: '第二転回形',
  inversion3: '第三転回形',
  inversion4: '第四転回形',
  key: 'の調です',
  reference: '主和音を確認します',
} as const;
// Each chord name is synthesized as one phrase, preserving its prosody.
// Degree/inversion announcements remain separate, complete phrases.
export type SpeechToken = string;
const pitchId = (pitch: Pitch) =>
  `${pitch.letter}-${pitch.accidental < 0 ? 'm' : 'p'}${Math.abs(pitch.accidental)}`;
const pitchText = (pitch: Pitch) =>
  words[pitch.letter] +
  (pitch.accidental < 0 ? words.flat : words.sharp).repeat(
    Math.abs(pitch.accidental),
  );
const chordToken = (chord: Harmony) =>
  `chord-${pitchId(chord.root)}-${chord.quality}`;
const degreeToken = (degree: number, alteration: number) =>
  `degree-${degree}-${alteration}`;
const keyToken = (key: Key) => `key-${pitchId(key.tonic)}-${key.mode}`;
export const speechFile = (token: SpeechToken) =>
  `${encodeURIComponent(token)}.mp3`;
export function keyTokens(key: Key): SpeechToken[] {
  return [keyToken(key)];
}
export function chordTokens(
  chord: Harmony,
  key: Key,
  degree: boolean,
  inversion: number | null,
): SpeechToken[] {
  const result = [chordToken(chord)];
  if (degree) {
    const analysis = analyze(chord, key);
    result.push(degreeToken(analysis.degree + 1, analysis.alteration));
  }
  if (inversion !== null) result.push(`inversion${inversion}`);
  return result;
}
function createPhrases(): Record<SpeechToken, string> {
  const phrases: Record<SpeechToken, string> = {};
  const addChord = (chord: Harmony) => {
    phrases[chordToken(chord)] = pitchText(chord.root) + words[chord.quality];
  };
  // Cover every accepted fixed root/key, including unusual spellings restored
  // from storage. Diatonic roots may require a third accidental in extreme keys.
  for (const letter of LETTERS) {
    for (let accidental = -2; accidental <= 2; accidental++) {
      const root = { letter, accidental };
      for (const quality of Object.keys(QUALITIES) as Harmony['quality'][])
        addChord({ root, quality });
      for (const mode of ['major', 'minor'] as const) {
        const key = { tonic: root, mode };
        phrases[keyToken(key)] =
          `${pitchText(root)}${words[mode]}${words.key}。${words.reference}。`;
        for (const seventh of [false, true])
          for (const chord of diatonic(key, seventh)) addChord(chord);
      }
    }
  }
  for (let degree = 1; degree <= 7; degree++)
    for (let alteration = -2; alteration <= 2; alteration++)
      phrases[degreeToken(degree, alteration)] =
        (alteration < 0 ? words.flat : words.sharp).repeat(
          Math.abs(alteration),
        ) + words[`degree${degree}` as keyof typeof words];
  for (let i = 0; i <= 4; i++)
    phrases[`inversion${i}`] = words[`inversion${i}` as keyof typeof words];
  return phrases;
}
export const speechPhrases = createPhrases();
