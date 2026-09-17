import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { Messages } from '../i18n/messages';
import { midiName, tones, pitchName, voicedSymbol } from '../music/harmony';
import type { ChordEvent } from '../state/session';
import {
  SPACE_NODES,
  SPACE_SIZE,
  spaceEvent,
  type SpaceNode,
} from '../space/layout';

const events = new Map(SPACE_NODES.map((node) => [node.id, spaceEvent(node)]));
const symbol = (event: ChordEvent) =>
  voicedSymbol(event.chord, event.notes).replace('dim', '°');

export function HarmonicSpace({
  t,
  onChoose,
  sounding,
}: {
  t: Messages;
  onChoose: (event: ChordEvent) => void;
  sounding: ChordEvent | null;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    const view = viewport.current;
    if (view) {
      view.scrollLeft = 610 - view.clientWidth / 2;
      view.scrollTop = 400 - view.clientHeight / 2;
    }
  }, []);
  function move(event: KeyboardEvent<HTMLButtonElement>, node: SpaceNode) {
    const direction = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }[event.key];
    if (!direction) return;
    event.preventDefault();
    const [dx, dy] = direction;
    const nearest = SPACE_NODES.filter((other) => other.id !== node.id)
      .map((other) => {
        const x = other.position.x - node.position.x;
        const y = other.position.y - node.position.y;
        return {
          other,
          forward: x * dx + y * dy,
          score: Math.hypot(x, y) + Math.abs(x * dy - y * dx) * 2,
        };
      })
      .filter(({ forward }) => forward > 0)
      .sort((a, b) => a.score - b.score)[0];
    buttons.current.get(nearest?.other.id ?? node.id)?.focus();
  }
  return (
    <section className="harmonic-space" aria-label={t.spaceTitle}>
      <div className="space-intro">
        <div>
          <h2>{t.spaceKey}</h2>
          <p>{t.spaceHint}</p>
        </div>
        <div className="space-legend" aria-label={t.spaceLayers}>
          <span className="space-legend-core">{t.spaceCore}</span>
          <span>{t.spaceNear}</span>
          <span className="space-legend-outer">{t.spaceOuter}</span>
        </div>
      </div>
      <p className="space-instructions" id="space-instructions">
        {t.spaceNavigation}
      </p>
      <div
        className="space-viewport"
        ref={viewport}
        role="region"
        aria-label={t.spaceMap}
        aria-describedby="space-instructions"
        tabIndex={0}
      >
        <div
          className="space-map"
          style={{ width: SPACE_SIZE.width, height: SPACE_SIZE.height }}
        >
          <span className="space-region-label space-flat">{t.spaceFlat}</span>
          <span className="space-region-label space-sharp">{t.spaceSharp}</span>
          {SPACE_NODES.map((node) => {
            const event = events.get(node.id)!;
            const name = symbol(event);
            return (
              <button
                key={node.id}
                ref={(element) => {
                  if (element) buttons.current.set(node.id, element);
                  else buttons.current.delete(node.id);
                }}
                className={`space-node space-node-${node.layer}${node.satelliteOf ? ' space-satellite' : ''}`}
                data-node-id={node.id}
                data-region={node.region}
                style={{ left: node.position.x, top: node.position.y }}
                aria-label={name}
                title={`${name} · ${tones(event.chord).map(pitchName).join(' – ')} · ${t[node.layer === 'core' ? 'spaceCore' : node.layer === 'near' ? 'spaceNear' : 'spaceOuter']}`}
                onClick={() => onChoose(event)}
                onKeyDown={(e) => move(e, node)}
              >
                {name}
              </button>
            );
          })}
        </div>
      </div>
      <div
        className="space-readout"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {sounding ? (
          <>
            <strong>{symbol(sounding)}</strong>
            <span>
              {sounding.notes
                .map((note) => midiName(sounding.chord, note))
                .join(' · ')}
            </span>
            <span>
              {t.bass}: {midiName(sounding.chord, sounding.notes[0])}
            </span>
          </>
        ) : (
          <span>{t.spaceReady}</span>
        )}
      </div>
    </section>
  );
}
