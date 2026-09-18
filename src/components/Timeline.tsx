import { keyEventsFor } from '../music/modulation';
import { keyLabel } from './Circle';
import type { Messages } from '../i18n/messages';
import {
  analyze,
  roman,
  voicedSymbol,
  inversionOf,
  pitchName,
  tones,
  bassPitch,
} from '../music/harmony';
import type { ChordEvent, Edit } from '../state/session';
import { canShiftOctave } from '../music/voicing';
import { BassSelect } from './BassSelect';
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
  const keyEvents = keyEventsFor(events);
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
                    {String(index + 1).padStart(2, '0')} · {t.beat}{' '}
                    {Number((start + 1).toFixed(3))}
                  </small>
                  <strong>
                    {voicedSymbol(event.chord, event.notes, event.addedBass)}
                  </strong>
                  <span>
                    {event.addedBass && `${t.upperChord}: `}
                    {roman(
                      analyze(event.chord, event.key),
                      event.addedBass
                        ? 0
                        : inversionOf(event.chord, event.notes),
                    )}
                  </span>
                  {keyEvents.length > 1 &&
                    keyEvents.some((k) => k.eventId === event.id) && (
                      <small className="boundary">
                        ↳ {keyLabel(event.key, t)}
                      </small>
                    )}
                  <small>
                    {Number(event.duration.toFixed(3))} {t.beat}
                    {event.bass !== null || event.addedBass
                      ? ` · ${t.fixed}`
                      : ''}
                  </small>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {keyEvents.length > 1 && (
        <details className="key-events">
          <summary>{t.keyEvents}</summary>
          <ol>
            {keyEvents.map((k) => (
              <li key={k.eventId}>
                {t.beat} {k.beat + 1} · {keyLabel(k.key, t)} ·{' '}
                {k.intent === 'initial'
                  ? t.initialKey
                  : k.intent === 'selection'
                    ? t.selectedContext
                    : k.intent === 'pivot'
                      ? t.pivotBridge
                      : t.directBridge}
              </li>
            ))}
          </ol>
        </details>
      )}
      {selected?.live && (
        <p className="muted live-timing">
          {t.liveApplied}: {(selected.live.appliedBeat + 1).toFixed(3)}
          {selected.live.requestedBeat !== null &&
            ` · ${t.liveRequested}: ${(selected.live.requestedBeat + 1).toFixed(3)}`}
        </p>
      )}
      {!selected && (
        <fieldset className="editor" disabled>
          <legend>{t.editing}</legend>
          <p>{t.selectEvent}</p>
        </fieldset>
      )}
      {selected && (
        <div className="event-editor">
          <fieldset className="editor">
            <legend>
              {t.editing}:{' '}
              {voicedSymbol(selected.chord, selected.notes, selected.addedBass)}
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
              {selected.addedBass ? t.upperVoicing : t.inversion}
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
                    {
                      [
                        t.rootPosition,
                        t.first,
                        t.second,
                        t.third,
                        t.fourth,
                        t.fifth,
                        t.sixth,
                      ][i]
                    }{' '}
                    · {pitchName(p)}
                  </option>
                ))}
              </select>
            </label>
            <BassSelect
              value={selected.addedBass}
              onChange={(addedBass) =>
                onEdit({ type: 'event', id: selected.id, patch: { addedBass } })
              }
              t={t}
            />
            <div className="octave-controls" role="group" aria-label={t.octave}>
              <button
                disabled={
                  !canShiftOctave(selected.notes, -1, selected.addedBass)
                }
                onClick={() =>
                  onEdit({ type: 'octave', id: selected.id, octaves: -1 })
                }
              >
                {t.octaveDown}
              </button>
              <button
                disabled={
                  !canShiftOctave(selected.notes, 1, selected.addedBass)
                }
                onClick={() =>
                  onEdit({ type: 'octave', id: selected.id, octaves: 1 })
                }
              >
                {t.octaveUp}
              </button>
            </div>
          </fieldset>
        </div>
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
                {pitchName(bassPitch(e.chord, e.notes, e.addedBass))}
              </span>
            ))}
          </div>
        </details>
      )}
    </>
  );
}
