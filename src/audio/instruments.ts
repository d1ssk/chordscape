export const INSTRUMENTS = ['electric', 'pad', 'piano', 'soft'] as const;
export type Instrument = (typeof INSTRUMENTS)[number];
export const DEFAULT_INSTRUMENT: Instrument = 'piano';
export const FALLBACK_INSTRUMENT: Instrument = 'electric';
export function isInstrument(value: unknown): value is Instrument {
  return (
    typeof value === 'string' &&
    (INSTRUMENTS as readonly string[]).includes(value)
  );
}
export const PIANO_NOTES = Array.from({ length: 17 }, (_, i) => 36 + i * 3);
export function pianoFile(midi: number) {
  return `${['C', '', '', 'Ds', '', '', 'Fs', '', '', 'A'][midi % 12]}${Math.floor(midi / 12) - 1}.mp3`;
}
