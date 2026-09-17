import { useEffect, useRef, useState } from 'react';
import {
  analyze,
  chordSymbol,
  MAJOR_KEYS,
  midiName,
  MINOR_KEYS,
  parsePitch,
  pitchName,
  roman,
  ROOTS,
  tones,
  voicedSymbol,
  type Harmony,
  type Key,
} from '../music/harmony';
import type { Messages } from '../i18n/messages';
import { speechPhrases, SPEECH_QUALITIES } from '../listen/speech';
import {
  cueAt,
  defaultListen,
  LISTEN_RATE,
  type ListenMode,
  type ListenSettings,
} from '../listen/plan';
import { renderListen, type RenderedListen } from '../listen/render';
import { ListenPlayer, type ListenPlayback } from '../listen/player';
import { LISTEN_STORAGE, loadListen } from '../listen/storage';
import { Keyboard } from './Keyboard';
const modeLabels = {
  fixed: 'listenFixed',
  key: 'listenKey',
  random: 'listenRandom',
  ambient: 'listenAmbient',
} as const;
const time = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`;
export function Listen({
  initial,
  context,
  t,
  onEnter,
  onBack,
}: {
  initial: Harmony | null;
  context: Key;
  t: Messages;
  onEnter: () => void;
  onBack: () => void;
}) {
  const [settings, setSettings] = useState(() => {
    const saved = loadListen(defaultListen(initial?.root, context));
    return initial ? { ...saved, root: initial.root, key: context } : saved;
  });
  const [result, setResult] = useState<RenderedListen | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [loop, setLoop] = useState(true);
  const [playback, setPlayback] = useState<ListenPlayback>({
    status: 'empty',
    seconds: 0,
  });
  const audio = useRef<HTMLAudioElement>(null);
  const player = useRef<ListenPlayer | null>(null);
  const job = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const enter = useRef(onEnter);
  useEffect(() => {
    mounted.current = true;
    enter.current();
    const instance = new ListenPlayer(audio.current!, setPlayback);
    player.current = instance;
    return () => {
      mounted.current = false;
      job.current?.abort();
      instance.dispose();
      player.current = null;
    };
  }, []);
  function persist(next: ListenSettings) {
    try {
      localStorage.setItem(LISTEN_STORAGE, JSON.stringify(next));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }
  function discard() {
    job.current?.abort();
    job.current = null;
    setBusy(false);
    setProgress(0);
    player.current?.clear();
    setResult(null);
    setError(false);
  }
  function update(patch: Partial<ListenSettings>) {
    discard();
    const next = { ...settings, ...patch };
    setSettings(next);
    persist(next);
  }
  async function prepare() {
    discard();
    const controller = new AbortController();
    job.current = controller;
    const snapshot = {
      ...settings,
      seed: crypto.getRandomValues(new Uint32Array(1))[0],
    };
    setSettings(snapshot);
    persist(snapshot);
    setBusy(true);
    try {
      const output = await renderListen(
        snapshot,
        controller.signal,
        (value) => {
          if (mounted.current && job.current === controller) setProgress(value);
        },
      );
      if (
        !mounted.current ||
        controller.signal.aborted ||
        job.current !== controller
      )
        return;
      player.current!.load(
        output.blob,
        output.plan,
        `${t.listenScene} · ${t[modeLabels[snapshot.mode]]}`,
      );
      player.current!.setLoop(loop);
      setResult(output);
      requestAnimationFrame(() => {
        if (mounted.current)
          document.getElementById('listen-player-heading')?.focus();
      });
    } catch {
      if (
        mounted.current &&
        job.current === controller &&
        !controller.signal.aborted
      )
        setError(true);
    } finally {
      if (mounted.current && job.current === controller) {
        job.current = null;
        setBusy(false);
      }
    }
  }
  function stop() {
    if (busy) discard();
    else player.current?.stop();
  }
  async function play() {
    setError(false);
    try {
      await player.current?.play();
    } catch {
      if (mounted.current) setError(true);
    }
  }
  function download() {
    if (!result) return;
    const url = URL.createObjectURL(result.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `chordscape-listen-${result.plan.settings.mode}-${result.plan.settings.seed}.wav`;
    link.click();
    // Allow browsers time to consume the download URL; the player owns another.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  const cue = result ? cueAt(result.plan, playback.seconds) : undefined;
  const frame = Math.round(playback.seconds * LISTEN_RATE);
  const segment = cue?.segments.find((s) => s.start <= frame && frame < s.end);
  const audible = playback.status === 'playing' && segment?.kind === 'chord';
  const revealed = cue && frame >= cue.reveal;
  const keyMode = settings.mode === 'key' || settings.mode === 'ambient';
  return (
    <div className={`listen-scene ${result ? 'has-set' : ''}`}>
      <section>
        <div className="section-title">
          <h2>{t.listenSetup}</h2>
          <button onClick={onBack}>{t.listenBack}</button>
        </div>
        <div className="listen-modes" role="group" aria-label={t.listenMode}>
          {(Object.keys(modeLabels) as ListenMode[]).map((mode) => (
            <button
              key={mode}
              aria-pressed={settings.mode === mode}
              onClick={() => update({ mode })}
            >
              {t[modeLabels[mode]]}
            </button>
          ))}
        </div>
        <p className="muted">
          {
            t[
              (
                {
                  fixed: 'listenFixedHint',
                  key: 'listenKeyHint',
                  random: 'listenRandomHint',
                  ambient: 'listenAmbientHint',
                } as const
              )[settings.mode]
            ]
          }
        </p>
        <div className="listen-form">
          {settings.mode === 'fixed' && (
            <label>
              {t.root}
              <select
                value={pitchName(settings.root)}
                onChange={(e) => update({ root: parsePitch(e.target.value) })}
              >
                {[...new Set([...ROOTS, pitchName(settings.root)])].map(
                  (root) => (
                    <option key={root}>{root}</option>
                  ),
                )}
              </select>
            </label>
          )}
          {keyMode && (
            <>
              <label>
                {t.key}
                <select
                  value={pitchName(settings.key.tonic)}
                  onChange={(e) =>
                    update({
                      key: {
                        ...settings.key,
                        tonic: parsePitch(e.target.value),
                      },
                    })
                  }
                >
                  {[
                    ...new Set([
                      ...(settings.key.mode === 'major'
                        ? MAJOR_KEYS
                        : MINOR_KEYS),
                      pitchName(settings.key.tonic),
                    ]),
                  ].map((root) => (
                    <option key={root}>{root}</option>
                  ))}
                </select>
              </label>
              <label>
                {t.mode}
                <select
                  value={settings.key.mode}
                  onChange={(e) =>
                    update({
                      key: {
                        ...settings.key,
                        mode: e.target.value as Key['mode'],
                      },
                    })
                  }
                >
                  <option value="major">{t.major}</option>
                  <option value="minor">{t.minor}</option>
                </select>
              </label>
              <label>
                {t.chordSize}
                <select
                  value={settings.seventh ? '7' : '3'}
                  onChange={(e) => update({ seventh: e.target.value === '7' })}
                >
                  <option value="3">{t.triads}</option>
                  <option value="7">{t.sevenths}</option>
                </select>
              </label>
            </>
          )}
          {settings.mode !== 'ambient' && (
            <label>
              {t.listenOrder}
              <select
                value={settings.order}
                onChange={(e) =>
                  update({ order: e.target.value as ListenSettings['order'] })
                }
              >
                <option value="nameFirst">{t.listenNameFirst}</option>
                <option value="soundFirst">{t.listenSoundFirst}</option>
              </select>
            </label>
          )}
          <label>
            {t.listenLength}
            <select
              value={settings.minutes}
              onChange={(e) =>
                update({
                  minutes: Number(e.target.value) as ListenSettings['minutes'],
                })
              }
            >
              {[5, 10, 20].map((n) => (
                <option key={n} value={n}>
                  {n} {t.listenMinutes}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.listenChordLength}
            <select
              value={settings.chordSeconds}
              onChange={(e) => update({ chordSeconds: Number(e.target.value) })}
            >
              {[2, 3, 4, 6].map((n) => (
                <option key={n} value={n}>
                  {n} {t.listenSeconds}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.listenGap}
            <select
              value={settings.gapSeconds}
              onChange={(e) => update({ gapSeconds: Number(e.target.value) })}
            >
              {[0.5, 1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n} {t.listenSeconds}
                </option>
              ))}
            </select>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.inversions}
              onChange={(e) => update({ inversions: e.target.checked })}
            />
            {t.listenInversions}
          </label>
        </div>
        {!keyMode && (
          <fieldset className="listen-qualities">
            <legend>{t.listenQualities}</legend>
            <p className="muted">{t.listenQualityLimit}</p>
            {SPEECH_QUALITIES.map((quality) => (
              <label key={quality}>
                <input
                  type="checkbox"
                  checked={settings.qualities.includes(quality)}
                  disabled={
                    settings.qualities.length === 1 &&
                    settings.qualities.includes(quality)
                  }
                  onChange={(e) =>
                    update({
                      qualities: e.target.checked
                        ? [...settings.qualities, quality]
                        : settings.qualities.filter((q) => q !== quality),
                    })
                  }
                />
                {quality}
              </label>
            ))}
          </fieldset>
        )}
        <p className="muted">{t.listenPrepareHint}</p>
        <div className="controls listen-actions">
          <button
            className="primary"
            disabled={busy}
            onClick={() => void prepare()}
          >
            {result ? t.listenRebuild : t.listenPrepare}
          </button>
          {busy && <button onClick={stop}>{t.listenCancel}</button>}
        </div>
        {busy && (
          <div role="status">
            <label>
              {t.listenPreparing} {Math.round(progress * 100)}%
              <progress max="1" value={progress} />
            </label>
          </div>
        )}
        {error && <p role="alert">{t.listenError}</p>}
        {storageError && (
          <p role="status" className="muted">
            {t.storageError}
          </p>
        )}
      </section>
      <section className="listen-player" aria-label={t.listenPlayer}>
        <div className="section-title">
          <h2 id="listen-player-heading" tabIndex={-1}>
            {t.listenPlayer}
          </h2>
          <span>
            {time(playback.seconds)} /{' '}
            {time(
              result ? result.plan.frames / LISTEN_RATE : settings.minutes * 60,
            )}
          </span>
        </div>
        <div className="controls">
          <button
            className="primary"
            disabled={!result || playback.status === 'playing'}
            onClick={() => void play()}
          >
            {t.play}
          </button>
          <button
            disabled={playback.status !== 'playing'}
            onClick={() => player.current?.pause()}
          >
            {t.pause}
          </button>
          <button disabled={!result && !busy} onClick={stop}>
            ■ {t.stop}
          </button>
          <button disabled={!result} onClick={() => player.current?.step(-1)}>
            {t.listenPrevious}
          </button>
          <button disabled={!result} onClick={() => player.current?.step(1)}>
            {t.listenNext}
          </button>
        </div>
        <audio
          ref={audio}
          controls
          preload="metadata"
          onError={() => {
            if (audio.current?.hasAttribute('src')) setError(true);
          }}
          aria-label={t.listenPlayer}
          hidden={!result}
        />
        <label className="toggle">
          <input
            type="checkbox"
            checked={loop}
            onChange={(e) => {
              setLoop(e.target.checked);
              player.current?.setLoop(e.target.checked);
            }}
          />
          {t.listenRepeat}
        </label>
        <p role="status" className="muted">
          {busy
            ? t.listenPreparing
            : playback.status === 'playing'
              ? t.playing
              : playback.status === 'paused'
                ? t.paused
                : playback.status === 'ended'
                  ? t.listenEnded
                  : result
                    ? t.listenReady
                    : t.listenNotReady}
        </p>
        {result && (
          <p className="muted">
            {result.plan.cues.filter((c) => !c.reference).length}{' '}
            {t.listenItems} · Seed {result.plan.settings.seed} ·{' '}
            {(result.blob.size / 1024 / 1024).toFixed(1)} MB
          </p>
        )}
        {cue && (
          <div className="listen-now">
            <strong data-testid="listen-chord">
              {revealed
                ? voicedSymbol(cue.chord, cue.notes)
                : t.listenHearFirst}
            </strong>
            {revealed && (
              <span>
                {settings.mode === 'key' || settings.mode === 'ambient'
                  ? roman(analyze(cue.chord, cue.key))
                  : ''}{' '}
                {cue.reference ? t.listenReference : ''}
              </span>
            )}
            <p data-testid="listen-caption">
              {playback.status === 'playing' && segment?.kind === 'speech'
                ? cue.speech.map((token) => speechPhrases[token]).join(' ')
                : audible && revealed
                  ? tones(cue.chord).map(pitchName).join(' – ')
                  : ''}
            </p>
            <Keyboard notes={audible ? cue.notes : []} t={t} />
            {revealed && (
              <small>
                {chordSymbol(cue.chord)} · {t.bass}:{' '}
                {midiName(cue.chord, cue.notes[0])}
              </small>
            )}
          </div>
        )}
        <p className="muted">{t.listenBackgroundHint}</p>
        <button disabled={!result} onClick={download}>
          {t.listenDownload}
        </button>
        <p className="muted">
          {t.listenCredits}{' '}
          <a href={`${import.meta.env.BASE_URL}speech/ja/ATTRIBUTION.md`}>
            VOICEVOX Nemo
          </a>{' '}
          ·{' '}
          <a
            href={`${import.meta.env.BASE_URL}samples/salamander/ATTRIBUTION.md`}
          >
            Salamander Grand Piano · CC BY 3.0
          </a>
        </p>
      </section>
    </div>
  );
}
