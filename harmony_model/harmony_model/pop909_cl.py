"""POP909-CL expert-corrected MIDI chord-track adapter (local-only source)."""
from __future__ import annotations

from collections import defaultdict
from pathlib import Path
import re
from typing import List, Optional, Sequence, Tuple
import zipfile

from .conversion import Boundary, ConvertedSong, provenance
from .midi import MidiNote, read_midi
from .normalize import normalize
from .parser import parse_pitch
from .schema import (
    ChordComponents, EventContext, Key, KeyAnnotation, ParseResult, Pitch,
    Song, SymbolicChord,
)


ADAPTER_VERSION = "pop909-cl-v1"
DEFAULT_SEED = "chordscape-pop909-cl-split-v1"
NOTATION = "pop909-cl-midi-pitch-set-v1"
SOURCE_NOTES = (
    "The pinned POP909_processed.zip has 908 MIDI files; 043.mid is absent although the README states 909 tracks.",
    "367.mid has no corrected chord track and is emitted as an empty song record.",
    "518.mid and 620.mid retain the alignment caveats documented by the source README.",
)

_TEMPLATES = (
    ("major", "none", {0, 4, 7}),
    ("minor", "none", {0, 3, 7}),
    ("diminished", "none", {0, 3, 6}),
    ("augmented", "none", {0, 4, 8}),
    ("sus2", "none", {0, 2, 7}),
    ("sus4", "none", {0, 5, 7}),
    ("major", "minor7", {0, 4, 7, 10}),
    ("major", "major7", {0, 4, 7, 11}),
    ("minor", "minor7", {0, 3, 7, 10}),
    ("diminished", "minor7", {0, 3, 6, 10}),
    ("diminished", "diminished7", {0, 3, 6, 9}),
    ("minor", "major7", {0, 3, 7, 11}),
    ("augmented", "minor7", {0, 4, 8, 10}),
)
_MAJOR_KEYS = ("Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#")
_MINOR_KEYS = ("Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#", "G#", "D#", "A#")
_SHARP_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
_FLAT_NAMES = ("C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B")


def _pitch_for_pc(pc: int, prefer_flats: bool) -> Pitch:
    return parse_pitch((_FLAT_NAMES if prefer_flats else _SHARP_NAMES)[pc % 12])


def _key(tick: int, signatures: Sequence[Tuple[int, int, int]]) -> Optional[KeyAnnotation]:
    active = None
    for item in signatures:
        if item[0] > tick:
            break
        active = item
    if active is None or not -7 <= active[1] <= 7 or active[2] not in {0, 1}:
        return None
    name = (_MINOR_KEYS if active[2] else _MAJOR_KEYS)[active[1] + 7]
    return KeyAnnotation(Key(parse_pitch(name), "minor" if active[2] else "major"), "annotated")


def _parse_pitch_set(notes: Sequence[MidiNote], key: Optional[KeyAnnotation]) -> ParseResult:
    pcs = {note.pitch % 12 for note in notes}
    raw = "midi:[" + ",".join(str(note.pitch) for note in sorted(notes, key=lambda n: n.pitch)) + "]"
    prefer_flats = bool(key and key.key.tonic.accidental < 0)
    for root_pc in sorted(pcs):
        intervals = {(pc - root_pc) % 12 for pc in pcs}
        for quality, seventh, template in _TEMPLATES:
            if intervals != template:
                continue
            root = _pitch_for_pc(root_pc, prefer_flats)
            bass = _pitch_for_pc(min(notes, key=lambda note: note.pitch).pitch % 12, prefer_flats)
            chord = SymbolicChord(root, ChordComponents(quality, seventh, (), ()), bass)
            return ParseResult(raw, NOTATION, "ok", chord)
    if not notes:
        return ParseResult(raw, NOTATION, "no_chord", None)
    root = _pitch_for_pc(min(notes, key=lambda note: note.pitch).pitch % 12, prefer_flats)
    chord = SymbolicChord(root, ChordComponents("other", None, None, None), root)
    return ParseResult(
        raw, NOTATION, "partial", chord,
        ("Pitch-class set does not match a POP909-CL chord template",),
    )


def _archive(raw_root: Path) -> Path:
    candidates = [raw_root] if raw_root.is_file() else list(raw_root.rglob("POP909_processed.zip"))
    if len(candidates) != 1 or not candidates[0].is_file():
        raise ValueError(f"Expected exactly one POP909_processed.zip below {raw_root}")
    return candidates[0]


def _active_meter(tick: int, signatures: Sequence[Tuple[int, int, int]]) -> Tuple[int, int]:
    active = (0, 4, 4)
    for item in signatures:
        if item[0] > tick:
            break
        active = item
    return active[1], active[2]


