"""Pure key-relative conversion, preserving spelling and annotation origin."""
from __future__ import annotations

from typing import Optional

from .schema import (
    LETTERS, MODES, NATURALS, ChordEvent, ChordFactors, EventContext,
    Key, KeyAnnotation, ParseResult, Pitch, RelativePitch,
)


def relative_pitch(pitch: Pitch, key: Key) -> RelativePitch:
    tonic_index = LETTERS.index(key.tonic.letter)
    pitch_index = LETTERS.index(pitch.letter)
    degree = (pitch_index - tonic_index) % 7
    # Compare spelled notes in the ascending diatonic octave, never nearest PC.
    written_height = NATURALS[pitch_index] + (12 if pitch_index < tonic_index else 0) + pitch.accidental
    expected_height = NATURALS[tonic_index] + key.tonic.accidental + MODES[key.mode][degree]
    return RelativePitch(degree + 1, written_height - expected_height)


def normalize(
    parsed: ParseResult,
    *,
    global_key: Optional[KeyAnnotation] = None,
    local_key: Optional[KeyAnnotation] = None,
    style: Optional[str] = None,
    context: Optional[EventContext] = None,
    source_reference: Optional[str] = None,
) -> ChordEvent:
    reference = local_key or global_key
    basis = "local" if local_key else "global_fallback" if global_key else "missing"
    chord = parsed.chord
    factors = None
    if chord is not None:
        factors = ChordFactors(
            relative_pitch(chord.root, reference.key) if reference else None,
            chord.components,
            relative_pitch(chord.bass, reference.key) if chord.bass and reference else None,
        )
    return ChordEvent(parsed, factors, global_key, local_key, basis, style,
                      context if context is not None else EventContext(), source_reference)
