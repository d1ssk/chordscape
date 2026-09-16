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
  t,
  onBass,
  disabled,
}: {
  event: ChordEvent;
  previous?: ChordEvent;
  next?: ChordEvent;
  currentKey: Key;
  sounding: number[];
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
  const resolved =
    analysis.target &&
    next &&
    pc(next.chord.root) === pc(analysis.target.root) &&
    next.chord.quality === analysis.target.quality;
  const explanation =
    analysis.kind === 'secondary'
      ? `${chordSymbol(analysis.target!)} ${resolved ? t.resolved : t.secondary}`
      : t[analysis.kind];
  const kept = previous
    ? event.notes.filter((n) => previous.notes.includes(n))
    : [];
  return (
    <section className="detail-section">
      <div className="section-title">
        <h2>{t.details}</h2>
        <span>
          {t.context}: {pitchName(event.key.tonic)} {t[event.key.mode]}
        </span>
      </div>
      <div className="chord-summary" aria-live="polite">
        <strong data-testid="chord-symbol">
          {voicedSymbol(event.chord, event.notes)}
        </strong>
        <span className="roman">{roman(analysis, inversion)}</span>
        <span className="badge">
          {[t.rootPosition, t.first, t.second, t.third][inversion]}
        </span>
      </div>
      <dl className="facts">
        <div>
          <dt>{t.notes}</dt>
          <dd>{pitches.map(pitchName).join(' – ')}</dd>
        </div>
        <div>
          <dt>{t.intervals}</dt>
          <dd>{QUALITIES[event.chord.quality].intervals.join(' · ')}</dd>
        </div>
        <div>
          <dt>{t.root}</dt>
          <dd>{pitchName(event.chord.root)}</dd>
        </div>
        <div>
          <dt>{t.bass}</dt>
          <dd data-testid="actual-bass">
            {midiName(event.chord, event.notes[0])}
          </dd>
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
              {[t.rootPosition, t.first, t.second, t.third][i]} · {pitchName(p)}
            </option>
          ))}
        </select>
      </label>
      <h3>{t.keyboard}</h3>
      <Keyboard notes={sounding} t={t} />
      <p className="muted">{t.keyboardHint}</p>
      <div className="explanation">
        <p>{explanation}</p>
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
    </section>
  );
}