def _bar_beat(tick: int, ticks_per_beat: int, signatures: Sequence[Tuple[int, int, int]]):
    # POP909-CL changes are placed on grid boundaries. Integrate each meter region.
    bar = 0
    region_start = 0
    active = (4, 4)
    for change_tick, numerator, denominator in signatures:
        if change_tick > tick:
            break
        if change_tick > region_start:
            quarters_per_bar = active[0] * 4 / active[1]
            bar += int((change_tick - region_start) / ticks_per_beat / quarters_per_bar)
        region_start = change_tick
        active = numerator, denominator
    quarters = (tick - region_start) / ticks_per_beat
    quarters_per_bar = active[0] * 4 / active[1]
    return bar + int(quarters // quarters_per_bar), quarters % quarters_per_bar, active


def convert_dataset(raw_root: Path) -> List[ConvertedSong]:
    archive = _archive(raw_root)
    source = provenance("pop909_cl", ADAPTER_VERSION)
    converted = []
    with zipfile.ZipFile(archive) as bundle:
        members = sorted(
            name for name in bundle.namelist()
            if re.fullmatch(r"POP909_processed/\d{3}\.mid", name)
        )
        for member in members:
            song_id = Path(member).stem
            midi = read_midi(bundle.read(member))
            chord_track = next(
                (track for track in midi.tracks if track.name.strip().casefold() == "chords"),
                None,
            )
            if chord_track is None:
                chord_track = next(
                    (track for track in midi.tracks if any(note.channel == 1 for note in track.notes)),
                    None,
                )
            if chord_track is None:
                song = Song(
                    f"pop909-cl-{song_id}", f"pop909-work-{song_id}", source, ()
                )
                converted.append(ConvertedSong(
                    song, song_id, "", "pop909_cl", (),
                    {
                        "pop909_id": song_id,
                        "label_quality": "expert-reviewed corrected chord track",
                        "ticks_per_beat": midi.ticks_per_beat,
                        "conversion_diagnostics": ["source MIDI has no corrected chord track"],
                        "known_issues": [],
                    },
                ))
                continue
            groups = defaultdict(list)
            for note in chord_track.notes:
                groups[note.start].append(note)
            blocks = [
                (tick, max(note.end for note in notes), tuple(notes))
                for tick, notes in sorted(groups.items())
            ]
            global_key = _key(0, midi.key_signatures)
            events = []
            boundaries = []

            def append_no_chord(start: int, end: int, reason: str) -> None:
                if end <= start:
                    return
                bar, beat, meter = _bar_beat(start, midi.ticks_per_beat, midi.time_signatures)
                reference = f"pop909-cl:{song_id}:tick:{start}"
                parsed = ParseResult("N", NOTATION, "no_chord", None)
                events.append(normalize(
                    parsed,
                    global_key=global_key,
                    style="pop",
                    context=EventContext((end - start) / midi.ticks_per_beat, beat, bar, meter),
                    source_reference=reference,
                ))
                boundaries.append(Boundary(len(events) - 1, reference, reason))

            cursor = 0
            for block_index, (start, end, notes) in enumerate(blocks):
                append_no_chord(cursor, start, "unlabelled_gap")
                annotation = _key(start, midi.key_signatures)
                local_key = annotation if annotation and annotation != global_key else None
                parsed = _parse_pitch_set(notes, annotation or global_key)
                next_start = blocks[block_index + 1][0] if block_index + 1 < len(blocks) else end
                duration_end = min(end, next_start) if next_start > start else end
                bar, beat, meter = _bar_beat(start, midi.ticks_per_beat, midi.time_signatures)
                reference = f"pop909-cl:{song_id}:tick:{start}"
                events.append(normalize(
                    parsed,
                    global_key=global_key,
                    local_key=local_key,
                    style="pop",
                    context=EventContext(
                        max(duration_end - start, 1) / midi.ticks_per_beat,
                        beat, bar, meter,
                    ),
                    source_reference=reference,
                ))
                cursor = max(cursor, end)
            known_issues = []
            if song_id == "518":
                known_issues.append("left/right-hand downbeat misalignment; source retains algorithm-extracted labels")
            if song_id == "620":
                known_issues.append("possible left/right-hand misalignment")
            song = Song(
                f"pop909-cl-{song_id}", f"pop909-work-{song_id}", source, tuple(events)
            )
            converted.append(ConvertedSong(
                song, song_id, "", "pop909_cl", tuple(boundaries),
                {
                    "pop909_id": song_id,
                    "label_quality": "expert-reviewed corrected chord track",
                    "ticks_per_beat": midi.ticks_per_beat,
                    "known_issues": known_issues,
                },
            ))
    # The pinned POP909_processed.zip contains 908 files: 043.mid is absent,
    # despite the release README's 909-track statement.  Preserve that source
    # discrepancy instead of fabricating a record.
    if len(converted) != 908:
        raise ValueError(f"Pinned POP909-CL archive should contain 908 songs, found {len(converted)}")
    return converted
