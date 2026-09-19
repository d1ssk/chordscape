"""Weimar Jazz Database release 2.1 / database 2.2 adapter."""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
import re
import sqlite3
from typing import Dict, List, Optional, Sequence, Tuple

from .conversion import Boundary, ConvertedSong, provenance
from .normalize import normalize
from .parser import parse_pitch
from .schema import (
    ChordComponents, EventContext, Key, KeyAnnotation, ParseResult, Pitch,
    Song, SymbolicChord,
)


ADAPTER_VERSION = "weimar-jazz-v1"
DEFAULT_SEED = "chordscape-weimar-jazz-split-v1"
NOTATION = "weimar-jazz-symbol-v1"
SOURCE_NOTES = (
    "Modal/chromatic source keys are preserved in metadata but remain unnormalized under schema v1.",
)
ROOT = re.compile(r"^(?P<root>[A-G](?:b|#)?)(?P<body>.*?)(?:/(?P<bass>[A-G](?:b|#)?))?$")


class WeimarChordParser:
    """Parse the compact chord spelling used by ``beats.chord``."""

    def parse(self, raw: str) -> ParseResult:
        text = raw.strip()
        if text in {"", "NC", "N"}:
            return ParseResult(raw, NOTATION, "no_chord", None)
        match = ROOT.fullmatch(text)
        if not match:
            return ParseResult(raw, NOTATION, "failure", None, ("Malformed Weimar chord",))
        try:
            root = parse_pitch(match["root"])
            bass = parse_pitch(match["bass"]) if match["bass"] else None
        except ValueError as error:
            return ParseResult(raw, NOTATION, "failure", None, (str(error),))
        body = match["body"]
        quality = "major"
        seventh = "none"
        extensions = set()
        alterations = set()
        unsupported = []

        if body.startswith("-"):
            quality, body = "minor", body[1:]
        elif body.startswith("m7b5"):
            quality, seventh, body = "diminished", "minor7", body[4:]
        elif body.startswith("o7"):
            quality, seventh, body = "diminished", "diminished7", body[2:]
        elif body.startswith("o"):
            quality, body = "diminished", body[1:]
        elif body.startswith("+j7"):
            quality, seventh, body = "augmented", "major7", body[3:]
        elif body.startswith("+7"):
            quality, seventh, body = "augmented", "minor7", body[2:]
        elif body.startswith("+"):
            quality, body = "augmented", body[1:]
        elif body.startswith("sus"):
            quality, body = "sus4", body[3:]
        elif body.startswith("j7"):
            seventh, body = "major7", body[2:]
        elif body.startswith("7"):
            seventh, body = "minor7", body[1:]

        # Minor and sus symbols put the seventh after the quality marker.
        if body.startswith("j7"):
            seventh, body = "major7", body[2:]
        elif body.startswith("7"):
            seventh, body = "minor7", body[1:]
        if body.startswith("alt"):
            chord = SymbolicChord(root, ChordComponents(quality, seventh, None, None), bass)
            return ParseResult(raw, NOTATION, "partial", chord, ("Unexpanded alt shorthand",))

        # Remaining strings concatenate extensions and postfix accidentals:
        # 69, 79b, 7911#, 7913b, 79b13, 79#11#, etc.
        while body:
            token = None
            for candidate in ("13", "11", "9", "6"):
                if body.startswith(candidate):
                    token = candidate
                    body = body[len(candidate):]
                    break
            if token is None:
                unsupported.append(body)
                break
            number = int(token)
            accidental = ""
            if body.startswith(("b", "#")):
                accidental, body = body[0], body[1:]
            if accidental:
                alteration = accidental + token
                if alteration in {"b9", "#9", "#11", "b13"}:
                    alterations.add(alteration)
                    extensions.add(number)
                else:
                    unsupported.append(alteration)
            else:
                extensions.add(number)
        components = ChordComponents(
            quality, seventh, tuple(extensions), tuple(alterations)
        )
        chord = SymbolicChord(root, components, bass)
        if unsupported:
            return ParseResult(
                raw, NOTATION, "partial", chord,
                ("Unsupported Weimar suffix: " + ", ".join(unsupported),),
            )
        return ParseResult(raw, NOTATION, "ok", chord)


