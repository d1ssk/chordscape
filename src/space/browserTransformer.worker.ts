import {
  BrowserTransformer,
  type BrowserModelManifest,
} from './browserTransformer';

let loaded: Promise<BrowserTransformer> | null = null;

async function load() {
  const base = `${import.meta.env.BASE_URL}model/`;
  const response = await fetch(`${base}pop-jazz-v1.json`);
  if (!response.ok) throw new Error(`Model manifest HTTP ${response.status}`);
  const manifest = (await response.json()) as BrowserModelManifest;
  if (manifest.weights_file !== 'pop-jazz-v1.bin')
    throw new Error('Unexpected model binary path.');
  const binaryResponse = await fetch(`${base}${manifest.weights_file}`);
  if (!binaryResponse.ok)
    throw new Error(`Model weights HTTP ${binaryResponse.status}`);
  const buffer = await binaryResponse.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const sha = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  if (sha !== manifest.weights_sha256)
    throw new Error('Model weights checksum mismatch.');
  return new BrowserTransformer(manifest, buffer);
}

self.onmessage = async (
  event: MessageEvent<{ id: number; history: string[]; style: string }>,
) => {
  const { id, history, style } = event.data;
  try {
    loaded ??= load();
    const model = await loaded;
    self.postMessage({ id, prediction: model.predict(history, style) });
  } catch (error) {
    loaded = null;
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
