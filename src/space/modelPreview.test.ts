import { expect, it, vi } from 'vitest';
import { chordscapeCandidateManifest } from './candidateManifest';
import {
  fetchPreviewPrediction,
  modelInputHistory,
  selectSpaceModelRun,
  type PreviewRun,
} from './modelPreview';

it('selects the lowest validation loss among 48-context runs', () => {
  const run = (
    run_id: string,
    context: number,
    validation_nll: number,
  ): PreviewRun => ({
    run_id,
    validation_nll,
    best_epoch: 1,
    config: { context, dropout: 0.2, learning_rate: 0.0003, epochs: 24 },
  });
  expect(
    selectSpaceModelRun([run('short', 32, 1), run('a', 48, 3), run('b', 48, 2)])
      ?.run_id,
  ).toBe('b');
  expect(selectSpaceModelRun([run('short', 32, 1)])).toBeNull();
});

it('uses the selected checkpoint context while retaining a longer trial history', () => {
  const history = Array.from({ length: 60 }, (_, index) => `chord-${index}`);
  expect(modelInputHistory(history, 32)).toEqual(history.slice(-32));
  expect(modelInputHistory(history, 48)).toEqual(history.slice(-48));
  expect(modelInputHistory(history.slice(0, 12), 48)).toEqual(
    history.slice(0, 12),
  );
  expect(history).toHaveLength(60);
});

it('sends all 48 trained history positions for a context 48 run', async () => {
  const history = Array.from({ length: 60 }, (_, index) => `chord-${index}`);
  const run: PreviewRun = {
    run_id: 'run-48',
    validation_nll: 2.9,
    best_epoch: 23,
    config: { context: 48, dropout: 0.2, learning_rate: 0.0003, epochs: 24 },
  };
  const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
    expect(JSON.parse(init?.body as string).history).toEqual(
      history.slice(-48),
    );
    return new Response(
      JSON.stringify({
        run_id: run.run_id,
        candidate_version: chordscapeCandidateManifest().version,
        candidates: [],
      }),
      { status: 200 },
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  try {
    await fetchPreviewPrediction(
      run,
      'pop',
      history,
      new AbortController().signal,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  } finally {
    vi.unstubAllGlobals();
  }
});