def _parse_key(text: str) -> Optional[KeyAnnotation]:
    match = re.fullmatch(r"([A-G](?:b|#)?)-(maj|min)", (text or "").strip())
    if not match:
        return None
    return KeyAnnotation(
        Key(parse_pitch(match[1]), "major" if match[2] == "maj" else "minor"),
        "annotated",
    )


def _meter(text: str, current: Tuple[int, int]) -> Tuple[int, int]:
    if not text:
        return current
    match = re.fullmatch(r"(\d+)/(\d+)", text)
    if not match:
        return current
    return int(match[1]), int(match[2])


def _database_path(raw_root: Path) -> Path:
    for path in (
        raw_root,
        raw_root / "wjazzd.db",
        raw_root / "2.1" / "wjazzd.db",
        raw_root / "weimar_jazz_database" / "2.1" / "wjazzd.db",
    ):
        if path.is_file():
            return path
    raise ValueError(f"Could not find wjazzd.db below {raw_root}")


def convert_dataset(raw_root: Path) -> List[ConvertedSong]:
    path = _database_path(raw_root)
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        info = {
            row["melid"]: row for row in connection.execute(
                """
                SELECT s.*, c.title AS composition_title, c.composer,
                       t.filename_track, r.recordtitle, r.artist
                FROM solo_info s
                JOIN composition_info c ON c.compid = s.compid
                LEFT JOIN track_info t ON t.trackid = s.trackid
                LEFT JOIN record_info r ON r.recordid = s.recordid
                ORDER BY s.melid
                """
            )
        }
        beat_rows: Dict[int, list] = defaultdict(list)
        for row in connection.execute(
            "SELECT beatid, melid, onset, bar, beat, signature, chord, form, chorus_id "
            "FROM beats ORDER BY melid, beatid"
        ):
            beat_rows[row["melid"]].append(row)
    finally:
        connection.close()

    parser = WeimarChordParser()
    source = provenance("weimar_jazz_database", ADAPTER_VERSION)
    converted = []
    for melid, row in sorted(info.items()):
        rows = beat_rows.get(melid, [])
        key = _parse_key(row["key"])
        meter = (4, 4)
        chord_positions = [index for index, beat in enumerate(rows) if (beat["chord"] or "").strip()]
        events = []
        boundaries = []
        for event_index, position in enumerate(chord_positions):
            beat = rows[position]
            meter = _meter(beat["signature"], meter)
            next_position = chord_positions[event_index + 1] if event_index + 1 < len(chord_positions) else len(rows)
            duration = float(max(1, next_position - position)) * 4 / meter[1]
            reference = f"weimar:melid:{melid}:beatid:{beat['beatid']}"
            parsed = parser.parse(beat["chord"])
            event = normalize(
                parsed,
                global_key=key,
                style="jazz",
                context=EventContext(
                    duration=duration,
                    beat_position=max(0, float((beat["beat"] or 1) - 1)),
                    bar_position=max(0, int(beat["bar"] or 0)),
                    meter=meter,
                    section=beat["form"] or None,
                ),
                source_reference=reference,
            )
            events.append(event)
            if parsed.status in {"failure", "no_chord"}:
                boundaries.append(Boundary(len(events) - 1, reference, parsed.status))
        title = row["composition_title"] or row["title"] or f"composition {row['compid']}"
        creator = row["composer"] or ""
        song = Song(
            f"weimar-solo-{melid}",
            f"weimar-composition-{row['compid']}",
            source,
            tuple(events),
        )
        converted.append(ConvertedSong(
            song, title, creator, "weimar",
            tuple(boundaries),
            {
                "melid": melid,
                "compid": row["compid"],
                "trackid": row["trackid"],
                "recordid": row["recordid"],
                "performer": row["performer"],
                "instrument": row["instrument"],
                "record_title": row["recordtitle"],
                "record_artist": row["artist"],
                "filename_track": row["filename_track"],
                "source_key": row["key"],
            },
        ))
    return converted
