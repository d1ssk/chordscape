import { describe, expect, it } from 'vitest';
import { majorTriads, symbol } from './theory';
describe('major triads', () => {
  it('derives all seven C major chords and Roman numerals', () => {
    const chords = majorTriads('C');
    expect(chords.map(symbol)).toEqual([
      'C',
      'Dm',
      'Em',
      'F',
      'G',
      'Am',
      'Bdim',
    ]);
    expect(chords.map((c) => c.roman)).toEqual([
      'I',
      'ii',
      'iii',
      'IV',
      'V',
      'vi',
      'vii°',
    ]);
    expect(chords.map((c) => c.notes)).toEqual([
      ['C', 'E', 'G'],
      ['D', 'F', 'A'],
      ['E', 'G', 'B'],
      ['F', 'A', 'C'],
      ['G', 'B', 'D'],
      ['A', 'C', 'E'],
      ['B', 'D', 'F'],
    ]);
    expect(chords[6].midi).toEqual([59, 62, 65]);
  });
  it('spells F major with B flat', () =>
    expect(majorTriads('F')[3].notes).toEqual(['B♭', 'D', 'F']));
});
