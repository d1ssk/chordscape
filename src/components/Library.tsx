import { useState } from 'react';
import {
  chordSymbol,
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
import { type Messages } from '../i18n/messages';
const QUALITY_GROUPS = [
  {
    label: 'libraryBasic',
    qualities: ['major', 'minor', 'dim', 'aug', 'sus2', 'sus4'],
  },
  {
    label: 'librarySeventh',
    qualities: ['maj7', '7', 'm7', 'm(maj7)', 'm7♭5', 'dim7'],
  },
  {
    label: 'libraryAdded',
    qualities: ['6', 'm6', 'add9', 'm(add9)', '6/9', '7sus4'],
  },
  {
    label: 'libraryExtensions',
    qualities: [
      'maj9',
      '9',
      'm9',
      '11',
      'm11',
      '13',
      'm13',
      'maj13',
      'maj7(♯11)',
    ],
  },
  {
    label: 'libraryAltered',
    qualities: ['maj7♯5', '7♭5', '7♯5', '7♭9', '7♯9', '7(♭9,♯5)'],
  },
] as const satisfies readonly {
  label: keyof Messages;
  qualities: readonly Harmony['quality'][];
}[];
export function Library({
  initial,
  onInspect,
  t,
  disabled,
  onAudition,
  onAdd,
  onListen,
}: {
  initial: Harmony;
  onInspect: (chord: Harmony) => void;
  t: Messages;
  disabled: boolean;
  onAudition: (chord: Harmony) => void;
  onAdd: (chord: Harmony) => void;
  onListen: (chord: Harmony) => void;
}) {
  const [root, setRoot] = useState(pitchName(initial.root));
  const [quality, setQuality] = useState<Harmony['quality']>(initial.quality);
  const chord: Harmony = { root: parsePitch(root), quality };
  const examples: string[] = [];
  for (const mode of ['major', 'minor'] as const)
    for (const name of mode === 'major' ? MAJOR_KEYS : MINOR_KEYS) {
      const key = { tonic: parsePitch(name), mode };
      const analysis = analyze(chord, key);
      if (analysis.kind === 'diatonic' || analysis.kind === 'secondary')
        examples.push(`${name} ${t[mode]}: ${roman(analysis)}`);
    }
  return (
    <section className="library-panel" aria-label={t.library}>
      <div className="section-title">
        <strong>{t.library}</strong>
        <button onClick={() => onListen(chord)}>{t.listenScene}</button>
      </div>
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
        <button disabled={disabled} onClick={() => onAudition(chord)}>
          {t.audition}
        </button>
        <button disabled={disabled} onClick={() => onAdd(chord)}>
          {t.add}
        </button>
      </div>
      <div
        className="library-chords library-categories"
        role="group"
        aria-label={t.quality}
      >
        {QUALITY_GROUPS.map((group) => (
          <div
            className="library-quality-group"
            role="group"
            aria-labelledby={group.label}
            key={group.label}
          >
            <h3 id={group.label}>{t[group.label]}</h3>
            <div className="library-quality-row">
              {group.qualities.map((q) => {
                const candidate: Harmony = {
                  root: parsePitch(root),
                  quality: q,
                };
                const name = chordSymbol(candidate);
                const suffix = QUALITIES[q].suffix;
                const split = suffix.search(/[（(♭♯]/);
                const parts =
                  split < 0
                    ? [name]
                    : [
                        pitchName(candidate.root) + suffix.slice(0, split),
                        suffix.slice(split),
                      ];
                return (
                  <button
                    key={q}
                    aria-label={name}
                    aria-pressed={quality === q}
                    onClick={() => {
                      setQuality(q);
                      if (disabled) onInspect(candidate);
                      else onAudition(candidate);
                    }}
                  >
                    {parts.map((part, index) => (
                      <span className="library-chord-part" key={index}>
                        {part}
                      </span>
                    ))}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="muted">{t.libraryButtonsHint}</p>
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
