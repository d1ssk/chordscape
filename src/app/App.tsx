import { Listen } from '../components/Listen';
import { Melody, PianoRoll } from '../components/Melody';
import { generateMelody, type MelodySettings } from '../music/melody';
import { Circle, DualAnalysis, keyLabel } from '../components/Circle';
import { buildCircleTravel, sameKey } from '../music/modulation';
import { useEffect, useReducer, useRef, useState } from 'react';
import { useAudio } from './useAudio';
import { useScene } from './useScene';
import { INSTRUMENTS, type Instrument } from '../audio/instruments';
import {
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
import { OutsidePalette } from '../components/OutsidePalette';
import { loadCustomPalette, saveCustomPalette } from '../state/customPalette';
import { Timeline } from '../components/Timeline';
import { Library } from '../components/Library';
import { ChordDetails } from '../components/ChordDetails';
import { Generator } from '../components/Generator';
import {
  generateProgression,
  PreparedProgressions,
  type GeneratedPhrase,
} from '../music/generation';
const initialEvent = makeEvent(
  diatonic(defaultKey)[0],
  newSession(),
  'preview',
);
export function App() {
  const [customPalette, setCustomPalette] = useState(loadCustomPalette);
  const [loaded] = useState(loadSession);
  const [history, dispatch] = useReducer(reducer, {
    past: [],
    present: loaded.session,
    future: [],
  });
  const session = history.present;
  const s = session.settings;
  const t = messages[s.locale];
  const { engine, ready, level, playback, sound, observer } = useAudio();
  const { scene, navigate } = useScene();
  const [listenInitial, setListenInitial] = useState<Harmony | null>(null);
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
  const [nextReady, setNextReady] = useState(false);
  const [liveMode, setLiveMode] = useState(false);
  const liveBase = useRef<ChordEvent[] | null>(null);
  const liveVersion = useRef(-1);
  const [continuous, setContinuous] = useState(false);
  const [auditionPlan, setAuditionPlan] = useState<ChordEvent[] | null>(null);
  const auditioning = useRef(false);
  const autoRun = useRef<PreparedProgressions | null>(null);
  const autoApplied = useRef(0);
  const sessionRef = useRef(session);
  const previousRef = useRef<ChordEvent | undefined>(undefined);
  const file = useRef<HTMLInputElement>(null);
  const running = playback.status === 'playing';
  const currentKey =
    playback.status !== 'stopped' ? (playback.key ?? s.key) : s.key;
  const selected = session.events.find((e) => e.id === selectedId);
  const displayed = playback.event ?? selected ?? preview;
  const viewEvents = auditionPlan ?? session.events;
  const index = viewEvents.findIndex((e) => e.id === displayed.id);
  const previous = running
    ? (playback.previous ?? undefined)
    : index > 0
      ? viewEvents[index - 1]
      : undefined;
  const next = running
    ? (playback.next ?? undefined)
    : index >= 0
      ? (viewEvents[index + 1] ?? (s.loop ? viewEvents[0] : undefined))
      : undefined;
  useEffect(() => {
    if (ready) void engine.current?.setInstrument(s.instrument);
  }, [engine, ready, s.instrument]);
  useEffect(() => {
    document.title =
      scene === 'play'
        ? 'Chordscape'
        : `${scene === 'library' ? t.library : scene === 'generate' ? t.generateScene : scene === 'circle' ? t.circleScene : scene === 'melody' ? t.melodyScene : scene === 'listen' ? t.listenScene : t.settings} · Chordscape`;
  }, [scene, t]);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  useEffect(() => {
    document.documentElement.lang = s.locale;
  }, [s.locale]);
  useEffect(() => {
    engine.current?.setMelody(s.melody);
  }, [engine, s.melody]);
  useEffect(() => {
    engine.current?.setVolume(s.volume);
    engine.current?.configure(s.tempo, !auditionPlan && (continuous || s.loop));
  }, [engine, s.volume, s.tempo, s.loop, continuous, auditionPlan]);
  useEffect(() => {
    observer.current = (state) => {
      if (
        state.live &&
        liveBase.current &&
        state.live.recordVersion !== liveVersion.current
      ) {
        liveVersion.current = state.live.recordVersion;
        if (state.live.recorded.length) {
          const action: Edit = {
            type: 'liveCapture',
            events: [...liveBase.current, ...state.live.recorded],
          };
          sessionRef.current = editSession(sessionRef.current, action);
          dispatch(action);
          setStorage('saving');
        }
        if (state.live.limit) setError('limit');
      }
      if (state.status === 'stopped' && auditioning.current) {
        auditioning.current = false;
        setAuditionPlan(null);
      }
      if (
        state.status === 'playing' &&
        state.event &&
        !auditioning.current &&
        !sameKey(sessionRef.current.settings.key, state.event.key)
      ) {
        dispatch({ type: 'clockKey', key: state.event.key });
        setStorage('saving');
      }
      const run = autoRun.current;
      if (!run) return;
      if (state.status === 'stopped') {
        run.stop();
        autoRun.current = null;
        setContinuous(false);
        return;
      }
      const cycle = state.cycle;
      setNextReady(Boolean(run.get((cycle ?? 0) + 1)));
      const phrase = cycle === undefined ? undefined : run.get(cycle);
      if (phrase && cycle !== autoApplied.current) {
        autoApplied.current = cycle!;
        dispatch({ type: 'autoPhrase', phrase });
        setSelectedId(null);
        setPreview(phrase.events[0]);
        setStorage('saving');
      }
    };
    return () => {
      observer.current = null;
    };
  }, [observer]);
  useEffect(() => () => autoRun.current?.stop(), []);
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
    if (
      (autoRun.current ||
        auditioning.current ||
        (playback.live && playback.status !== 'stopped')) &&
      action.type !== 'settings'
    )
      stop();
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
    auditioning.current = false;
    setAuditionPlan(null);
    const activePhrase =
      playback.cycle === undefined
        ? undefined
        : autoRun.current?.get(playback.cycle);
    if (activePhrase && autoApplied.current !== playback.cycle) {
      autoApplied.current = playback.cycle!;
      dispatch({ type: 'autoPhrase', phrase: activePhrase });
    }
    autoRun.current?.stop();
    autoRun.current = null;
    setContinuous(false);
    engine.current?.stop();
    liveBase.current = null;
    setComparison(null);
  }
  function choose(chord: Harmony, record = s.record) {
    if (running && !(liveMode && scene === 'play')) return;
    const event = makeEvent(
      chord,
      { ...session, settings: { ...s, key: currentKey } },
      crypto.randomUUID(),
      liveMode && playback.live
        ? playback.event?.notes
        : previousRef.current?.notes,
    );
    if (liveMode && scene === 'play') {
      if (playback.live && playback.status === 'playing') {
        engine.current!.changeLive(event, s.melody.timing, record);
      } else {
        stop();
        liveBase.current = [...sessionRef.current.events];
        liveVersion.current = -1;
        if (record) dispatch({ type: 'beginLive' });
        engine.current!.startLive(
          event,
          s.tempo,
          s.melody,
          record,
          MAX_EVENTS - liveBase.current.length,
        );
      }
      setPreview(event);
      setSelectedId(null);
      previousRef.current = event;
      return;
    }
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
    if (!running && ready && !sound.loading) {
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
      if (ready && !sound.loading) engine.current!.audition(changed);
    } else {
      const input = { ...preview, bass: value };
      const changed = {
        ...input,
        notes: chooseVoicing(input, previousRef.current?.notes),
      };
      setPreview(changed);
      if (ready && !sound.loading) engine.current!.audition(changed);
    }
  }
  function play(policy?: VoicingPolicy) {
    if (playback.live && playback.status !== 'stopped') stop();
    setLiveMode(false);
    auditioning.current = false;
    setAuditionPlan(null);
    autoRun.current?.stop();
    autoRun.current = null;
    setContinuous(false);
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
  function generated(phrase: GeneratedPhrase) {
    edit({ type: 'generate', phrase });
    setSelectedId(null);
    setPreview(phrase.events[0]);
    previousRef.current = undefined;
    setError(null);
    navigate('play');
  }
  function generate(keepPlaying = false) {
    if (playback.status !== 'stopped') return;
    stop();
    const options = { ...s.generator, key: s.key, policy: s.policy };
    try {
      if (!keepPlaying) {
        generated(generateProgression(options));
        return;
      }
      const run = new PreparedProgressions(options, 0, (phrase) => {
        if (!s.melody.enabled) return phrase;
        const withMelody = generateMelody(phrase.events, s.melody);
        return {
          ...phrase,
          events: phrase.events.map((e, i) => ({
            ...e,
            melody: withMelody[i].melody,
          })),
        };
      });
      generated(run.get(0)!);
      autoRun.current = run;
      autoApplied.current = 0;
      setContinuous(true);
      engine.current!.play(
        run.get(0)!.events,
        s.tempo,
        true,
        (cycle) => {
          const phrase = run.get(cycle);
          if (!phrase) {
            queueMicrotask(() => {
              if (autoRun.current === run) setError('continuousExhausted');
            });
            return [];
          }
          // The phrase being handed to the clock is already complete. Prepare
          // its successor outside the scheduling callback; Stop invalidates it.
          queueMicrotask(() => {
            if (autoRun.current !== run) return;
            try {
              run.prepare(cycle + 1);
            } catch {
              setError('continuousExhausted');
            }
          });
          return phrase.events;
        },
        0,
        (cycle) => run.get(cycle)?.events ?? [],
      );
    } catch {
      stop();
      setError('generationFailed');
    }
  }
  function melodySettings(patch: Partial<MelodySettings>) {
    if (Object.keys(patch).some((key) => key !== 'volume')) {
      stop();
      edit({ type: 'melody', patch });
    } else {
      setStorage('saving');
      dispatch({ type: 'melody', patch });
    }
  }
  function melodyMode(live: boolean) {
    stop();
    setLiveMode(live);
    navigate('play');
  }
  function appendBridge(events: ChordEvent[]) {
    if (playback.status !== 'stopped') return;
    const added = events.map((e) => ({ ...e, id: crypto.randomUUID() }));
    edit({ type: 'bridge', events: added });
    setSelectedId(null);
    setPreview(added[0]);
    navigate('play');
  }
  function auditionBridge(events: ChordEvent[]) {
    stop();
    auditioning.current = true;
    const prepared = s.melody.enabled
      ? generateMelody(events, s.melody)
      : events;
    setAuditionPlan(prepared);
    engine.current!.play(prepared, s.tempo, false, () => events);
  }
  function travel(direction: 1 | -1, cadence: boolean) {
    stop();
    let events = buildCircleTravel(
      {
        from: s.key,
        duration: s.duration,
        seventh: s.seventh,
        policy: s.policy,
        cadence,
      },
      direction,
      crypto.randomUUID(),
    );
    if (s.melody.enabled) events = generateMelody(events, s.melody);
    edit({ type: 'travel', events });
    setSelectedId(null);
    setPreview(events[0]);
    navigate('play');
    engine.current!.play(
      events,
      s.tempo,
      true,
      () => sessionRef.current.events,
    );
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
      if (upload.size > 5_000_000) throw new Error('Too large');
      const imported = importSession(await upload.text());
      stop();
      edit({ type: 'replace', session: imported });
      setSelectedId(null);
      setPreview(imported.events[0] ?? initialEvent);
      setError('imported');
      navigate('play');
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
    <main className={`app scene-${scene}`}>
      <header className="app-header">
        <h1 id="scene-heading" tabIndex={-1}>
          {scene === 'play'
            ? 'Chordscape'
            : scene === 'library'
              ? t.library
              : scene === 'generate'
                ? t.generateScene
                : scene === 'circle'
                  ? t.circleScene
                  : scene === 'melody'
                    ? t.melodyScene
                    : scene === 'listen'
                      ? t.listenScene
                      : t.settings}
          {scene === 'play' && (
            <span className="brand-mark" aria-hidden="true">
              ◌
            </span>
          )}
        </h1>
        <button
          className="sound-shortcut"
          aria-label={`${t.currentTone}: ${t[sound.instrument]}`}
          onClick={() => navigate('settings')}
        >
          {t[sound.instrument]}
        </button>
      </header>
      {scene !== 'listen' && (
        <section className="transport" aria-label={t.playScene}>
          <button className="primary" onClick={() => void enable()}>
            {ready ? t.ready : t.enable}
          </button>
          <button
            disabled={
              !ready ||
              (!session.events.length &&
                !(playback.live && playback.event && s.record)) ||
              (running && !playback.live) ||
              sound.loading
            }
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
          <meter
            aria-label={t.level}
            min="0"
            max="1"
            value={level}
            data-testid="audio-level"
          />
        </section>
      )}

      {error && (
        <p className="notice" role={error === 'imported' ? 'status' : 'alert'}>
          {t[error]}
        </p>
      )}
      {sound.loading && (
        <p className="notice" role="status">
          {t.soundLoading}
        </p>
      )}
      {sound.failed && (
        <p className="notice" role="alert">
          {t.soundFailed}{' '}
          <button
            onClick={() => void engine.current?.setInstrument(s.instrument)}
          >
            {t.retry}
          </button>
        </p>
      )}
      {session.generation?.fallback && (
        <p className="notice" role="status">
          {session.generation.fallback === 'shortPhrase'
            ? t.fallbackShort
            : t.fallbackConstraints}
        </p>
      )}
      {continuous && (
        <p className="continuous-status" role="status">
          {t.continuous} · {t.phrase} {(playback.cycle ?? 0) + 1} ·{' '}
          {nextReady ? t.nextPhraseReady : t.nextPhrasePreparing}
        </p>
      )}
      {auditionPlan && (
        <p className="notice" role="status">
          {t.bridgeAudition}
        </p>
      )}
      {scene === 'circle' && (
        <>
          <Circle
            settings={s}
            events={session.events}
            currentKey={currentKey}
            stopped={playback.status === 'stopped'}
            canPlay={ready && !sound.loading}
            onSeventh={(seventh) =>
              edit({ type: 'settings', patch: { seventh } })
            }
            onSelectKey={(key) => edit({ type: 'settings', patch: { key } })}
            onAudition={auditionBridge}
            onAppend={appendBridge}
            onTravel={travel}
            t={t}
          />
          {playback.event && (
            <section>
              <strong>
                {voicedSymbol(playback.event.chord, playback.event.notes)}
              </strong>
              <DualAnalysis event={playback.event} t={t} />
            </section>
          )}
        </>
      )}
      {scene === 'melody' && (
        <Melody
          settings={s.melody}
          events={session.events}
          t={t}
          onSettings={melodySettings}
          onRegenerate={() => {
            stop();
            edit({ type: 'regenerateMelody' });
          }}
          onMode={melodyMode}
        />
      )}
      {scene === 'generate' && (
        <Generator
          settings={s}
          record={session.generation}
          stopped={playback.status === 'stopped'}
          canPlay={ready && !sound.loading}
          onSettings={(patch) => edit({ type: 'settings', patch })}
          onGenerate={() => generate()}
          onContinuous={() => generate(true)}
          t={t}
        />
      )}
      {scene === 'play' && (
        <div className="play-scene">
          {liveMode && (
            <section className="live-status">
              <div className="section-title">
                <strong>
                  {playback.live && running ? t.livePlaying : t.liveReady}
                </strong>
                <button onClick={() => melodyMode(false)}>
                  {t.melodyTimeline}
                </button>
              </div>
              <label>
                {t.liveTiming}
                <select
                  disabled={playback.status !== 'stopped'}
                  value={s.melody.timing}
                  onChange={(e) =>
                    melodySettings({
                      timing: e.target.value as MelodySettings['timing'],
                    })
                  }
                >
                  <option value="immediate">{t.immediate}</option>
                  <option value="nextBeat">{t.nextBeat}</option>
                </select>
              </label>
              {playback.live?.pending && (
                <p data-testid="live-pending">
                  {t.pendingChord}: {chordSymbol(playback.live.pending.chord)} ·{' '}
                  {t.beat} {(playback.live.pendingBeat! + 1).toFixed(2)}
                </p>
              )}
              <small>{t.liveRecordHint}</small>
            </section>
          )}
          <section className="key-panel">
            <div className="controls">
              <label>
                <span className="key-field-label">{t.key}</span>
                <select
                  disabled={running}
                  value={pitchName(currentKey.tonic)}
                  onChange={(e) =>
                    edit({
                      type: 'settings',
                      patch: { key: keyFromName(e.target.value, s.key.mode) },
                    })
                  }
                >
                  {(currentKey.mode === 'major' ? MAJOR_KEYS : MINOR_KEYS).map(
                    (name) => (
                      <option key={name}>{name}</option>
                    ),
                  )}
                </select>
              </label>
              <label>
                <span className="key-field-label">{t.mode}</span>
                <select
                  disabled={running}
                  value={currentKey.mode}
                  onChange={(e) => changeMode(e.target.value as Key['mode'])}
                >
                  <option value="major">{t.major}</option>
                  <option value="minor">{t.minor}</option>
                </select>
              </label>
            </div>
          </section>
          <section className="palette-panel">
            <div className="section-title">
              <h2>{t.palette}</h2>
              <span>
                {keyLabel(currentKey, t)}{' '}
                <button
                  className="melody-shortcut"
                  aria-label={t.melodyScene}
                  onClick={() => navigate('melody')}
                >
                  ♪ {t.melodyScene}
                  {s.melody.enabled ? ' ✓' : ''}
                </button>
              </span>
            </div>
            {running && !liveMode && (
              <p className="muted playback-hint">{t.recordHint}</p>
            )}
            {[false, true].map((seventh) => (
              <div
                className="diatonic-row"
                role="group"
                aria-label={seventh ? t.sevenths : t.triads}
                key={String(seventh)}
              >
                <h3>{seventh ? t.sevenths : t.triads}</h3>
                <Palette
                  chords={diatonic(currentKey, seventh)}
                  context={currentKey}
                  disabled={!ready || (running && !liveMode) || sound.loading}
                  onChoose={choose}
                  selected={chordSymbol(displayed.chord)}
                />
              </div>
            ))}
            <OutsidePalette
              defaults={outside(currentKey)}
              custom={customPalette.chords}
              storageFailed={customPalette.failed}
              onChange={(chords) =>
                setCustomPalette({ chords, failed: !saveCustomPalette(chords) })
              }
              t={t}
              context={currentKey}
              disabled={!ready || (running && !liveMode) || sound.loading}
              onChoose={choose}
              selected={chordSymbol(displayed.chord)}
            />
          </section>
          <ChordDetails
            event={displayed}
            previous={previous}
            next={next}
            currentKey={currentKey}
            sounding={playback.event?.notes ?? []}
            melodyNote={s.melody.enabled ? playback.melody : null}
            t={t}
            onBass={bass}
            disabled={running}
          />
          {s.melody.enabled && (
            <PianoRoll
              events={
                playback.live && playback.event ? [playback.event] : viewEvents
              }
              beat={
                playback.live
                  ? playback.live.phraseBeat
                  : running || playback.status === 'paused'
                    ? playback.beat
                    : Math.max(
                        0,
                        viewEvents
                          .slice(0, index)
                          .reduce((sum, e) => sum + e.duration, 0),
                      )
              }
              active={playback.melody}
              t={t}
            />
          )}
          <section className="timeline-panel">
            <div className="section-title">
              <h2>
                {t.timeline}
                <span className="count">{viewEvents.length}</span>
              </h2>
              <div className="actions">
                <button
                  disabled={!history.past.length}
                  onClick={() => {
                    if (
                      autoRun.current ||
                      auditioning.current ||
                      playback.live ||
                      playback.status === 'paused'
                    )
                      stop();
                    dispatch({ type: 'undo' });
                    setStorage('saving');
                  }}
                >
                  {t.undo}
                </button>
                <button
                  disabled={!history.future.length}
                  onClick={() => {
                    if (
                      autoRun.current ||
                      auditioning.current ||
                      playback.live ||
                      playback.status === 'paused'
                    )
                      stop();
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
                {t.next}:{' '}
                {voicedSymbol(playback.next.chord, playback.next.notes)}
              </p>
            )}
            {comparison && running && (
              <p>
                {t.comparison}: {comparison === 'root' ? t.rootMode : t.smooth}
              </p>
            )}
            <div className="timeline-controls">
              <div className="controls playback-controls">
                <label>
                  <span className="key-field-label">{t.tempo}</span>
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
                  <span className="wide-label">{t.duration}</span>
                  <span className="compact-label" aria-hidden="true">
                    {t.beat}
                  </span>
                  <select
                    aria-label={t.duration}
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
                    disabled={liveMode && playback.status !== 'stopped'}
                    checked={s.record}
                    onChange={(e) =>
                      edit({
                        type: 'settings',
                        patch: { record: e.target.checked },
                      })
                    }
                  />
                  {t.record}
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={s.loop}
                    disabled={continuous || liveMode}
                    onChange={(e) =>
                      edit({
                        type: 'settings',
                        patch: { loop: e.target.checked },
                      })
                    }
                  />
                  {t.loop}
                </label>
              </div>
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
                  disabled={!ready || !session.events.length || sound.loading}
                  onClick={() => play('root')}
                  aria-label={t.compareRoot}
                >
                  <span className="wide-label">{t.compareRoot}</span>
                  <span className="compact-label" aria-hidden="true">
                    {t.compareRootShort}
                  </span>
                </button>
                <button
                  disabled={!ready || !session.events.length || sound.loading}
                  onClick={() => play('smooth')}
                  aria-label={t.compareSmooth}
                >
                  <span className="wide-label">{t.compareSmooth}</span>
                  <span className="compact-label" aria-hidden="true">
                    {t.compareSmoothShort}
                  </span>
                </button>
              </div>
              <div className="controls transpose-controls">
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
            </div>
            <Timeline
              events={viewEvents}
              selectedId={selectedId}
              playingId={playback.event?.id}
              onSelect={select}
              onEdit={edit}
              t={t}
            />
          </section>
        </div>
      )}
      {scene === 'listen' && (
        <Listen
          initial={listenInitial}
          context={currentKey}
          t={t}
          onEnter={stop}
          onBack={() => navigate('library')}
        />
      )}
      {scene === 'library' && (
        <div className="library-scene">
          <Library
            onListen={(chord) => {
              setListenInitial(chord);
              stop();
              navigate('listen');
            }}
            t={t}
            initial={displayed.chord}
            disabled={!ready || running || sound.loading}
            onInspect={(chord) => {
              setSelectedId(null);
              setPreview(makeEvent(chord, session, 'library-preview'));
            }}
            onAudition={(chord) => choose(chord, false)}
            onAdd={(chord) => {
              choose(chord, true);
              navigate('play');
            }}
          />
          <ChordDetails
            event={displayed}
            previous={previous}
            next={next}
            currentKey={currentKey}
            sounding={playback.event?.notes ?? []}
            melodyNote={s.melody.enabled ? playback.melody : null}
            t={t}
            onBass={bass}
            disabled={running}
          />
        </div>
      )}
      {scene === 'settings' && (
        <div className="settings-scene">
          <section>
            <div className="controls">
              <label>
                {t.tone}
                <select
                  aria-label={t.tone}
                  value={s.instrument}
                  onChange={(e) =>
                    edit({
                      type: 'settings',
                      patch: { instrument: e.target.value as Instrument },
                    })
                  }
                >
                  {INSTRUMENTS.map((instrument) => (
                    <option key={instrument} value={instrument}>
                      {t[instrument]}
                    </option>
                  ))}
                </select>
              </label>
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
            </div>
          </section>
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
          <section>
            <h2>{t.help}</h2>
            <p>{t.hint}</p>
            <p>{t.keyChangeHint}</p>
            <p>{t.recordHint}</p>
            <p>{t.functionHint}</p>
            <p>{t.romanHint}</p>
          </section>
          <section className="credits">
            <h2>{t.credits}</h2>
            <p>{t.pianoCredit}</p>
            <a href={`${import.meta.env.BASE_URL}samples/salamander/README`}>
              Salamander — Alexander Holm
            </a>{' '}
            ·{' '}
            <a href="https://creativecommons.org/licenses/by/3.0/">CC BY 3.0</a>
          </section>
        </div>
      )}
      <nav className="scene-nav" aria-label={t.navigation}>
        {(['play', 'generate', 'circle', 'library', 'settings'] as const).map(
          (item) => (
            <button
              key={item}
              aria-current={
                scene === item ||
                (scene === 'melody' && item === 'play') ||
                (scene === 'listen' && item === 'library')
                  ? 'page'
                  : undefined
              }
              onClick={() => navigate(item)}
            >
              {item === 'play'
                ? t.playScene
                : item === 'library'
                  ? t.library
                  : item === 'generate'
                    ? t.generateScene
                    : item === 'circle'
                      ? t.circleScene
                      : t.settings}
            </button>
          ),
        )}
      </nav>
    </main>
  );
}
