"""POP909 algorithmic chord/key text adapter (local-only source)."""
from __future__ import annotations

from bisect import bisect_right
import io
from pathlib import Path
import re
from typing import List, Optional, Tuple
import zipfile

from .conversion import Boundary, ConvertedSong, provenance
from .mcgill_billboard import McGillChordParser
from .normalize import normalize
from .parser import parse_key
from .schema import EventContext, KeyAnnotation, ParseResult, Song


ADAPTER_VERSION = "pop909-v1"
DEFAULT_SEED = "chordscape-pop909-split-v1"
NOTATION = "pop909-harte-v1"
SOURCE_NOTES = (
    "Labels are algorithmically extracted weak labels, not human ground truth.",
)


class Pop909ChordParser:
    def __init__(self) -> None:
        self._harte = McGillChordParser()

    def parse(self, raw: str) -> ParseResult:
        parsed = self._harte.parse(raw)
        return ParseResult(
            parsed.raw_chord, NOTATION, parsed.status, parsed.chord, parsed.diagnostics
        )


def _archive(raw_root: Path) -> Path:
    candidates = [raw_root] if raw_root.is_file() else list(raw_root.rglob("POP909.zip"))
    if len(candidates) != 1 or not candidates[0].is_file():
        raise ValueError(f"Expected exactly one POP909.zip below {raw_root}")
    return candidates[0]


def _rows(text: str, fields: int) -> list:
    result = []
    for line_number, line in enumerate(text.splitlines(), 1):
        parts = line.split()
        if len(parts) != fields:
            raise ValueError(f"line {line_number}: expected {fields} fields")
        result.append(parts)
    return result


def _key_intervals(text: str, song_id: str):
    result = []
    for line_number, parts in enumerate(_rows(text, 3), 1):
        start, end = float(parts[0]), float(parts[1])
        try:
            key = parse_key(parts[2])
        except ValueError:
            key = None
        annotation = KeyAnnotation(
            key,
            "estimated",
            f"{ADAPTER_VERSION}: algorithmic key_audio label at pop909:{song_id}:key:{line_number}",
        ) if key else None
        result.append((start, end, annotation, parts[2]))
    return result


def _beat_map(text: str):
    rows = _rows(text, 3)
    times = [float(row[0]) for row in rows]
    downbeats = [bool(float(row[2])) for row in rows]
    bars, beats = [], []
    bar = -1
    beat = 0
    for downbeat in downbeats:
        if downbeat or bar < 0:
            bar += 1
            beat = 0
        bars.append(bar)
        beats.append(beat)
        beat += 1
    return times, bars, beats


def _beat_position(value: float, times: list) -> float:
    if not times:
        return 0.0
    index = bisect_right(times, value) - 1
    if index < 0:
        if len(times) == 1:
            return 0.0
        return (value - times[0]) / (times[1] - times[0])
    if index >= len(times) - 1:
        step = times[-1] - times[-2] if len(times) > 1 else 1.0
        return index + (value - times[index]) / step
    span = times[index + 1] - times[index]
    return index + (value - times[index]) / span if span else float(index)


def _active_key(intervals: list, time: float):
    for start, end, annotation, raw in intervals:
        if start <= time < end + 1e-6:
            return annotation, raw
    previous = [item for item in intervals if item[0] <= time]
    return (previous[-1][2], previous[-1][3]) if previous else (None, None)


def convert_dataset(raw_root: Path) -> List[ConvertedSong]:
    archive = _archive(raw_root)
    parser = Pop909ChordParser()
    source = provenance("pop909", ADAPTER_VERSION)
    converted = []
    with zipfile.ZipFile(archive) as bundle:
        names = set(bundle.namelist())
        song_ids = sorted({
            match[1] for name in names
            if (match := re.fullmatch(r"POP909/(\d{3})/chord_midi\.txt", name))
        })
        for song_id in song_ids:
            prefix = f"POP909/{song_id}/"
            required = ["chord_midi.txt", "beat_midi.txt", "key_audio.txt"]
            missing = [name for name in required if prefix + name not in names]
            if missing:
                raise ValueError(f"POP909 {song_id} missing {missing}")
            read = lambda name: bundle.read(prefix + name).decode("utf-8-sig")
            chord_rows = _rows(read("chord_midi.txt"), 3)
            times, bars, beats = _beat_map(read("beat_midi.txt"))
            keys = _key_intervals(read("key_audio.txt"), song_id)
            global_key = next((item[2] for item in keys if item[2]), None)
            events = []
            boundaries = []
            for line_number, parts in enumerate(chord_rows, 1):
                start, end, raw = float(parts[0]), float(parts[1]), parts[2]
                parsed = parser.parse(raw)
                position = _beat_position(start, times)
                end_position = _beat_position(end, times)
                nearest = min(max(round(position), 0), len(times) - 1) if times else 0
                active_key, raw_key = _active_key(keys, start)
                local_key = active_key if active_key and active_key != global_key else None
                reference = f"pop909:{song_id}:chord:{line_number}"
                event = normalize(
                    parsed,
                    global_key=global_key,
                    local_key=local_key,
                    style="pop",
                    context=EventContext(
                        duration=max(end_position - position, 1e-9),
                        beat_position=float(beats[nearest]) if times else None,
                        bar_position=bars[nearest] if times else None,
                        meter=(4, 4),
                    ),
                    source_reference=reference,
                )
                events.append(event)
                if parsed.status in {"failure", "no_chord"}:
                    boundaries.append(Boundary(len(events) - 1, reference, parsed.status))
            song = Song(
                f"pop909-{song_id}", f"pop909-work-{song_id}", source, tuple(events)
            )
            converted.append(ConvertedSong(
                song, song_id, "", "pop909", tuple(boundaries),
                {
                    "pop909_id": song_id,
                    "label_quality": "algorithmically extracted weak labels",
                    "key_segments": [item[3] for item in keys],
                    "alignment": "chord_midi mapped to beat_midi by timestamp interpolation",
                },
            ))
    if len(converted) != 909:
        raise ValueError(f"Expected 909 POP909 songs, found {len(converted)}")
    return converted
