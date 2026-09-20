import type { PreviewPrediction } from './modelPreview';

let worker: Worker | null = null;
let sequence = 0;
const pending = new Map<
  number,
  {
    resolve: (value: PreviewPrediction) => void;
    reject: (reason: Error) => void;
  }
>();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(
    new URL('./browserTransformer.worker.ts', import.meta.url),
    { type: 'module' },
  );
  worker.onmessage = (
    event: MessageEvent<{
      id: number;
      prediction?: PreviewPrediction;
      error?: string;
    }>,
  ) => {
    const { id, prediction, error } = event.data;
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    if (prediction) request.resolve(prediction);
    else request.reject(new Error(error ?? 'Model inference failed.'));
  };
  worker.onerror = () => {
    for (const request of pending.values())
      request.reject(new Error('Model worker failed.'));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

export function predictBrowserModel(history: readonly string[], style: string) {
  const id = ++sequence;
  return new Promise<PreviewPrediction>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, history, style });
  });
}
