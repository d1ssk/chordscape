import { useState } from 'react';
import {
  chordSymbol,
  diatonic,
  MAJOR_KEYS,
  MINOR_KEYS,
  parsePitch,
  pitchName,
  QUALITIES,
  ROOTS,
  tones,
  analyze,
  roman,
  type Harmony,
} from '../music/harmony';
import { familyNames, type Locale, type Messages } from '../i18n/messages';
export function Library({
  locale,
  initial,
  onInspect,
  t,
  disabled,
  onAudition,
  onAdd,
}: {
  locale: Locale;
  initial: Harmony;
  onInspect: (chord: Harmony) => void;
  t: Messages;
  disabled: boolean;
  onAudition: (chord: Harmony) => void;
  onAdd: (chord: Harmony) => void;
}) {
  const [root, setRoot] = useState(pitchName(initial.root));
  const [quality, setQuality] = useState<Harmony['quality']>(initial.quality);
  const [family, setFamily] = useState('all');
  const chord: Harmony = { root: parsePitch(root), quality };
  const examples: string[] = [];
  for (const mode of ['major', 'minor'] as const)
    for (const name of mode === 'major' ? MAJOR_KEYS : MINOR_KEYS) {
      const key = { tonic: parsePitch(name), mode };
      const analysis = analyze(chord, key);
      if (
        diatonic(key, tones(chord).length === 4).some(
          (c) => chordSymbol(c) === chordSymbol(chord),
        ) ||
        analysis.kind === 'secondary'
      )
        examples.push(`${name} ${t[mode]}: ${roman(analysis)}`);
    }
  return (
    <section className="library-panel" aria-label={t.library}>
      <div className="controls library-controls">
        <label>
          {t.root}
          <select
            value={root}
            onChange={(e) => {
              setRoot(e.target.value);
              onInspect({ root: parsePitch(e.target.value), quality });
            }}
          >
            {[...new Set([...ROOTS, pitchName(initial.root)])].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <label>
          {t.family}
          <select
            value={family}
            onChange={(e) => {
              const f = e.target.value;
              setFamily(f);
              if (f !== 'all') {
                const quality = (
                  Object.keys(QUALITIES) as Harmony['quality'][]
                ).find((q) => QUALITIES[q].family === f)!;
                setQuality(quality);
                onInspect({ root: parsePitch(root), quality });
              }
            }}
          >
            <option value="all">{t.all}</option>
            {Object.entries(familyNames[locale]).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.quality}
          <select
            value={quality}
            onChange={(e) => {
              const quality = e.target.value as Harmony['quality'];
              setQuality(quality);
              onInspect({ root: parsePitch(root), quality });
            }}
          >
            {(Object.keys(QUALITIES) as Harmony['quality'][])
              .filter((q) => family === 'all' || QUALITIES[q].family === family)
              .map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
          </select>
        </label>
        <button disabled={disabled} onClick={() => onAudition(chord)}>
          {t.audition}
        </button>
        <button disabled={disabled} onClick={() => onAdd(chord)}>
          {t.add}
        </button>
      </div>
      <p>
        <strong>{chordSymbol(chord)}</strong> ·{' '}
        {tones(chord).map(pitchName).join(' – ')} ·{' '}
        {QUALITIES[quality].intervals.join(' / ')}
      </p>
      <p className="muted">
        {t.occurs}: {examples.slice(0, 5).join(' · ') || t.none}
      </p>
    </section>
  );
}
