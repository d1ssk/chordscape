import { ROOTS, parsePitch, pitchName, type Pitch } from '../music/harmony';
import type { Messages } from '../i18n/messages';

export function BassSelect({
  value,
  onChange,
  disabled,
  t,
}: {
  value?: Pitch | null;
  onChange: (pitch: Pitch | null) => void;
  disabled?: boolean;
  t: Messages;
}) {
  const name = value ? pitchName(value) : '';
  // Keep the selected spelling even when transposition produces E♯ or a double accidental.
  const names = [
    ...new Set([...ROOTS, 'C♭', 'E♯', 'F♭', 'B♯', ...(name ? [name] : [])]),
  ];
  return (
    <label>
      {t.addedBass}
      <select
        disabled={disabled}
        value={name}
        onChange={(event) =>
          onChange(event.target.value ? parsePitch(event.target.value) : null)
        }
      >
        <option value="">{t.noAddedBass}</option>
        {names.map((pitch) => (
          <option key={pitch} value={pitch}>
            {pitch}
          </option>
        ))}
      </select>
    </label>
  );
}
