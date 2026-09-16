export function Keyboard({
  notes,
  label,
  bassLabel,
}: {
  notes: number[];
  label: string;
  bassLabel: string;
}) {
  return (
    <div
      className="keyboard"
      role="img"
      aria-label={`${label}: ${notes.join(', ')}`}
    >
      {Array.from({ length: 37 }, (_, i) => i + 36).map((midi) => {
        const black = [1, 3, 6, 8, 10].includes(midi % 12);
        return (
          <span
            key={midi}
            data-midi={midi}
            data-active={notes.includes(midi)}
            className={`piano-key ${black ? 'black' : ''} ${notes.includes(midi) ? 'active' : ''} ${notes[0] === midi ? 'bass' : ''}`}
          >
            {notes.includes(midi) ? (notes[0] === midi ? '◆' : '●') : ''}
            <small>
              {midi % 12 === 0 ? `C${Math.floor(midi / 12) - 1}` : ''}
            </small>
            {notes[0] === midi && <span className="sr-only">{bassLabel}</span>}
          </span>
        );
      })}
    </div>
  );
}
