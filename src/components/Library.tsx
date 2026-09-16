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
  t,
  disabled,
  onAudition,
  onAdd,
}: {
  locale: Locale;
  t: Messages;
  disabled: boolean;
  onAudition: (chord: Harmony) => void;
  onAdd: (chord: Harmony) => void;
}) {
  const [root, setRoot] = useState('C');
  const [quality, setQuality] = useState<Harmony['quality']>('major');
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
    <section>
      <details>
        <summary>{t.library}</summary>
        <div className="controls library-controls">
          <label>
            {t.root}
            <select value={root} onChange={(e) => setRoot(e.target.value)}>
              {ROOTS.map((r) => (
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
                if (f !== 'all')
                  setQuality(
                    (Object.keys(QUALITIES) as Harmony['quality'][]).find(
                      (q) => QUALITIES[q].family === f,
                    )!,
                  );
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
              onChange={(e) => setQuality(e.target.value as Harmony['quality'])}
            >
              {(Object.keys(QUALITIES) as Harmony['quality'][])
                .filter(
                  (q) => family === 'all' || QUALITIES[q].family === family,
                )
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
      </details>
    </section>
  );
}
