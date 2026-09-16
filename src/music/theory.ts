export interface Chord {
  root: string;
  quality: 'major' | 'minor' | 'dim';
  notes: string[];
  midi: number[];
  roman: string;
}
const letters = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const naturals = [0, 2, 4, 5, 7, 9, 11];
export function majorTriads(tonic: string): Chord[] {
  const start = letters.indexOf(tonic);
  if (start < 0) throw new Error('Unsupported tonic');
  const scale = [0, 2, 4, 5, 7, 9, 11].map((step, i) => {
    const letter = (start + i) % 7;
    const pc = (naturals[start] + step) % 12;
    const delta = ((pc - naturals[letter] + 18) % 12) - 6;
    return {
      name:
        letters[letter] + (delta > 0 ? '♯'.repeat(delta) : '♭'.repeat(-delta)),
      pc,
    };
  });
  return scale.map((root, i) => {
    const tones = [0, 2, 4].map((offset) => scale[(i + offset) % 7]);
    let last = 47;
    return {
      root: root.name,
      quality: (
        ['major', 'minor', 'minor', 'major', 'major', 'minor', 'dim'] as const
      )[i],
      notes: tones.map((n) => n.name),
      midi: tones.map((n) => {
        let midi = 48 + n.pc;
        while (midi <= last) midi += 12;
        last = midi;
        return midi;
      }),
      roman: ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'][i],
    };
  });
}
export function symbol(chord: Chord) {
  return chord.root + { major: '', minor: 'm', dim: 'dim' }[chord.quality];
}
