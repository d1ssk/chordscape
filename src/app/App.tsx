import { useEffect, useReducer, useRef, useState } from 'react';
import { useAudio } from './useAudio';
import {
  analyze,
  chordSymbol,
  defaultKey,
  diatonic,
  MAJOR_KEYS,
  MINOR_KEYS,
  outside,
  pitchName,
  transposeKey,
  voicedSymbol,
  type Harmony,
  type Key,
} from '../music/harmony';
import { chooseVoicing, type VoicingPolicy } from '../music/voicing';
import {
  editSession,
  exportSession,
  importSession,
  keyFromName,
  loadSession,
  makeEvent,
  MAX_EVENTS,
  newSession,
  reducer,
  revoice,
  STORAGE_KEY,
  type ChordEvent,
  type Edit,
} from '../state/session';
import { messages, type Locale } from '../i18n/messages';
import { Palette } from '../components/Palette';
import { Timeline } from '../components/Timeline';
import { Library } from '../components/Library';
import { ChordDetails } from '../components/ChordDetails';
const initialEvent = makeEvent(
  diatonic(defaultKey)[0],
  newSession(),
  'preview',
);
export function App() {
  const [loaded] = useState(loadSession);
  const [history, dispatch] = useReducer(reducer, {
    past: [],
    present: loaded.session,
    future: [],
  });
  const session = history.present;
  const s = session.settings;
  const t = messages[s.locale];
  const { engine, ready, level, playback } = useAudio();
  const [error, setError] = useState<keyof typeof t | null>(null);
  const [storage, setStorage] = useState<'saved' | 'saving' | 'storageError'>(
    loaded.failed ? 'storageError' : 'saved',
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState(
    loaded.session.events[0] ?? initialEvent,
  );
  const [comparison, setComparison] = useState<VoicingPolicy | null>(null);
  const [transpose, setTranspose] = useState(2);
  const sessionRef = useRef(session);
  const previousRef = useRef<ChordEvent | undefined>(undefined);
  const file = useRef<HTMLInputElement>(null);
  const running = playback.status === 'playing';
  const selected = session.events.find((e) => e.id === selectedId);
  const displayed = playback.event ?? selected ?? preview;
  const index = session.events.findIndex((e) => e.id === displayed.id);
  const previous = running
    ? (playback.previous ?? undefined)
    : index > 0
      ? session.events[index - 1]
      : undefined;
  const next = running
    ? (playback.next ?? undefined)
    : index >= 0
      ? session.events[index + 1]
      : undefined;
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  useEffect(() => {
    document.documentElement.lang = s.locale;
  }, [s.locale]);
  useEffect(() => {
    engine.current?.setVolume(s.volume);
    engine.current?.configure(s.tempo, s.loop);
  }, [engine, s.volume, s.tempo, s.loop]);
  useEffect(() => {
    if (loaded.failed && session === loaded.session) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, exportSession(session));
        setStorage('saved');
      } catch {
        setStorage('storageError');
      }
    }, 400);
    const flush = () => {
      try {
        localStorage.setItem(STORAGE_KEY, exportSession(session));
      } catch {
        /* Keep the in-memory session playable. */
      }
    };
    window.addEventListener('pagehide', flush);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pagehide', flush);
    };
  }, [session, loaded]);
  function edit(action: Edit) {
    if (playback.status === 'paused' && action.type !== 'settings') stop();
    setStorage('saving');
    dispatch(action);
  }
  async function enable() {
    try {
      if (!(await engine.current!.unlock()))
        throw new Error('Audio unavailable');
      engine.current!.setVolume(s.volume);
      setError(null);
    } catch {
      setError('error');
    }
  }
  function stop() {
    engine.current!.stop();
    setComparison(null);
  }
  function choose(chord: Harmony, record = s.record) {
    if (running) return;
    const event = makeEvent(
      chord,
      session,
      crypto.randomUUID(),
      previousRef.current?.notes,
    );
    if (record) {
      if (session.events.length >= MAX_EVENTS) {
        setError('limit');
        return;
      }
      edit({ type: 'append', event });
      setSelectedId(event.id);
    } else setSelectedId(null);
    setPreview(event);
    previousRef.current = event;
    engine.current!.audition(event);
    setComparison(null);
  }
  function select(event: ChordEvent) {
    setSelectedId(event.id);
    setPreview(event);
    if (!running && ready) {
      engine.current!.audition(event);
      previousRef.current = event;
      setComparison(null);
    }
  }
  function bass(value: number | null) {
    if (running) return;
    if (selected) {
      const action: Edit = {
        type: 'event',
        id: selected.id,
        patch: { bass: value },
      };
      const changed = editSession(session, action).events.find(
        (e) => e.id === selected.id,
      )!;
      edit(action);
      if (ready) engine.current!.audition(changed);
    } else {
      const input = { ...preview, bass: value };
      const changed = {
        ...input,
        notes: chooseVoicing(input, previousRef.current?.notes),
      };
      setPreview(changed);
      if (ready) engine.current!.audition(changed);
    }
  }
  function play(policy?: VoicingPolicy) {
    const source = () => {
      const current = sessionRef.current;
      return policy
        ? revoice(
            current.events.map((e) => ({ ...e, policy })),
            current.settings.loop,
          )
        : current.events;
    };
    setComparison(policy ?? null);
    engine.current!.play(source(), s.tempo, s.loop, source);
  }
  function changeMode(mode: Key['mode']) {
    let key = { ...s.key, mode };
    const names = mode === 'major' ? MAJOR_KEYS : MINOR_KEYS;
    if (!names.includes(pitchName(key.tonic))) key = transposeKey(key, 0);
    edit({ type: 'settings', patch: { key } });
  }
  async function readFile(upload: File | undefined) {
    if (!upload) return;
    try {
      if (upload.size > 1_000_000) throw new Error('Too large');
      const imported = importSession(await upload.text());
      stop();
      edit({ type: 'replace', session: imported });
      setSelectedId(null);
      setPreview(imported.events[0] ?? initialEvent);
      setError('imported');
    } catch {
      setError('importError');
    } finally {
      if (file.current) file.current.value = '';
    }
  }
  function download() {
    try {
      const url = URL.createObjectURL(
        new Blob([exportSession(session)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'chordscape-session.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError('exportError');
    }
  }
  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">{t.eyebrow}</p>
          <h1>
            Chordscape<span aria-hidden="true">◌</span>
          </h1>
          <p>{t.tagline}</p>
        </div>
        <label>
          {t.language}
          <select
            value={s.locale}
            onChange={(e) =>
              edit({
                type: 'settings',
                patch: { locale: e.target.value as Locale },
              })
            }
          >
            <option value="ja">日本語</option>
            <option value="en">English</option>
          </select>
        </label>
      </header>
      <section className="transport" aria-label={t.synth}>
        <button className="primary" onClick={() => void enable()}>
          {ready ? t.ready : t.enable}
        </button>
        <button
          disabled={!ready || !session.events.length || running}
          onClick={() => play()}
        >
          {t.play}
        </button>
        <button
          disabled={!ready || playback.status === 'stopped'}
          onClick={() =>
            playback.status === 'paused'
              ? engine.current!.resume()
              : engine.current!.pause()
          }
        >
          {playback.status === 'paused' ? t.resume : t.pause}
        </button>
        <button className="stop" onClick={stop}>
          ■ {t.stop}
        </button>
        <span role="status">
          {running
            ? t.playing
            : playback.status === 'paused'
              ? t.paused
              : playback.event
                ? t.sounding
                : t.idle}{' '}
          · {t.beat} {(playback.beat + 1).toFixed(1)}
        </span>
        <label className="volume">
          {t.volume}
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={s.volume}
            onChange={(e) =>
              edit({
                type: 'settings',
                patch: { volume: Number(e.target.value) },
              })
            }
          />
        </label>
        <meter
          aria-label={t.level}
          min="0"
          max="1"
          value={level}
          data-testid="audio-level"
        />
      </section>
      {error && (
        <p className="notice" role={error === 'imported' ? 'status' : 'alert'}>
          {t[error]}
        </p>
      )}
      <section className="key-panel">
        <div className="controls">
          <label>
            {t.key}
            <select
              value={pitchName(s.key.tonic)}
              onChange={(e) =>
                edit({
                  type: 'settings',
                  patch: { key: keyFromName(e.target.value, s.key.mode) },
                })
              }
            >
              {(s.key.mode === 'major' ? MAJOR_KEYS : MINOR_KEYS).map(
                (name) => (
                  <option key={name}>{name}</option>
                ),
              )}
            </select>
          </label>
          <label>
            {t.mode}
            <select
              value={s.key.mode}
              onChange={(e) => changeMode(e.target.value as Key['mode'])}
            >
              <option value="major">{t.major}</option>
              <option value="minor">{t.minor}</option>
            </select>
          </label>
          <label>
            {t.chordSize}
            <select
              value={s.seventh ? '7' : '3'}
              onChange={(e) =>
                edit({
                  type: 'settings',
                  patch: { seventh: e.target.value === '7' },
                })
              }
            >
              <option value="3">{t.triads}</option>
              <option value="7">{t.sevenths}</option>
            </select>
          </label>
          <label>
            {t.tempo}
            <input
              type="number"
              min="40"
              max="200"
              value={s.tempo}
              onChange={(e) => {
                const tempo = Number(e.target.value);
                if (tempo >= 40 && tempo <= 200)
                  edit({ type: 'settings', patch: { tempo } });
              }}
            />
          </label>
          <label>
            {t.duration}
            <select
              value={s.duration}
              onChange={(e) =>
                edit({
                  type: 'settings',
                  patch: { duration: Number(e.target.value) },
                })
              }
            >
              {[
                0.25,
                0.5,
                1,
                2,
                4,
                8,
                16,
                ...([0.25, 0.5, 1, 2, 4, 8, 16].includes(s.duration)
                  ? []
                  : [s.duration]),
              ].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={s.record}
              onChange={(e) =>
                edit({ type: 'settings', patch: { record: e.target.checked } })
              }
            />
            {t.record}
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={s.loop}
              onChange={(e) =>
                edit({ type: 'settings', patch: { loop: e.target.checked } })
              }
            />
            {t.loop}
          </label>
        </div>
        <p className="muted">{t.keyChangeHint}</p>
      </section>
      <section>
        <div className="section-title">
          <h2>{t.palette}</h2>
          <span>
            {pitchName(s.key.tonic)} {t[s.key.mode]}
          </span>
        </div>
        <p className="muted">{running ? t.recordHint : t.hint}</p>
        <Palette
          chords={diatonic(s.key, s.seventh)}
          context={s.key}
          disabled={!ready || running}
          onChoose={choose}
          selected={chordSymbol(displayed.chord)}
        />
        <details className="outside">
          <summary>{t.outside}</summary>
          <p className="muted">{t.outsideHint}</p>
          <Palette
            chords={outside(s.key)}
            context={s.key}
            disabled={!ready || running}
            onChoose={choose}
            selected={chordSymbol(displayed.chord)}
          />
        </details>
      </section>
      <section>
        <div className="section-title">
          <h2>
            {t.timeline}
            <span className="count">{session.events.length}</span>
          </h2>
          <div className="actions">
            <button
              disabled={!history.past.length}
              onClick={() => {
                if (playback.status === 'paused') stop();
                dispatch({ type: 'undo' });
                setStorage('saving');
              }}
            >
              {t.undo}
            </button>
            <button
              disabled={!history.future.length}
              onClick={() => {
                if (playback.status === 'paused') stop();
                dispatch({ type: 'redo' });
                setStorage('saving');
              }}
            >
              {t.redo}
            </button>
            <button
              disabled={!session.events.length}
              onClick={() => edit({ type: 'clear' })}
            >
              {t.clear}
            </button>
          </div>
        </div>
        {playback.event && running && (
          <p>
            {t.sounding}:{' '}
            {voicedSymbol(playback.event.chord, playback.event.notes)}
          </p>
        )}
        {playback.next && running && (
          <p className="muted">
            {t.next}: {voicedSymbol(playback.next.chord, playback.next.notes)}
          </p>
        )}
        {comparison && running && (
          <p>
            {t.comparison}: {comparison === 'root' ? t.rootMode : t.smooth}
          </p>
        )}
        <Timeline
          events={session.events}
          selectedId={selectedId}
          playingId={playback.event?.id}
          onSelect={select}
          onEdit={edit}
          t={t}
        />
        <div className="controls voicing-controls">
          <label>
            {t.voicing}
            <select
              value={s.policy}
              onChange={(e) =>
                edit({
                  type: 'policy',
                  policy: e.target.value as VoicingPolicy,
                })
              }
            >
              <option value="root">{t.rootMode}</option>
              <option value="smooth">{t.smooth}</option>
            </select>
          </label>
          <button
            disabled={!ready || !session.events.length}
            onClick={() => play('root')}
          >
            {t.compareRoot}
          </button>
          <button
            disabled={!ready || !session.events.length}
            onClick={() => play('smooth')}
          >
            {t.compareSmooth}
          </button>
        </div>
        <p className="muted">{t.compareHint}</p>
        <p className="muted">{t.smoothHint}</p>
        <details>
          <summary>{t.transpose}</summary>
          <p className="muted">{t.transposeHint}</p>
          <div className="controls">
            <label>
              {t.semitones}
              <input
                type="number"
                min="-12"
                max="12"
                value={transpose}
                onChange={(e) =>
                  setTranspose(
                    Math.max(
                      -12,
                      Math.min(12, Math.trunc(Number(e.target.value))),
                    ),
                  )
                }
              />
            </label>
            <button
              disabled={running || transpose === 0}
              onClick={() => {
                stop();
                edit({ type: 'transpose', semitones: transpose });
              }}
            >
              {t.transpose}
            </button>
          </div>
        </details>
      </section>
      <ChordDetails
        event={displayed}
        previous={previous}
        next={next}
        currentKey={s.key}
        sounding={playback.event?.notes ?? []}
        t={t}
        onBass={bass}
        disabled={running}
      />
      <Library
        locale={s.locale}
        t={t}
        disabled={!ready || running}
        onAudition={(chord) => choose(chord, false)}
        onAdd={(chord) => choose(chord, true)}
      />
      <section className="save-panel">
        <div className="controls">
          <button onClick={download}>{t.export}</button>
          <button onClick={() => file.current?.click()}>{t.import}</button>
          <input
            className="sr-only"
            aria-label={t.file}
            ref={file}
            type="file"
            accept="application/json,.json"
            onChange={(e) => void readFile(e.target.files?.[0])}
          />
          <span role="status">{t[storage]}</span>
        </div>
      </section>
      <footer>
        <p>{t.functionHint}</p>
        <p>{t.romanHint}</p>
        <p>
          {t.synth} · {t.footer}
        </p>
        <span className="sr-only">
          {analyze(displayed.chord, displayed.key).kind}
        </span>
      </footer>
    </main>
  );
}
