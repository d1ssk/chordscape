import {
  chordSymbol,
  parsePitch,
  pitchName,
  QUALITIES,
  ROOTS,
  type Harmony,
} from '../music/harmony';

export const CUSTOM_PALETTE_KEY = 'chordscape.customPalette.v1';

// Palette preferences are independent of the song and its JSON export.
export function loadCustomPalette(): { chords: Harmony[]; failed: boolean } {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(CUSTOM_PALETTE_KEY) ?? '[]',
    );
    if (!Array.isArray(value)) throw new Error('Invalid palette');
    const chords: Harmony[] = value.map((item: unknown) => {
      if (!item || typeof item !== 'object') throw new Error('Invalid chord');
      const { root, quality } = item as Record<string, unknown>;
      if (
        typeof root !== 'string' ||
        !(ROOTS as readonly string[]).includes(root) ||
        typeof quality !== 'string' ||
        !Object.hasOwn(QUALITIES, quality)
      )
        throw new Error('Invalid chord');
      return { root: parsePitch(root), quality: quality as Harmony['quality'] };
    });
    return {
      chords: [
        ...new Map(chords.map((chord) => [chordSymbol(chord), chord])).values(),
      ],
      failed: false,
    };
  } catch {
    return { chords: [], failed: true };
  }
}

export function saveCustomPalette(chords: Harmony[]): boolean {
  try {
    localStorage.setItem(
      CUSTOM_PALETTE_KEY,
      JSON.stringify(
        chords.map((chord) => ({
          root: pitchName(chord.root),
          quality: chord.quality,
        })),
      ),
    );
    return true;
  } catch {
    return false;
  }
}
