import {
  MAJOR_KEYS,
  MINOR_KEYS,
  parsePitch,
  pitchName,
  transposeKey,
  type Key,
} from '../music/harmony';
import type { Settings, Session } from '../state/session';
import type { GeneratorSettings } from '../music/generation';
import type { Messages } from '../i18n/messages';

export function Generator({
  settings,
  record,
  stopped,
  canPlay,
  onSettings,
  onGenerate,
  onContinuous,
  t,
}: {
  settings: Settings;
  record: Session['generation'];
  stopped: boolean;
  canPlay: boolean;
  onSettings: (patch: Partial<Settings>) => void;
  onGenerate: () => void;
  onContinuous: () => void;
  t: Messages;
}) {
  const g = settings.generator;
  const update = (patch: Partial<GeneratorSettings>) =>
    onSettings({ generator: { ...g, ...patch } });
  function mode(mode: Key['mode']) {
    const key = { ...settings.key, mode };
    const names = mode === 'major' ? MAJOR_KEYS : MINOR_KEYS;
    onSettings({
      key: names.includes(pitchName(key.tonic)) ? key : transposeKey(key, 0),
    });
  }
  return (
    <section className="generator-panel">
      <p className="muted">{t.generateHint}</p>
      {!stopped && (
        <p role="status" className="notice">
          {t.stopToGenerate}
        </p>
      )}
      <fieldset disabled={!stopped} className="generator-form">
        <legend className="sr-only">{t.generatorSettings}</legend>
        <label>
          {t.key}
          <select
            value={pitchName(settings.key.tonic)}
            onChange={(e) =>
              onSettings({
                key: { ...settings.key, tonic: parsePitch(e.target.value) },
              })
            }
          >
            {(settings.key.mode === 'major' ? MAJOR_KEYS : MINOR_KEYS).map(
              (name) => (
                <option key={name}>{name}</option>
              ),
            )}
          </select>
        </label>
        <label>
          {t.mode}
          <select
            value={settings.key.mode}
            onChange={(e) => mode(e.target.value as Key['mode'])}
          >
            <option value="major">{t.major}</option>
            <option value="minor">{t.minor}</option>
          </select>
        </label>
        <label>
          {t.style}
          <select
            value={g.style}
            onChange={(e) => {
              const style = e.target.value as GeneratorSettings['style'];
              update({
                style,
                seventh: style === 'jazz',
                outside: style === 'jazz' ? 0.5 : 0,
              });
            }}
          >
            <option value="pop">Pop</option>
            <option value="jazz">Jazz</option>
          </select>
        </label>
        <label>
          {t.bars}
          <select
            value={g.bars}
            onChange={(e) =>
              update({
                bars: Number(e.target.value) as GeneratorSettings['bars'],
              })
            }
          >
            {[4, 8, 16].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.harmonicRhythm}
          <select
            value={g.beatsPerChord}
            onChange={(e) =>
              update({
                beatsPerChord: Number(
                  e.target.value,
                ) as GeneratorSettings['beatsPerChord'],
              })
            }
          >
            {[2, 4, 8].map((n) => (
              <option key={n} value={n}>
                {n} {t.beat}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.chordSize}
          <select
            value={g.seventh ? '7' : '3'}
            onChange={(e) => update({ seventh: e.target.value === '7' })}
          >
            <option value="3">{t.triads}</option>
            <option value="7">{t.sevenths}</option>
          </select>
        </label>
        <label>
          {t.ending}
          <select
            value={g.ending}
            onChange={(e) =>
              update({ ending: e.target.value as GeneratorSettings['ending'] })
            }
          >
            <option value="loop">{t.loopEnding}</option>
            <option value="cadence">{t.cadenceEnding}</option>
          </select>
        </label>
        <label>
          {t.voicing}
          <select
            value={settings.policy}
            onChange={(e) =>
              onSettings({ policy: e.target.value as Settings['policy'] })
            }
          >
            <option value="root">{t.rootMode}</option>
            <option value="smooth">{t.smooth}</option>
          </select>
        </label>
        <label>
          {t.outsideProbability} · {Math.round(g.outside * 100)}%
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={g.outside}
            onChange={(e) => update({ outside: Number(e.target.value) })}
          />
        </label>
        <label>
          {t.seed}
          <input
            type="number"
            min="0"
            max="4294967295"
            step="1"
            value={g.seed}
            onChange={(e) => {
              const seed = Number(e.target.value);
              if (Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff)
                update({ seed });
            }}
          />
        </label>
        <div className="generator-actions">
          <button
            onClick={() =>
              update({ seed: crypto.getRandomValues(new Uint32Array(1))[0] })
            }
          >
            {t.newSeed}
          </button>
          <button className="primary" onClick={onGenerate}>
            {t.generate}
          </button>
          <button disabled={!canPlay} onClick={onContinuous}>
            {t.startContinuous}
          </button>
        </div>
      </fieldset>
      <p className="muted">{g.style === 'pop' ? t.popRules : t.jazzRules}</p>
      <p className="muted">{t.outsideProbabilityHint}</p>
      <details className="generation-help">
        <summary>{t.continuous}</summary>
        <p className="muted">{t.continuousHint}</p>
      </details>
      {record && (
        <p className="muted generation-record">
          {t.lastGeneration}: {record.options.style === 'pop' ? 'Pop' : 'Jazz'}{' '}
          · {t.seed} {record.options.seed} · {t.phrase} {record.phrase + 1}
          {record.modified ? ` · ${t.modifiedGeneration}` : ''}
        </p>
      )}
    </section>
  );
}
