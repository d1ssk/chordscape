import type { Messages } from '../i18n/messages';
export function Keyboard({ notes, t }: { notes: number[]; t: Messages }) {
  const keys = Array.from({ length: 49 }, (_, i) => i + 36);
  let white = 0;
  return (
    <div
      className="keyboard"
      role="img"
      aria-label={`${t.keyboard}: ${notes.join(', ')}`}
    >
      {keys.map((midi) => {
        const black = [1, 3, 6, 8, 10].includes(midi % 12);
        const left = black ? white - 0.32 : white++;
        return (
          <span
            key={midi}
            style={{
              left: `${(left / 29) * 100}%`,
              width: `${((black ? 0.64 : 1) / 29) * 100}%`,
            }}
            data-midi={midi}
            data-active={notes.includes(midi)}
            className={`piano-key ${black ? 'black' : ''} ${notes.includes(midi) ? 'active' : ''} ${notes[0] === midi ? 'bass' : ''}`}
          >
            <span>
              {notes.includes(midi) ? (notes[0] === midi ? '◆' : '●') : ''}
            </span>
            <small>
              {midi % 12 === 0 ? `C${Math.floor(midi / 12) - 1}` : ''}
            </small>
          </span>
        );
      })}
    </div>
  );
}
