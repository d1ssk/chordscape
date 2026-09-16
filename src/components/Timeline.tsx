import type { Messages } from '../i18n/messages';
import {
  analyze,
  roman,
  voicedSymbol,
  inversionOf,
  pitchName,
  tones,
} from '../music/harmony';
import type { ChordEvent, Edit } from '../state/session';
export function Timeline({
  events,
  selectedId,
  playingId,
  onSelect,
  onEdit,
  t,
}: {
  events: ChordEvent[];
  selectedId: string | null;
  playingId?: string;
  onSelect: (event: ChordEvent) => void;
  onEdit: (edit: Edit) => void;
  t: Messages;
}) {
  const selected = events.find((e) => e.id === selectedId);

  return (
    <>
      {!events.length ? (
        <p className="empty">{t.empty}</p>
      ) : (
        <ol className="timeline">
          {events.map((event, index) => {
            const start = events
              .slice(0, index)
              .reduce((sum, item) => sum + item.duration, 0);
            return (
              <li
                key={event.id}
                className={playingId === event.id ? 'is-playing' : ''}
                draggable
                onDragStart={(e) =>
                  e.dataTransfer.setData('text/plain', event.id)
                }
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = events.findIndex(
                    (item) => item.id === e.dataTransfer.getData('text/plain'),
                  );
                  if (from < 0) return;
                  for (let n = 0; n < Math.abs(index - from); n++)
                    onEdit({
                      type: 'move',
                      id: events[from].id,
                      direction: index > from ? 1 : -1,
                    });
                }}
              >
                <button
                  className="event"
                  aria-pressed={selectedId === event.id}
                  aria-current={playingId === event.id ? 'step' : undefined}
                  onClick={() => onSelect(event)}
                >
                  <small>
                    {String(index + 1).padStart(2, '0')} · {t.beat} {start + 1}
                  </small>
                  <strong>{voicedSymbol(event.chord, event.notes)}</strong>
                  <span>
                    {roman(
                      analyze(event.chord, event.key),
                      inversionOf(event.chord, event.notes),
                    )}
                  </span>
                  <small>
                    {event.duration} {t.beat}
                    {event.bass !== null ? ` · ${t.fixed}` : ''}
                  </small>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {selected && (
        <details className="editor-disclosure">
          <summary>
            {t.editing}: {voicedSymbol(selected.chord, selected.notes)}
          </summary>
          <fieldset className="editor">
            <legend>
              {t.editing}: {voicedSymbol(selected.chord, selected.notes)}
            </legend>
            <button
              disabled={events[0].id === selected.id}
              onClick={() =>
                onEdit({ type: 'move', id: selected.id, direction: -1 })
              }
            >
              ← {t.left}
            </button>
            <button
              disabled={events.at(-1)!.id === selected.id}
              onClick={() =>
                onEdit({ type: 'move', id: selected.id, direction: 1 })
              }
            >
              {t.right} →
            </button>
            <button
              disabled={events.length >= 256}
              onClick={() =>
                onEdit({
                  type: 'duplicate',
                  id: selected.id,
                  newId: crypto.randomUUID(),
                })
              }
            >
              {t.duplicate}
            </button>
            <button onClick={() => onEdit({ type: 'delete', id: selected.id })}>
              {t.remove}
            </button>
            <label>
              {t.duration}
              <input
                type="number"
                min="0.25"
                max="16"
                step="0.25"
                value={selected.duration}
                onChange={(e) => {
                  const duration = Number(e.target.value);
                  if (duration >= 0.25 && duration <= 16)
                    onEdit({
                      type: 'event',
                      id: selected.id,
                      patch: { duration },
                    });
                }}
              />
            </label>
            <label>
              {t.inversion}
              <select
                value={selected.bass ?? 'auto'}
                onChange={(e) =>
                  onEdit({
                    type: 'event',
                    id: selected.id,
                    patch: {
                      bass:
                        e.target.value === 'auto'
                          ? null
                          : Number(e.target.value),
                    },
                  })
                }
              >
                <option value="auto">{t.auto}</option>
                {tones(selected.chord).map((p, i) => (
                  <option key={i} value={i}>
                    {[t.rootPosition, t.first, t.second, t.third, t.fourth][i]}{' '}
                    · {pitchName(p)}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
        </details>
      )}
      {events.length > 0 && (
        <details className="motion">
          <summary>{t.motion}</summary>
          <div>
            <span>{t.root}</span>
            {events.map((e) => (
              <span key={e.id}>{pitchName(e.chord.root)}</span>
            ))}
          </div>
          <div>
            <span>{t.bass}</span>
            {events.map((e) => (
              <span key={e.id}>
                {pitchName(tones(e.chord)[inversionOf(e.chord, e.notes)])}
              </span>
            ))}
          </div>
        </details>
      )}
    </>
  );
}
