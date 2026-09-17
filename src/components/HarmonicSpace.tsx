import { useRef, type CSSProperties, type KeyboardEvent } from 'react';
import type { Messages } from '../i18n/messages';
import { midiName, tones, pitchName, voicedSymbol } from '../music/harmony';
import type { ChordEvent } from '../state/session';
import {
  SPACE_NODES,
  SPACE_SIZE,
  SPACE_PORTRAIT_SIZE,
  SPACE_PORTRAIT_POSITIONS,
  spaceEvent,
  type SpaceNode,
} from '../space/layout';

const events = new Map(SPACE_NODES.map((node) => [node.id, spaceEvent(node)]));
const symbol = (event: ChordEvent) => voicedSymbol(event.chord, event.notes);

export function HarmonicSpace({
  t,
  onChoose,
  sounding,
}: {
  t: Messages;
  onChoose: (event: ChordEvent) => void;
  sounding: ChordEvent | null;
}) {
  const buttons = useRef(new Map<string, HTMLButtonElement>());
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
    const origin = buttons.current.get(node.id)!.getBoundingClientRect();
    const nearest = SPACE_NODES.filter((other) => other.id !== node.id)
      .map((other) => {
        // Use rendered coordinates so arrow navigation follows either layout.
        const target = buttons.current.get(other.id)!.getBoundingClientRect();
        const x = target.x + target.width / 2 - origin.x - origin.width / 2;
        const y = target.y + target.height / 2 - origin.y - origin.height / 2;
        return {
          other,
          forward: x * dx + y * dy,
          score: Math.hypot(x, y) + Math.abs(x * dy - y * dx) * 3,
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
        role="region"
        aria-label={t.spaceMap}
        aria-describedby="space-instructions"
        tabIndex={0}
      >
        <div className="space-map">
          <span className="space-region-label space-flat">{t.spaceFlat}</span>
          <span className="space-region-label space-sharp">{t.spaceSharp}</span>
          {SPACE_NODES.map((node) => {
            const event = events.get(node.id)!;
            const name = symbol(event);
            const portrait = SPACE_PORTRAIT_POSITIONS[node.id];
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
                style={
                  {
                    '--space-x': `${(node.position.x / SPACE_SIZE.width) * 100}%`,
                    '--space-y': `${(node.position.y / SPACE_SIZE.height) * 100}%`,
                    '--space-portrait-x': `${(portrait.x / SPACE_PORTRAIT_SIZE.width) * 100}%`,
                    '--space-portrait-y': `${(portrait.y / SPACE_PORTRAIT_SIZE.height) * 100}%`,
                  } as CSSProperties
                }
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
