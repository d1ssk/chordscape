import { useRef, useState } from 'react';
import {
  chordSymbol,
  parsePitch,
  QUALITIES,
  ROOTS,
  tones,
  pitchName,
  type Harmony,
  type Key,
} from '../music/harmony';
import type { Messages } from '../i18n/messages';
import { Palette } from './Palette';

export function OutsidePalette({
  defaults,
  custom,
  onChange,
  storageFailed,
  context,
  disabled,
  onChoose,
  selected,
  t,
}: {
  defaults: Harmony[];
  custom: Harmony[];
  onChange: (chords: Harmony[]) => void;
  storageFailed: boolean;
  context: Key;
  disabled: boolean;
  onChoose: (chord: Harmony) => void;
  selected: string;
  t: Messages;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [root, setRoot] = useState('C');
  const [quality, setQuality] = useState<Harmony['quality']>('major');
  const candidate = { root: parsePitch(root), quality };
  const name = chordSymbol(candidate);
  const chords = [
    ...new Map(
      [...defaults, ...custom].map((chord) => [chordSymbol(chord), chord]),
    ).values(),
  ];
  const exists = chords.some((chord) => chordSymbol(chord) === name);
  return (
    <details className="outside">
      <summary>{t.outside}</summary>
      <div className="section-title outside-actions">
        <p className="muted">{t.outsideHint}</p>
        <button onClick={() => dialog.current?.showModal()}>
          {t.customPaletteOpen}
        </button>
      </div>
      {storageFailed && <p role="status">{t.customPaletteStorageError}</p>}
      <Palette
        chords={chords}
        context={context}
        disabled={disabled}
        onChoose={onChoose}
        selected={selected}
      />
      <dialog
        ref={dialog}
        className="chord-picker"
        aria-labelledby="chord-picker-title"
      >
        <div className="section-title">
          <h2 id="chord-picker-title">{t.customPaletteTitle}</h2>
          <button onClick={() => dialog.current?.close()}>
            {t.customPaletteClose}
          </button>
        </div>
        <p className="muted">{t.customPaletteHint}</p>
        <label>
          {t.root}
          <select value={root} onChange={(e) => setRoot(e.target.value)}>
            {ROOTS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <div className="library-chords" role="group" aria-label={t.quality}>
          {(Object.keys(QUALITIES) as Harmony['quality'][]).map((q) => (
            <button
              key={q}
              aria-pressed={quality === q}
              onClick={() => setQuality(q)}
            >
              {chordSymbol({ root: parsePitch(root), quality: q })}
            </button>
          ))}
        </div>
        <p>
          <strong>{name}</strong> ·{' '}
          {tones(candidate).map(pitchName).join(' – ')}
        </p>
        <button
          disabled={exists}
          onClick={() => onChange([...custom, candidate])}
        >
          {exists ? t.customPaletteExists : t.customPaletteAdd}
        </button>
        {custom.length > 0 && (
          <section aria-label={t.customPaletteSaved}>
            <h3>{t.customPaletteSaved}</h3>
            <div className="custom-chord-list">
              {custom.map((chord) => (
                <button
                  key={chordSymbol(chord)}
                  aria-label={`${chordSymbol(chord)} ${t.remove}`}
                  onClick={() =>
                    onChange(
                      custom.filter(
                        (item) => chordSymbol(item) !== chordSymbol(chord),
                      ),
                    )
                  }
                >
                  {chordSymbol(chord)} ×
                </button>
              ))}
            </div>
          </section>
        )}
      </dialog>
    </details>
  );
}
