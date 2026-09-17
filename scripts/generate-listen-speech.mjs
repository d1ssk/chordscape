// Build-time only. Run the official VOICEVOX Nemo 0.24.0 engine locally first.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
function moduleUrl(source) {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
}
const harmony = moduleUrl(
  readFileSync(new URL('../src/music/harmony.ts', import.meta.url), 'utf8'),
);
const source = readFileSync(
  new URL('../src/listen/speech.ts', import.meta.url),
  'utf8',
);
const { speechPhrases } = await import(
  moduleUrl(source.replace("'../music/harmony'", JSON.stringify(harmony)))
);
const result = spawnSync(
  process.env.LISTEN_PYTHON ?? 'python3',
  ['scripts/generate-listen-speech.py'],
  {
    input: JSON.stringify(speechPhrases),
    stdio: ['pipe', 'inherit', 'inherit'],
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
