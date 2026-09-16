import { useMemo, useState, type KeyboardEvent } from 'react';
import {
  analyze,
  chordSymbol,
  inversionOf,
  pitchName,
  roman,
  type Key,
} from '../music/harmony';
import {
  buildBridge,
  chordInKey,
  circleKeys,
  commonChords,
  equivalentKey,
  keyEventsFor,
  sameKey,
  sharedTones,
  type ModulationIntent,
} from '../music/modulation';
import type { ChordEvent, Settings } from '../state/session';
import type { Messages } from '../i18n/messages';

export function keyLabel(key: Key, t: Messages) {
  return `${pitchName(key.tonic)} ${t[key.mode]}`;
}
export function roleLabel(role: ModulationIntent['role'], t: Messages) {
  return {
    departure: t.roleDeparture,
    pivot: t.rolePivot,
    dominant: t.roleDominant,
    arrival: t.roleArrival,
    cadence: t.roleCadence,
  }[role];
}
export function DualAnalysis({ event, t }: { event: ChordEvent; t: Messages }) {
  const m = event.modulation;
  if (!m) return null;
  const inversion = inversionOf(event.chord, event.notes);
  const oldChord = chordInKey(event.chord, m.from);
  const newChord = chordInKey(event.chord, m.to);
  return (
    <div className="dual-analysis" data-testid="dual-analysis">
      <span>
        {t.oldKey} {keyLabel(m.from, t)}:{' '}
        <b>{roman(analyze(oldChord, m.from), inversion)}</b>
        {chordSymbol(oldChord) !== chordSymbol(event.chord) &&
          ` (${chordSymbol(oldChord)})`}
      </span>
      <span>
        {t.newKey} {keyLabel(m.to, t)}:{' '}
        <b>{roman(analyze(newChord, m.to), inversion)}</b>
        {chordSymbol(newChord) !== chordSymbol(event.chord) &&
          ` (${chordSymbol(newChord)})`}
      </span>
    </div>
  );
}
export function Circle({
  settings,
  events,
  currentKey,
  stopped,
  canPlay,
  onSelectKey,
  onAudition,
  onAppend,
  onTravel,
  t,
}: {
  settings: Settings;
  events: ChordEvent[];
  currentKey: Key;
  stopped: boolean;
  canPlay: boolean;
  onSelectKey: (key: Key) => void;
  onAudition: (events: ChordEvent[]) => void;
  onAppend: (events: ChordEvent[]) => void;
  onTravel: (direction: 1 | -1, cadence: boolean) => void;
  t: Messages;
}) {
  const [target, setTarget] = useState<Key>({
    tonic: { letter: 'G', accidental: 0 },
    mode: 'major',
  });
  const [flats, setFlats] = useState(false);
  const [propose, setPropose] = useState(false);
  const [cadence, setCadence] = useState(false);
  const [direction, setDirection] = useState<1 | -1>(1);
  const from = events.at(-1)?.key ?? settings.key;
  const plan = useMemo(
    () =>
      buildBridge({
        from,
        to: target,
        duration: settings.duration,
        seventh: settings.seventh,
        policy: settings.policy,
        cadence,
      }),
    [
      from,
      target,
      settings.duration,
      settings.seventh,
      settings.policy,
      cadence,
    ],
  );
  const insertion = events.length ? plan.slice(1) : plan;
  const start = events.reduce((n, e) => n + e.duration, 0);
  const boundaries = keyEventsFor([...events, ...insertion]);
  const common = commonChords(currentKey, target, settings.seventh);
  const rows = circleKeys(flats);
  const keys = [...rows.map((r) => r.major), ...rows.map((r) => r.minor)];
  const choose = (key: Key) => {
    setTarget(key);
    setPropose(false);
  };
  function keyboard(event: KeyboardEvent<SVGGElement>, index: number) {
    const delta = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 12, ArrowUp: 12 }[
      event.key
    ];
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(keys[index]);
    }
    if (delta !== undefined) {
      event.preventDefault();
      const next =
        delta === 12
          ? (index + 12) % 24
          : Math.floor(index / 12) * 12 + (((index % 12) + delta + 12) % 12);
      event.currentTarget.ownerSVGElement
        ?.querySelector<SVGGElement>(`[data-slot="${next}"]`)
        ?.focus();
      choose(keys[next]);
    }
  }
  return (
    <div className="circle-scene">
      <section className="circle-panel">
        <div className="section-title">
          <h2>
            {t.currentKey}:{' '}
            <span data-testid="circle-current">{keyLabel(currentKey, t)}</span>
          </h2>
          <label className="circle-spelling">
            {t.enharmonic}
            <select
              value={flats ? 'flat' : 'sharp'}
              onChange={(e) => setFlats(e.target.value === 'flat')}
            >
              <option value="sharp">{t.sharpNames}</option>
              <option value="flat">{t.flatNames}</option>
            </select>
          </label>
        </div>
        <svg
          className="fifths"
          viewBox="0 0 360 360"
          role="group"
          aria-label={t.circleScene}
        >
          <circle cx="180" cy="180" r="150" className="circle-track" />
          <circle cx="180" cy="180" r="100" className="circle-track" />
          <text x="180" y="168" className="circle-center">
            {t.targetKey}
          </text>
          <text x="180" y="191" className="circle-center target-name">
            {pitchName(target.tonic)}
            {target.mode === 'minor' ? 'm' : ''}
          </text>
          {keys.map((key, i) => {
            const angle = ((i % 12) * Math.PI) / 6 - Math.PI / 2;
            const radius = i < 12 ? 150 : 100;
            const active = equivalentKey(key, currentKey),
              chosen = equivalentKey(key, target);
            return (
              <g
                key={i}
                data-slot={i}
                role="button"
                tabIndex={0}
                aria-label={keyLabel(key, t)}
                aria-pressed={chosen}
                aria-current={active ? 'true' : undefined}
                className={`circle-key ${active ? 'current' : ''} ${chosen ? 'candidate' : ''}`}
                transform={`translate(${180 + Math.cos(angle) * radius},${180 + Math.sin(angle) * radius})`}
                onClick={() => choose(key)}
                onKeyDown={(e) => keyboard(e, i)}
              >
                <circle r="23" />
                <text y="1">
                  {pitchName(key.tonic)}
                  {key.mode === 'minor' ? 'm' : ''}
                </text>
                {active && (
                  <text y="17" className="key-marker">
                    ●
                  </text>
                )}
                {chosen && (
                  <path d="M -9 -18 L 9 -18" className="target-marker" />
                )}
              </g>
            );
          })}
        </svg>
        <p className="circle-legend">
          ● {t.currentKey} · ━ {t.targetKey}: {keyLabel(target, t)}
        </p>
        <p className="muted">{t.circleHint}</p>
      </section>
      <div className="circle-options">
        <section>
          <h2>
            {t.targetKey}: {keyLabel(target, t)}
          </h2>
          <p>
            {t.sharedTones}:{' '}
            <span data-testid="shared-tones">
              {sharedTones(currentKey, target)
                .map((p) =>
                  pitchName(p.from) === pitchName(p.to)
                    ? pitchName(p.from)
                    : `${pitchName(p.from)}=${pitchName(p.to)}`,
                )
                .join(' · ') || t.none}
            </span>
          </p>
          <p>
            {t.commonChords} · {settings.seventh ? t.sevenths : t.triads}:{' '}
            <b data-testid="common-chords">
              {common.map(chordSymbol).join(' · ') || t.none}
            </b>
          </p>
          <button
            disabled={!stopped || sameKey(settings.key, target)}
            onClick={() => onSelectKey(target)}
          >
            {t.selectKey}
          </button>
          <p className="muted">{t.selectKeyHint}</p>
          <button
            className="primary"
            disabled={!stopped}
            onClick={() => setPropose(true)}
          >
            {t.modulate}
          </button>
        </section>
        {propose && (
          <section className="bridge-proposal">
            <h2>{t.bridge}</h2>
            <p>
              {t.bridgeFrom}: {keyLabel(from, t)} → {keyLabel(target, t)}
            </p>
            <p className="muted">{t.bridgeFromHint}</p>
            {!plan.length ? (
              <p>{t.sameKeyHint}</p>
            ) : (
              <>
                <p>
                  {plan[0].modulation?.method === 'pivot'
                    ? t.pivotBridge
                    : t.directBridge}
                </p>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={cadence}
                    disabled={!stopped}
                    onChange={(e) => setCadence(e.target.checked)}
                  />
                  {t.addCadence}
                </label>
                <ol className="bridge-list">
                  {insertion.map((event, i) => (
                    <li key={event.id}>
                      <div>
                        <strong>{chordSymbol(event.chord)}</strong> ·{' '}
                        {roleLabel(event.modulation!.role, t)} · {t.beat}{' '}
                        {start + i * settings.duration + 1}
                      </div>
                      <DualAnalysis event={event} t={t} />
                      {boundaries.some(
                        (k) => k.eventId === event.id && k.intent !== 'initial',
                      ) && (
                        <b className="boundary">
                          ↳ {t.keyBoundary}: {keyLabel(event.key, t)}
                        </b>
                      )}
                    </li>
                  ))}
                </ol>
                <p className="muted">{t.keyBoundaryHint}</p>
                <p className="muted">{t.modulationHint}</p>
                <div className="actions">
                  <button
                    disabled={!stopped || !canPlay}
                    onClick={() => onAudition(plan)}
                  >
                    {t.auditionBridge}
                  </button>
                  <button
                    disabled={
                      !stopped || events.length + insertion.length > 256
                    }
                    onClick={() => onAppend(insertion)}
                  >
                    {t.addBridge}
                  </button>
                </div>
                {events.length + insertion.length > 256 && (
                  <p role="alert">{t.limit}</p>
                )}
              </>
            )}
          </section>
        )}
        <section>
          <h2>{t.travel}</h2>
          <p className="muted">{t.travelHint}</p>
          <label>
            {t.travelDirection}
            <select
              disabled={!stopped}
              value={direction}
              onChange={(e) => setDirection(Number(e.target.value) as 1 | -1)}
            >
              <option value="1">{t.clockwise}</option>
              <option value="-1">{t.counterclockwise}</option>
            </select>
          </label>
          <button
            disabled={!stopped || !canPlay}
            onClick={() => onTravel(direction, cadence)}
          >
            {t.travelStart}
          </button>
        </section>
      </div>
    </div>
  );
}
