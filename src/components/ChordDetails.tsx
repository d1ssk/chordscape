import type { MelodyNote } from '../music/melody';
import { DualAnalysis, roleLabel } from './Circle';
import {
  analyze,
  chordSymbol,
  inversionOf,
  midiName,
  pc,
  pitchName,
  QUALITIES,
  roman,
  tones,
  voicedSymbol,
  resolvesTo,
  chromaticApproach,
  type Key,
} from '../music/harmony';
import type { ChordEvent } from '../state/session';
import type { Messages } from '../i18n/messages';
import { Keyboard } from './Keyboard';
export function ChordDetails({
  event,
  previous,
  next,
  currentKey,
  sounding,
  melodyNote,
  t,
  onBass,
  disabled,
}: {
  event: ChordEvent;
  previous?: ChordEvent;
  next?: ChordEvent;
  currentKey: Key;
  sounding: number[];
  melodyNote?: MelodyNote | null;
  t: Messages;
  onBass: (bass: number | null) => void;
  disabled: boolean;
}) {
  const analysis = analyze(event.chord, event.key);
  const pitches = tones(event.chord);
  const inversion = inversionOf(event.chord, event.notes);
  const contextChanged =
    pitchName(currentKey.tonic) !== pitchName(event.key.tonic) ||
    currentKey.mode !== event.key.mode;
  const resolved = resolvesTo(analysis, next?.chord);
  const approach = chromaticApproach(event.chord, next?.chord);
  const explanation =
    analysis.kind === 'secondary'
      ? `${chordSymbol(resolved ? next!.chord : analysis.target!)} ${resolved ? t.resolved : t.secondary}`
      : t[analysis.kind];
  const kept = previous
    ? event.notes.filter((n) => previous.notes.includes(n))
    : [];
  return (
    <section className="detail-section">
      <h2 className="sr-only">{t.details}</h2>
      <div className="chord-summary" aria-live="polite">
        <strong data-testid="chord-symbol">
          {voicedSymbol(event.chord, event.notes)}
        </strong>
        <span className="roman">{roman(analysis, inversion)}</span>
        <span className="badge">
          {
            [
              t.rootPosition,
              t.first,
              t.second,
              t.third,
              t.fourth,
              t.fifth,
              t.sixth,
            ][inversion]
          }
        </span>
      </div>
      <div className="note-line">
        <span>{pitches.map(pitchName).join(' – ')}</span>
        <span>
          {t.bass}:{' '}
          <b data-testid="actual-bass">
            {midiName(event.chord, event.notes[0])}
          </b>
        </span>
      </div>
      {event.modulation && (
        <div className="modulation-detail">
          <small>
            {t.modulationIntent} · {roleLabel(event.modulation.role, t)}
          </small>
          <DualAnalysis event={event} t={t} />
        </div>
      )}
      <Keyboard
        notes={sounding}
        melody={melodyNote?.midi == null ? [] : [melodyNote.midi]}
        t={t}
      />
      <div className="inversion-line">
        <label>
          {t.inversion}
          <select
            aria-label={`${t.details}: ${t.inversion}`}
            disabled={disabled}
            value={event.bass ?? 'auto'}
            onChange={(e) =>
              onBass(e.target.value === 'auto' ? null : Number(e.target.value))
            }
          >
            <option value="auto">{t.auto}</option>
            {pitches.map((p, i) => (
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
      </div>
      <details className="theory-details">
        <summary>{t.theory}</summary>
        <p>
          {t.context}: {pitchName(event.key.tonic)} {t[event.key.mode]}
        </p>
        <dl className="facts">
          <div>
            <dt>{t.root}</dt>
            <dd>{pitchName(event.chord.root)}</dd>
          </div>
          <div>
            <dt>{t.intervals}</dt>
            <dd>{QUALITIES[event.chord.quality].intervals.join(' · ')}</dd>
          </div>
          <div className="wide">
            <dt>{t.soundingNotes}</dt>
            <dd>
              {event.notes
                .map((n) => `${midiName(event.chord, n)} (${n})`)
                .join(' · ')}
            </dd>
          </div>
        </dl>
        <p className="muted">{t.keyboardHint}</p>
        {('romanSuffix' in QUALITIES[event.chord.quality] ||
          ['6', 'm6', 'add9', '9', 'maj9', 'm9'].includes(
            event.chord.quality,
          )) && <p className="muted">{t.extendedRomanHint}</p>}
        {event.intent && (
          <p className="generation-intent" data-testid="generation-intent">
            {t.generationIntent}: {roman(analysis)} ·{' '}
            {
              {
                template: t.purposeTemplate,
                secondary: t.purposeSecondary,
                borrowed: t.purposeBorrowed,
                cadence: t.purposeCadence,
              }[event.intent.purpose]
            }
          </p>
        )}
        <div className="explanation">
          {event.intent && <h3>{t.currentAnalysis}</h3>}
          <p>{explanation}</p>
          {analysis.kind === 'borrowed' && (
            <p>
              {t.borrowedFrom}: {pitchName(event.key.tonic)}{' '}
              {event.key.mode === 'major' ? t.minor : t.major}
            </p>
          )}
          {approach !== null && (
            <p>{approach < 0 ? t.approachDown : t.approachUp}</p>
          )}
          <p>
            {t.changed}: {analysis.changed.map(pitchName).join(' · ') || t.none}
          </p>
          <p>
            {t.inKey}:{' '}
            {pitches
              .filter((p) => !analysis.changed.some((c) => pc(c) === pc(p)))
              .map(pitchName)
              .join(' · ') || t.none}
          </p>
          <p>
            {t.function}: {analysis.functions.join(' / ') || '◇'}
          </p>
          {contextChanged && (
            <p>
              {t.currentContext}:{' '}
              {roman(analyze(event.chord, currentKey), inversion)}
            </p>
          )}
          {previous && (
            <p>
              {t.common}:{' '}
              {kept.map((n) => midiName(event.chord, n)).join(' · ') || t.none}
            </p>
          )}
        </div>
      </details>
    </section>
  );
}
