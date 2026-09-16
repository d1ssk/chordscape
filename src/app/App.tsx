import { useEffect, useRef, useState } from 'react';
import { AudioEngine } from '../audio/engine';
import { majorTriads, symbol, type Chord } from '../music/theory';
import { messages, type Locale } from '../i18n/messages';
import { Keyboard } from '../components/Keyboard';
const chords = majorTriads('C');
export function App() {
  const [locale, setLocale] = useState<Locale>('ja');
  const t = messages[locale];
  const engine = useRef<AudioEngine | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [volume, setVolume] = useState(0.5);
  const [selected, setSelected] = useState(chords[0]);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const audio = new AudioEngine();
    engine.current = audio;
    return () => {
      audio.dispose();
      engine.current = null;
    };
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  async function enable() {
    try {
      setReady(await engine.current!.unlock());
      engine.current!.setVolume(volume);
      setError(false);
    } catch {
      setError(true);
    }
  }
  function choose(chord: Chord) {
    setSelected(chord);
    setPlaying(true);
    engine.current!.audition(chord.midi, () => setPlaying(false));
  }
  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">HARMONY PLAYGROUND</p>
          <h1>
            Chordscape<span>◌</span>
          </h1>
          <p>{t.tagline}</p>
        </div>
        <label>
          {t.language}
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
          >
            <option value="ja">日本語</option>
            <option value="en">English</option>
          </select>
        </label>
      </header>
      <section className="transport" aria-label={t.synth}>
        <button className="primary" onClick={() => void enable()}>
          {ready ? t.ready : t.enable}
        </button>
        <button
          onClick={() => {
            engine.current!.stop();
            setPlaying(false);
          }}
        >
          {t.stop}
        </button>
        <label>
          {t.volume}
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={(e) => {
              const v = Number(e.target.value);
              setVolume(v);
              engine.current!.setVolume(v);
            }}
          />
        </label>
        <span>{t.synth}</span>
        <span role="status">{playing ? t.playing : t.idle}</span>
      </section>
      {error && <p role="alert">{t.error}</p>}
      <section>
        <div className="section-title">
          <h2>{t.palette}</h2>
          <span>{t.key}</span>
        </div>
        <p className="muted">{t.hint}</p>
        <div className="palette">
          {chords.map((chord) => (
            <button
              key={chord.root}
              disabled={!ready}
              aria-pressed={selected.root === chord.root}
              onClick={() => choose(chord)}
            >
              <strong>{symbol(chord)}</strong>
              <span>{chord.roman}</span>
            </button>
          ))}
        </div>
      </section>
      <section>
        <h2>{t.details}</h2>
        <div className="chord-summary" aria-live="polite">
          <strong data-testid="chord-symbol">{symbol(selected)}</strong>
          <span>{selected.roman}</span>
          <p>
            {t.notes}: {selected.notes.join(' – ')}
          </p>
          <p>
            {t.bass}: {selected.notes[0]}
          </p>
        </div>
        <h3>{t.keyboard}</h3>
        <Keyboard
          notes={playing ? selected.midi : []}
          label={t.keyboard}
          bassLabel={t.bass}
        />
      </section>
    </main>
  );
}
