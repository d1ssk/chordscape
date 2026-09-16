import {
  analyze,
  chordSymbol,
  roman,
  type Harmony,
  type Key,
} from '../music/harmony';
export function Palette({
  chords,
  context,
  disabled,
  onChoose,
  selected,
}: {
  chords: Harmony[];
  context: Key;
  disabled: boolean;
  onChoose: (chord: Harmony) => void;
  selected: string;
}) {
  return (
    <div className="palette">
      {chords.map((chord) => {
        const analysis = analyze(chord, context);
        const name = chordSymbol(chord);
        const numeral = roman(analysis);
        return (
          <button
            key={name}
            disabled={disabled}
            aria-label={`${name} ${numeral}`}
            aria-pressed={selected === name}
            onClick={() => onChoose(chord)}
          >
            <strong>{name}</strong>
            <span>{numeral}</span>
            <small>{analysis.functions.join(' / ') || '◇'}</small>
          </button>
        );
      })}
    </div>
  );
}
