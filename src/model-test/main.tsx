import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HarmonicSpace } from '../components/HarmonicSpace';
import { useAudio } from '../app/useAudio';
import { DEFAULT_INSTRUMENT } from '../audio/instruments';
import { messages, type Locale } from '../i18n/messages';
import { pitchName, voicedSymbol } from '../music/harmony';
import { spaceEvent, spaceNodes } from '../space/layout';
import { newSpaceContext } from '../space/context';
import {
  classifyModelCandidates,
  MODEL_CANDIDATE_LABELS,
} from '../space/modelCandidateTypes';
import {
  fetchPreviewPrediction,
  fetchPreviewRuns,
  modelInputHistory,
  type PreviewPrediction,
  type PreviewRun,
} from '../space/modelPreview';
import type { ChordEvent } from '../state/session';
import '../styles/main.css';
import './model-test.css';

function ModelTest() {
  const [locale, setLocale] = useState<Locale>('ja');
  const t = messages[locale];
  const [context, setContext] = useState(newSpaceContext);
  const [runs, setRuns] = useState<PreviewRun[]>([]);
  const [runId, setRunId] = useState('');
  const [loadError, setLoadError] = useState(false);
  const [loadNonce, setLoadNonce] = useState(0);
  const [predictionNonce, setPredictionNonce] = useState(0);
  const [prediction, setPrediction] = useState<{
    key: string;
    value: PreviewPrediction;
  } | null>(null);
  const [failedRequestKey, setFailedRequestKey] = useState<string | null>(null);
  const [audioError, setAudioError] = useState(false);
  const { engine, playback, sound, level } = useAudio();
  const audioRequest = useRef(0);
  const pendingAudio = useRef<Promise<boolean> | null>(null);
  const selectedRun = runs.find((run) => run.run_id === runId);
  const inputHistory = useMemo(
    () =>
      selectedRun
        ? modelInputHistory(context.history, selectedRun.config.context)
        : [],
    [context.history, selectedRun],
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetchPreviewRuns(controller.signal)
      .then((items) => {
        setRuns(items);
        setRunId((current) =>
          items.some((item) => item.run_id === current)
            ? current
            : (items[0]?.run_id ?? ''),
        );
        setLoadError(false);
      })
      .catch((error: unknown) => {
        if ((error as Error).name !== 'AbortError') setLoadError(true);
      });
    return () => controller.abort();
  }, [loadNonce]);

  const requestKey = JSON.stringify([
    runId,
    context.style,
    inputHistory,
    pitchName(context.key.tonic),
    predictionNonce,
  ]);
  useEffect(() => {
    if (!selectedRun) return;
    const controller = new AbortController();
    void fetchPreviewPrediction(
      selectedRun,
      context.style,
      context.history,
      controller.signal,
    )
      .then((value) => setPrediction({ key: requestKey, value }))
      .catch((error: unknown) => {
        if ((error as Error).name !== 'AbortError')
          setFailedRequestKey(requestKey);
      });
    return () => controller.abort();
  }, [selectedRun, context.style, context.history, requestKey]);

  const current = prediction?.key === requestKey ? prediction.value : null;
  const predictionError = failedRequestKey === requestKey;
  const nodes = useMemo(() => spaceNodes(context.key), [context.key]);
  const candidateTypes = useMemo(
    () =>
      classifyModelCandidates({
        key: context.key,
        style: context.style,
        history: context.history,
        availableChords: nodes,
        candidates: current?.candidates.slice(0, 6) ?? [],
      }),
    [context.key, context.style, context.history, nodes, current],
  );
  const names = useMemo(
    () =>
      new Map(
        nodes.map((node) => {
          const event = spaceEvent(node, context.key);
          return [node.id, voicedSymbol(event.chord, event.notes)];
        }),
      ),
    [nodes, context.key],
  );
  function stop() {
    audioRequest.current++;
    engine.current?.stop();
  }
  function choose(prepare: () => ChordEvent) {
    const event = prepare();
    const audio = engine.current;
    if (!audio || sound.loading) return;
    const request = ++audioRequest.current;
    if (audio.unlocked && !pendingAudio.current) {
      audio.audition(event);
      return;
    }
    const setup =
      pendingAudio.current ??
      (async () => {
        if (!(await audio.unlock())) return false;
        await audio.setInstrument(DEFAULT_INSTRUMENT);
        return audio.unlocked;
      })();
    pendingAudio.current = setup;
    void setup
      .then((ok) => {
        if (ok && request === audioRequest.current && !document.hidden)
          audio.audition(event);
      })
      .catch(() => setAudioError(true))
      .finally(() => {
        if (pendingAudio.current === setup) pendingAudio.current = null;
      });
  }

  return (
    <main className="app scene-space model-test-page">
      <header className="app-header">
        <div className="header-identity">
          <a
            className="brand"
            href={`${import.meta.env.BASE_URL}index.html#space`}
          >
            Chordscape
            <span className="brand-mark" aria-hidden="true">
              ◌
            </span>
          </a>
          <h1>{t.modelTestScene}</h1>
        </div>
        <div className="header-actions">
          <button onClick={() => setLocale(locale === 'ja' ? 'en' : 'ja')}>
            {locale === 'ja' ? 'English' : '日本語'}
          </button>
          <a href={`${import.meta.env.BASE_URL}index.html#space`}>
            {t.modelMainSpace}
          </a>
        </div>
      </header>
      <section className="model-test-settings" aria-label={t.modelRun}>
        <p>{t.modelTestHint}</p>
        <div className="model-test-settings-row">
          <label>
            {t.modelRun}
            <select
              value={runId}
              onChange={(event) => setRunId(event.target.value)}
              disabled={!runs.length}
            >
              {runs.map((run) => (
                <option key={run.run_id} value={run.run_id}>
                  ctx {run.config.context} · dropout {run.config.dropout} · lr{' '}
                  {run.config.learning_rate} · {run.config.epochs} ep · val NLL{' '}
                  {run.validation_nll.toFixed(4)} · {run.run_id.slice(0, 15)}
                </option>
              ))}
            </select>
          </label>
          <button onClick={() => setLoadNonce((value) => value + 1)}>
            {t.modelRefreshRuns}
          </button>
          {selectedRun && (
            <span>transformer-v1 · epoch {selectedRun.best_epoch}</span>
          )}
        </div>
        {loadError ? (
          <p role="alert">
            {t.modelConnectError}{' '}
            <button onClick={() => setLoadNonce((value) => value + 1)}>
              {t.modelRetry}
            </button>
          </p>
        ) : !runs.length ? (
          <p role="status">{t.modelConnecting}</p>
        ) : null}
      </section>
      <section className="transport" aria-label={t.spaceScene}>
        <button className="stop" onClick={stop}>
          ■ {t.stop}
        </button>
        <span role="status">
          {sound.loading
            ? t.soundLoading
            : playback.event
              ? t.sounding
              : t.idle}
        </span>
        <meter aria-label={t.level} min="0" max="1" value={level} />
      </section>
      {audioError && (
        <p className="notice" role="alert">
          {t.modelAudioError}
        </p>
      )}
      <HarmonicSpace
        t={t}
        sounding={
          playback.event?.id.startsWith('space-') ? playback.event : null
        }
        onChoose={choose}
        onResetAudio={stop}
        modelOverlay={{
          candidates: current?.candidates ?? [],
          candidateTypes,
          historyLimit: Math.max(12, ...runs.map((run) => run.config.context)),
          onContextChange: setContext,
        }}
      />
      <section className="model-test-results" aria-label={t.spaceSuggestions}>
        <h2>{t.spaceSuggestions}</h2>
        <p className="muted">{t.modelProbabilityHint}</p>
        <p className="model-test-history">
          {t.modelHistoryUsed}: {current?.history_used ?? inputHistory.length} /{' '}
          {current ? current.context : (selectedRun?.config.context ?? 0)} ·{' '}
          {inputHistory.length
            ? inputHistory.map((id) => names.get(id) ?? id).join(' → ')
            : t.modelNoHistory}
        </p>
        {predictionError ? (
          <p role="alert">
            {t.modelPredictionError}{' '}
            <button onClick={() => setPredictionNonce((value) => value + 1)}>
              {t.modelRetry}
            </button>
          </p>
        ) : !current ? (
          <p role="status">{t.modelLoading}</p>
        ) : (
          <>
            <ol className="model-test-top">
              {current.candidates.slice(0, 6).map((candidate) => {
                const type = candidateTypes.get(candidate.ids[0]) ?? 'explore';
                return (
                  <li key={candidate.ids[0]} data-model-type={type}>
                    <div className="model-test-top-content">
                      <strong>
                        {candidate.ids
                          .map((id) => names.get(id) ?? id)
                          .join(' / ')}
                      </strong>
                      <span className="model-test-type">
                        {t[MODEL_CANDIDATE_LABELS[type]]}
                      </span>
                      <span className="model-test-probability">
                        {(candidate.probability * 100).toFixed(1)}%
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
            <details>
              <summary>{t.modelAllCandidates}</summary>
              <ol className="model-test-all">
                {current.candidates.map((candidate) => (
                  <li key={candidate.ids[0]}>
                    {candidate.ids.map((id) => names.get(id) ?? id).join(' / ')}{' '}
                    · {(candidate.probability * 100).toFixed(2)}%
                  </li>
                ))}
              </ol>
            </details>
          </>
        )}
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ModelTest />
  </StrictMode>,
);
