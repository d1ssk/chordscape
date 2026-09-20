import {
  useRef,
  useState,
  useMemo,
  useEffect,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import type { Messages } from '../i18n/messages';
import {
  midiName,
  tones,
  pitchName,
  parsePitch,
  voicedSymbol,
} from '../music/harmony';
import type { ChordEvent } from '../state/session';
import type { PreviewCandidate } from '../space/modelPreview';
import {
  fetchPreviewPrediction,
  fetchPreviewRuns,
  modelInputHistory,
  selectSpaceModelRun,
  SPACE_MODEL_CONTEXT,
  type PreviewPrediction,
  type PreviewRun,
} from '../space/modelPreview';
import {
  classifyModelCandidates,
  MODEL_CANDIDATE_LABELS,
  MODEL_CANDIDATE_TYPES,
  type ModelCandidateType,
} from '../space/modelCandidateTypes';
import {
  spaceNodes,
  SPACE_TONICS,
  SPACE_SIZE,
  SPACE_PORTRAIT_SIZE,
  SPACE_PORTRAIT_POSITIONS,
  spaceEvent,
  type SpaceNode,
} from '../space/layout';

import {
  newSpaceContext,
  changeSpaceKey,
  changeSpaceStyle,
  chooseSpaceChord,
  chooseSpaceChordWithLimit,
  historyAge,
  type SpaceContext,
} from '../space/context';
import {
  SPACE_STYLES,
  RECOMMENDATION_TYPES,
  type SpaceStyle,
} from '../space/recommendations';
const typeLabels = {
  resolve: 'spaceResolve',
  continue: 'spaceContinue',
  color: 'spaceColor',
  explore: 'spaceExplore',
} as const;
const styleLabels = {
  free: 'spaceFree',
  pop: 'spacePop',
  jazz: 'spaceJazz',
  classical: 'spaceClassical',
} as const;
const symbol = (event: ChordEvent) => voicedSymbol(event.chord, event.notes);
type SuggestionSource = 'none' | 'rules' | 'transformer';

export interface ModelSpaceOverlay {
  candidates: PreviewCandidate[];
  candidateTypes: ReadonlyMap<string, ModelCandidateType>;
  historyLimit: number;
  onContextChange: (context: SpaceContext) => void;
}

export function HarmonicSpace({
  t,
  onChoose,
  onResetAudio,
  sounding,
  modelOverlay,
}: {
  t: Messages;
  onChoose: (prepare: () => ChordEvent) => void;
  onResetAudio: () => void;
  sounding: ChordEvent | null;
  modelOverlay?: ModelSpaceOverlay;
}) {
  const [context, setContext] = useState(newSpaceContext);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [showHistory, setShowHistory] = useState(true);
  const [suggestionSource, setSuggestionSource] =
    useState<SuggestionSource>('transformer');
  const [modelRun, setModelRun] = useState<PreviewRun | null>(null);
  const [modelError, setModelError] = useState(false);
  const [modelRetry, setModelRetry] = useState(0);
  const [prediction, setPrediction] = useState<{
    key: string;
    value: PreviewPrediction;
  } | null>(null);
  const contextRef = useRef(context);
  const nodes = useMemo(() => spaceNodes(context.key), [context.key]);
  const useLocalModel = !modelOverlay && suggestionSource === 'transformer';
  const requestKey = JSON.stringify([
    modelRun?.run_id,
    context.style,
    modelInputHistory(context.history, SPACE_MODEL_CONTEXT),
    modelRetry,
  ]);
  useEffect(() => {
    if (!useLocalModel) return;
    const controller = new AbortController();
    void fetchPreviewRuns(controller.signal)
      .then((runs) => {
        const selected = selectSpaceModelRun(runs);
        setModelRun(selected);
        setModelError(!selected);
      })
      .catch((error: unknown) => {
        if ((error as Error).name !== 'AbortError') {
          setModelRun(null);
          setPrediction(null);
          setModelError(true);
        }
      });
    return () => controller.abort();
  }, [useLocalModel, modelRetry]);
  useEffect(() => {
    if (!useLocalModel || !modelRun) return;
    const controller = new AbortController();
    void fetchPreviewPrediction(
      modelRun,
      context.style,
      context.history,
      controller.signal,
    )
      .then((value) => {
        setPrediction({ key: requestKey, value });
        setModelError(false);
      })
      .catch((error: unknown) => {
        if ((error as Error).name !== 'AbortError') {
          setPrediction(null);
          setModelError(true);
        }
      });
    return () => controller.abort();
  }, [useLocalModel, modelRun, context.style, context.history, requestKey]);
  const currentPrediction =
    prediction?.key === requestKey ? prediction.value : null;
  const localCandidates = useMemo(
    () => currentPrediction?.candidates.slice(0, 6) ?? [],
    [currentPrediction],
  );
  const localCandidateTypes = useMemo(
    () =>
      classifyModelCandidates({
        key: context.key,
        style: context.style,
        history: context.history,
        availableChords: nodes,
        candidates: localCandidates,
      }),
    [context.key, context.style, context.history, nodes, localCandidates],
  );
  const activeModelOverlay:
    | Pick<ModelSpaceOverlay, 'candidates' | 'candidateTypes' | 'historyLimit'>
    | undefined =
    modelOverlay ??
    (useLocalModel
      ? {
          candidates: localCandidates,
          candidateTypes: localCandidateTypes,
          historyLimit: SPACE_MODEL_CONTEXT,
        }
      : undefined);
  const events = useMemo(
    () =>
      new Map(nodes.map((node) => [node.id, spaceEvent(node, context.key)])),
    [nodes, context.key],
  );
  const recommendations = new Map(
    context.recommendations.map((r) => [r.chordId, r]),
  );
  const modelCandidates = new Map(
    activeModelOverlay?.candidates
      .filter((candidate) => candidate.rank <= 6)
      .flatMap((candidate) =>
        candidate.ids.map((id) => [id, candidate] as const),
      ) ?? [],
  );
  function update(next: SpaceContext) {
    contextRef.current = next;
    setContext(next);
    modelOverlay?.onContextChange(next);
    if (import.meta.env.DEV)
      console.debug('[Harmonic Space recommendations]', {
        key: next.key,
        style: next.style,
        history: next.history,
        candidates: next.recommendations,
      });
  }
  function choose(id: string) {
    // The host page decides when to commit the selection and start audio.
    onChoose(() => {
      const next = activeModelOverlay
        ? chooseSpaceChordWithLimit(
            contextRef.current,
            id,
            activeModelOverlay.historyLimit,
          )
        : chooseSpaceChord(contextRef.current, id);
      update(next);
      return next.current!;
    });
  }
  function styleChanged(style: SpaceStyle) {
    update(changeSpaceStyle(contextRef.current, style));
  }
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  function move(event: KeyboardEvent<HTMLButtonElement>, node: SpaceNode) {
    const direction = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }[event.key];
    if (!direction) return;
    event.preventDefault();
    const [dx, dy] = direction;
    const origin = buttons.current.get(node.id)!.getBoundingClientRect();
    const nearest = nodes
      .filter((other) => other.id !== node.id)
      .map((other) => {
        // Use rendered coordinates so arrow navigation follows either layout.
        const target = buttons.current.get(other.id)!.getBoundingClientRect();
        const x = target.x + target.width / 2 - origin.x - origin.width / 2;
        const y = target.y + target.height / 2 - origin.y - origin.height / 2;
        return {
          other,
          forward: x * dx + y * dy,
          score: Math.hypot(x, y) + Math.abs(x * dy - y * dx) * 4,
        };
      })
      .filter(({ forward }) => forward > 0)
      .sort((a, b) => a.score - b.score)[0];
    buttons.current.get(nearest?.other.id ?? node.id)?.focus();
  }
  return (
    <section className="harmonic-space" aria-label={t.spaceTitle}>
      <div className="space-intro">
        <h2 className="sr-only">
          {t.spaceKey.replace('{key}', pitchName(context.key.tonic))}
        </h2>
        <div className="space-controls">
          <label>
            {t.key}
            <select
              aria-label={t.spaceSelectKey}
              value={pitchName(context.key.tonic)}
              onChange={(e) => {
                onResetAudio();
                update(
                  changeSpaceKey(contextRef.current, {
                    tonic: parsePitch(e.target.value),
                    mode: 'major',
                  }),
                );
              }}
            >
              {SPACE_TONICS.map((tonic) => (
                <option key={tonic} value={tonic}>
                  {t.spaceKeyOption.replace('{key}', tonic)}
                </option>
              ))}
            </select>
          </label>
          <div className="space-styles" role="group" aria-label={t.spaceStyle}>
            {SPACE_STYLES.map((style) => (
              <button
                key={style}
                aria-pressed={context.style === style}
                onClick={() => styleChanged(style)}
              >
                {t[styleLabels[style]]}
              </button>
            ))}
          </div>
        </div>
        <div className="space-layer-legend" aria-label={t.spaceLayers}>
          <span className="space-layer-core">{t.spaceCore}</span>
          <span className="space-layer-near">{t.spaceNear}</span>
          <span className="space-layer-outer">{t.spaceOuter}</span>
        </div>
        <div className="space-display-controls">
          <div className="space-visibility">
            {!modelOverlay && (
              <label className="space-source-select">
                {t.spaceSuggestionSource}
                <select
                  value={suggestionSource}
                  onChange={(event) =>
                    setSuggestionSource(event.target.value as SuggestionSource)
                  }
                >
                  <option value="none">{t.spaceSourceNone}</option>
                  <option value="rules">{t.spaceSourceRules}</option>
                  <option value="transformer">
                    {t.spaceSourceTransformer}
                  </option>
                </select>
              </label>
            )}
            {modelOverlay && (
              <label>
                <input
                  type="checkbox"
                  checked={showSuggestions}
                  onChange={(e) => setShowSuggestions(e.target.checked)}
                />
                {t.spaceShowSuggestions}
              </label>
            )}
            <label>
              <input
                type="checkbox"
                checked={showHistory}
                onChange={(e) => setShowHistory(e.target.checked)}
              />
              {t.spaceShowHistory}
            </label>
            <label>
              <input
                type="checkbox"
                checked={context.automaticVoicing}
                onChange={(e) =>
                  update({
                    ...contextRef.current,
                    automaticVoicing: e.target.checked,
                  })
                }
              />
              {t.spaceAutomaticVoicing}
            </label>
          </div>
          {suggestionSource === 'none' &&
          !modelOverlay ? null : activeModelOverlay ? (
            <div
              className="space-suggestion-legend"
              aria-label={t.spaceSuggestions}
            >
              <span className="model-suggestion-legend">
                {modelOverlay
                  ? t.modelTopSix
                  : modelError
                    ? t.spaceModelOfflineShort
                    : t.modelTopSix}
              </span>
              {MODEL_CANDIDATE_TYPES.map((type) => (
                <span key={type} data-model-type={type}>
                  <i aria-hidden="true" />
                  {t[MODEL_CANDIDATE_LABELS[type]]}
                </span>
              ))}
            </div>
          ) : (
            <div
              className="space-suggestion-legend"
              aria-label={t.spaceSuggestions}
            >
              {RECOMMENDATION_TYPES.map((type) => (
                <span key={type} data-suggestion={type}>
                  <i aria-hidden="true" />
                  {t[typeLabels[type]]}
                </span>
              ))}
            </div>
          )}
          <button
            className="space-reset"
            onClick={() => {
              onResetAudio();
              update(
                newSpaceContext(
                  contextRef.current.key,
                  contextRef.current.style,
                  contextRef.current.automaticVoicing,
                ),
              );
            }}
          >
            {t.spaceReset}
          </button>
        </div>
      </div>
      <p className="sr-only" id="space-instructions">
        {t.spaceNavigation}
      </p>
      <div
        className="space-viewport"
        role="region"
        aria-label={t.spaceMap}
        aria-describedby="space-instructions"
        tabIndex={0}
      >
        <div className="space-map">
          <span className="space-region-label space-flat">{t.spaceFlat}</span>
          <span className="space-region-label space-sharp">{t.spaceSharp}</span>
          {nodes.map((node) => {
            const event = events.get(node.id)!;
            const name = symbol(event);
            const age = historyAge(context.history, node.id);
            const recommendation =
              showSuggestions && suggestionSource === 'rules' && !modelOverlay
                ? recommendations.get(node.id)
                : undefined;
            const modelCandidate =
              showSuggestions &&
              (modelOverlay || suggestionSource === 'transformer')
                ? modelCandidates.get(node.id)
                : undefined;
            const modelType = modelCandidate
              ? (activeModelOverlay?.candidateTypes.get(node.id) ?? 'explore')
              : undefined;
            const description = [
              age === 0
                ? t.spaceCurrent
                : showHistory && age !== undefined
                  ? `${age} ${t.spaceStepsAgo}`
                  : '',
              recommendation
                ? `${t.spaceSuggestions}: ${t[typeLabels[recommendation.type]]}`
                : '',
              modelCandidate && modelType
                ? `${t.spaceSuggestions}: ${t[MODEL_CANDIDATE_LABELS[modelType]]}`
                : '',
            ]
              .filter(Boolean)
              .join(' · ');
            const portrait = SPACE_PORTRAIT_POSITIONS[node.id];
            return (
              <button
                key={node.id}
                ref={(element) => {
                  if (element) buttons.current.set(node.id, element);
                  else buttons.current.delete(node.id);
                }}
                className={`space-node space-node-${node.layer}${node.satelliteOf ? ' space-satellite' : ''}`}
                data-node-id={node.id}
                data-region={node.region}
                data-history={showHistory ? age : undefined}
                data-suggestion={recommendation?.type}
                data-score={recommendation?.score}
                data-model-rank={
                  modelOverlay ? modelCandidate?.rank : undefined
                }
                data-model-type={modelType}
                data-sounding={sounding?.id === event.id || undefined}
                aria-current={age === 0 ? 'true' : undefined}
                aria-description={description || undefined}
                style={
                  {
                    '--suggestion-strength': recommendation?.score ?? 0,
                    '--suggestion-opacity': recommendation
                      ? 0.25 + 0.65 * recommendation.score
                      : 0,
                    '--space-x': `${(node.position.x / SPACE_SIZE.width) * 100}%`,
                    '--space-y': `${(node.position.y / SPACE_SIZE.height) * 100}%`,
                    '--space-portrait-x': `${(portrait.x / SPACE_PORTRAIT_SIZE.width) * 100}%`,
                    '--space-portrait-y': `${(portrait.y / SPACE_PORTRAIT_SIZE.height) * 100}%`,
                  } as CSSProperties
                }
                aria-label={name}
                title={`${name} · ${tones(event.chord).map(pitchName).join(' – ')} · ${t[node.layer === 'core' ? 'spaceCore' : node.layer === 'near' ? 'spaceNear' : 'spaceOuter']} · ${description}`}
                onClick={() => choose(node.id)}
                onKeyDown={(e) => move(e, node)}
              >
                {name}
              </button>
            );
          })}
        </div>
      </div>
      <div
        className="space-readout"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {sounding ? (
          <>
            <strong>{symbol(sounding)}</strong>
            <span>
              {sounding.notes
                .map((note) => midiName(sounding.chord, note))
                .join(' · ')}
            </span>
            <span>
              {t.bass}: {midiName(sounding.chord, sounding.notes[0])}
            </span>
          </>
        ) : (
          <span>{t.spaceReady}</span>
        )}
      </div>
      <div className="space-model-footer">
        {!modelOverlay && suggestionSource === 'transformer' && (
          <div className="space-model-status" role="status">
            {modelError ? (
              <>
                {t.spaceModelUnavailable}{' '}
                <button onClick={() => setModelRetry((value) => value + 1)}>
                  {t.modelRetry}
                </button>
              </>
            ) : !currentPrediction ? (
              t.modelLoading
            ) : null}
          </div>
        )}
        <details className="space-model-details">
          <summary>{t.spaceModelDetails}</summary>
          <p>{t.spaceModelOverview}</p>
          <p>{t.spaceModelData}</p>
          <p>{t.spaceModelRights}</p>
        </details>
      </div>
    </section>
  );
}
