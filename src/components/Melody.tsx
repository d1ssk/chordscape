import type { Messages } from '../i18n/messages';
import {
  melodyName,
  type MelodyNote,
  type MelodySettings,
} from '../music/melody';
import { chordSymbol } from '../music/harmony';
import type { ChordEvent } from '../state/session';

export function toneLabel(kind: MelodyNote['kind'], t: Messages) {
  return {
    chord: t.melodyChordTone,
    scale: t.melodyScaleTone,
    chromatic: t.melodyChromaticTone,
    rest: t.melodyRest,
  }[kind];
}
export function PianoRoll({
  events,
  beat,
  active,
  t,
}: {
  events: ChordEvent[];
  beat?: number;
  active?: MelodyNote | null;
  t: Messages;
}) {
  const cursor = events.reduce((sum, event) => sum + event.duration, 0);
  const placed = events.map((event, i) => ({
    event,
    start: events.slice(0, i).reduce((sum, e) => sum + e.duration, 0),
  }));
  if (!events.some((e) => e.melody?.length))
    return <p className="muted">{t.melodyNoNotes}</p>;
  // Show the current 16-beat window; earlier/later bars remain inspectable
  // through the ordinary timeline selection.
  const pageStart = Math.floor((beat ?? 0) / 16) * 16;
  const visible = placed.filter(
    (p) => p.start < pageStart + 16 && p.start + p.event.duration > pageStart,
  );
  const notes = visible.flatMap((p) =>
    (p.event.melody ?? [])
      .map((note) => ({ ...note, start: p.start + note.beat }))
      .filter(
        (n) => n.start < pageStart + 16 && n.start + n.duration > pageStart,
      ),
  );
  const midis = notes.flatMap((n) => (n.midi === null ? [] : [n.midi]));
  const low = Math.min(60, ...midis),
    high = Math.max(84, ...midis),
    rows = high - low + 1;
  return (
    <section className="piano-roll-section">
      <div className="section-title">
        <h2>{t.pianoRoll}</h2>
        <span>
          {t.beat} {pageStart + 1}–
          {Number(Math.min(pageStart + 16, cursor).toFixed(3))}
        </span>
      </div>
      <svg
        className="piano-roll"
        viewBox={`0 0 720 ${rows * 7 + 46}`}
        role="img"
        aria-label={t.pianoRoll}
      >
        {Array.from({ length: rows }, (_, i) => (
          <g key={i}>
            <line
              x1="32"
              x2="718"
              y1={i * 7 + 28}
              y2={i * 7 + 28}
              className={(high - i) % 12 === 0 ? 'roll-octave' : 'roll-grid'}
            />
            {(high - i) % 12 === 0 && (
              <text
                x="0"
                y={i * 7 + 32}
              >{`C${Math.floor((high - i) / 12) - 1}`}</text>
            )}
          </g>
        ))}
        {Array.from({ length: 17 }, (_, i) => (
          <g key={i}>
            <line
              x1={32 + i * 42.5}
              x2={32 + i * 42.5}
              y1="22"
              y2={rows * 7 + 30}
              className={i % 4 ? 'roll-grid' : 'roll-octave'}
            />
            {i < 16 && (
              <text x={34 + i * 42.5} y={rows * 7 + 43}>
                {pageStart + i + 1}
              </text>
            )}
          </g>
        ))}
        {visible.map(({ event, start }) => (
          <text
            key={event.id}
            x={34 + (Math.max(pageStart, start) - pageStart) * 42.5}
            y="16"
          >
            {chordSymbol(event.chord)}
          </text>
        ))}
        {notes.map((note, i) => {
          const start = Math.max(pageStart, note.start),
            duration =
              Math.min(pageStart + 16, note.start + note.duration) - start;
          const x = 32 + (start - pageStart) * 42.5,
            y =
              note.midi === null ? rows * 7 + 17 : (high - note.midi) * 7 + 24;
          return (
            <g key={i} className={`roll-note ${note.kind}`}>
              <title>
                {note.midi === null ? t.melodyRest : melodyName(note)} ·{' '}
                {toneLabel(note.kind, t)} · {t.beat} {note.start + 1}
                {note.ornament
                  ? ` · ${note.ornament === 'passing' ? t.melodyPassing : t.melodyApproach}`
                  : ''}
              </title>
              <rect
                x={x}
                y={y}
                width={Math.max(1, duration * 42.5 - 1)}
                height="6"
                rx={note.kind === 'scale' ? 3 : 0}
              />
              <text x={x + 2} y={y + 5} className="roll-shape">
                {note.kind === 'chord'
                  ? '●'
                  : note.kind === 'scale'
                    ? '○'
                    : note.kind === 'chromatic'
                      ? '×'
                      : '—'}
              </text>
            </g>
          );
        })}
        {beat !== undefined && (
          <line
            className="roll-playhead"
            x1={32 + (beat - pageStart) * 42.5}
            x2={32 + (beat - pageStart) * 42.5}
            y1="20"
            y2={rows * 7 + 30}
          />
        )}
      </svg>
      <div className="roll-legend">
        <span>● {t.melodyChordTone}</span>
        <span>○ {t.melodyScaleTone}</span>
        <span>× {t.melodyChromaticTone}</span>
        <span>— {t.melodyRest}</span>
      </div>
      {active?.midi != null && (
        <p data-testid="melody-current">
          ♪ {melodyName(active)} · {toneLabel(active.kind, t)}
          {active.ornament &&
            ` · ${active.ornament === 'passing' ? t.melodyPassing : t.melodyApproach}`}
        </p>
      )}
      <details>
        <summary>{t.theory}</summary>
        <p className="muted">{t.melodyLegendHint}</p>
        <ol className="melody-notes">
          {notes.map((note, i) => (
            <li key={i}>
              {t.beat} {(note.start + 1).toFixed(2)} ·{' '}
              {note.midi === null ? t.melodyRest : melodyName(note)} ·{' '}
              {toneLabel(note.kind, t)}
              {note.ornament
                ? ` · ${note.ornament === 'passing' ? t.melodyPassing : t.melodyApproach}`
                : ''}
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
export function Melody({
  settings,
  events,
  onSettings,
  onRegenerate,
  onMode,
  t,
}: {
  settings: MelodySettings;
  events: ChordEvent[];
  onSettings: (patch: Partial<MelodySettings>) => void;
  onRegenerate: () => void;
  onMode: (live: boolean) => void;
  t: Messages;
}) {
  return (
    <div className="melody-scene">
      <section>
        <h2>{t.melodyGeneration}</h2>
        {!events.length && <p className="notice">{t.melodyNeedsProgression}</p>}
        <fieldset disabled={!events.length} className="controls melody-form">
          <legend className="sr-only">{t.melodyGeneration}</legend>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => onSettings({ enabled: e.target.checked })}
            />
            {t.melodyOn}
          </label>
          {(['density', 'activity', 'volume'] as const).map((name) => (
            <label key={name}>
              {name === 'density'
                ? t.melodyDensity
                : name === 'activity'
                  ? t.melodyActivity
                  : t.melodyVolume}{' '}
              · {Math.round(settings[name] * 100)}%
              <input
                type="range"
                min="0"
                max="1"
                step=".01"
                value={settings[name]}
                onChange={(e) => onSettings({ [name]: Number(e.target.value) })}
              />
            </label>
          ))}
          <label>
            {t.melodyRangeLow}
            <input
              type="number"
              min="48"
              max={settings.max - 12}
              value={settings.min}
              onChange={(e) => {
                const min = Number(e.target.value);
                if (
                  Number.isInteger(min) &&
                  min >= 48 &&
                  min <= settings.max - 12
                )
                  onSettings({ min });
              }}
            />
          </label>
          <label>
            {t.melodyRangeHigh}
            <input
              type="number"
              min={settings.min + 12}
              max="96"
              value={settings.max}
              onChange={(e) => {
                const max = Number(e.target.value);
                if (
                  Number.isInteger(max) &&
                  max <= 96 &&
                  max >= settings.min + 12
                )
                  onSettings({ max });
              }}
            />
          </label>
          <label>
            {t.seed}
            <input
              type="number"
              min="0"
              max="4294967295"
              value={settings.seed}
              onChange={(e) => {
                const seed = Number(e.target.value);
                if (Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff)
                  onSettings({ seed });
              }}
            />
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.holdMotif}
              onChange={(e) => onSettings({ holdMotif: e.target.checked })}
            />
            {t.holdMotif}
          </label>
        </fieldset>
        <p className="muted">
          {t.melodySettingsHint} {t.melodyToggleHint}
        </p>
        <p className="muted">
          {settings.version === 1 ? t.legacyMelodyHint : t.motifHint} ·{' '}
          {t.motifSeed}: {settings.motifSeed}
        </p>
        <button disabled={!events.length} onClick={onRegenerate}>
          {t.regenerateMelody}
        </button>
      </section>
      <section>
        <h2>{t.timelineMode}</h2>
        <p>{t.melodyTimelineHint}</p>
        <button onClick={() => onMode(false)}>{t.melodyTimeline}</button>
      </section>
      <section>
        <h2>{t.liveMode}</h2>
        <p>{t.melodyLiveHint}</p>
        <label>
          {t.liveTiming}
          <select
            value={settings.timing}
            onChange={(e) =>
              onSettings({ timing: e.target.value as MelodySettings['timing'] })
            }
          >
            <option value="immediate">{t.immediate}</option>
            <option value="nextBeat">{t.nextBeat}</option>
          </select>
        </label>
        <p className="muted">{t.liveTimingHint}</p>
        <button onClick={() => onMode(true)}>{t.melodyLive}</button>
      </section>
      <PianoRoll events={events} t={t} />
    </div>
  );
}
