import type { Messages } from '../i18n/messages';
export function Keyboard({
  notes,
  melody = [],
  t,
}: {
  notes: number[];
  melody?: number[];
  t: Messages;
}) {
  const last = Math.max(84, ...notes, ...melody);
  const keys = Array.from({ length: last - 36 + 1 }, (_, i) => i + 36);
  const whites = keys.filter((n) => ![1, 3, 6, 8, 10].includes(n % 12)).length;
  let white = 0;
  return (
    <div
      className="keyboard"
      role="img"
      aria-label={`${t.keyboard}: ${t.chordPart} ${notes.join(', ')}; ${t.melodyPart} ${melody.join(', ')}`}
    >
      {keys.map((midi) => {
        const black = [1, 3, 6, 8, 10].includes(midi % 12);
        const left = black ? white - 0.32 : white++;
        return (
          <span
            key={midi}
            style={{
              left: `${(left / whites) * 100}%`,
              width: `${((black ? 0.64 : 1) / whites) * 100}%`,
            }}
            data-midi={midi}
            data-active={notes.includes(midi)}
            data-melody={melody.includes(midi)}
            className={`piano-key ${black ? 'black' : ''} ${notes.includes(midi) ? 'active' : ''} ${notes[0] === midi ? 'bass' : ''} ${melody.includes(midi) ? 'melody-key' : ''}`}
          >
            <span>
              {melody.includes(midi)
                ? '▲'
                : notes.includes(midi)
                  ? notes[0] === midi
                    ? '◆'
                    : '●'
                  : ''}
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
