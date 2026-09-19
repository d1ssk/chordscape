"""ChoCo v1.0.0 JAMS adapter.

The release aggregates upstream corpora.  The source partition and annotation
metadata remain in every converted record so copies are never mistaken for an
independent corpus.
"""
from __future__ import annotations

import json
from pathlib import Path
import re
from typing import List, Optional
import zipfile

from .conversion import Boundary, ConvertedSong, provenance, stable_id
from .mcgill_billboard import McGillChordParser, _pitch_from_interval
from .normalize import normalize
from .parser import parse_key
from .parser import parse_pitch
from .schema import (
    ChordComponents, EventContext, KeyAnnotation, ParseResult, Song, SymbolicChord,
)


ADAPTER_VERSION = "choco-v1"
DEFAULT_SEED = "chordscape-choco-split-v1"
NOTATION = "choco-harte-v1"
SOURCE_NOTES = (
    "ChoCo aggregates upstream corpora; overlap_source metadata must be honored before combined training.",
    "All chord/chord_harte annotation views are emitted; alternative views share one work ID and must not be counted as independent works.",
    "Audio JAMS times are seconds, so schema-v1 quarter-note duration is left unknown for audio records.",
    "Unclassified source partitions retain style=None and are excluded from style-conditioned training.",
)

_POP = {
    "billboard", "isophonics", "rock-corpus", "uspop2002", "rwc-pop",
    "robbie-williams", "casd",
}
_JAZZ = {"real-book", "ireal-pro", "weimar", "jaah", "jazz-corpus"}
_CLASSICAL = {
    "when-in-rome", "schubert-winterreise-audio", "schubert-winterreise-score",
    "mozart-piano-sonatas",
}


class ChocoChordParser:
    def __init__(self) -> None:
        self._harte = McGillChordParser()

    def parse(self, raw: str) -> ParseResult:
        text = raw.strip()
        if text in {"N", "NC"}:
            return ParseResult(raw, NOTATION, "no_chord", None)
        if text == "X":
            return ParseResult(raw, NOTATION, "failure", None, ("Source chord is unanalysed",))
        # A few upstream partitions use bare roots although the JAMS namespace
        # says chord_harte.
        bare = re.fullmatch(r"([A-G](?:#+|b+)?)(/[#b]*\d+)?", text)
        if bare:
            text = bare[1] + ":maj" + (bare[2] or "")
        match = re.fullmatch(
            r"(?P<root>[A-G](?:#+|b+)?):(?P<body>.+?)(?:/(?P<bass>[#b]*\d+))?", text
        )
        if not match:
            return ParseResult(raw, NOTATION, "failure", None, ("Malformed ChoCo Harte chord",))
        if match["body"] == "hdim" or match["body"].startswith("hdim("):
            root = parse_pitch(match["root"])
            bass = _pitch_from_interval(root, match["bass"]) if match["bass"] else None
            extensions = (9,) if "9" in match["body"] else ()
            chord = SymbolicChord(
                root, ChordComponents("diminished", "minor7", extensions, ()), bass
            )
            return ParseResult(raw, NOTATION, "ok", chord)
        if not (match["body"].startswith("(") and match["body"].endswith(")")):
            parsed = self._harte.parse(text)
            return ParseResult(raw, NOTATION, parsed.status, parsed.chord, parsed.diagnostics)
        root = parse_pitch(match["root"])
        bass = _pitch_from_interval(root, match["bass"]) if match["bass"] else None
        tokens = [token.strip() for token in match["body"][1:-1].split(",") if token.strip()]
        present = set(tokens)
        omissions = sorted(token for token in present if token.startswith("*"))
        unsupported = sorted(
            token for token in present
            if token not in {
                "1", "2", "3", "4", "5", "6", "7", "9", "11", "13",
                "b3", "b5", "#5", "b7", "bb7", "b9", "#9", "#11", "b13",
                "*1", "*3", "*5", "*7", "*9", "*11", "*13",
            }
        )
        if "b3" in present and "b5" in present:
            quality = "diminished"
        elif "b3" in present:
            quality = "minor"
        elif "4" in present and "3" not in present:
            quality = "sus4"
        elif "2" in present and "3" not in present:
            quality = "sus2"
        elif "3" in present:
            quality = "major"
        elif "5" in present and "*3" in present:
            quality = "power"
        else:
            quality = "other"
            unsupported.append("triad quality not recoverable from explicit degrees")
        if "bb7" in present:
            seventh = "diminished7"
        elif "b7" in present:
            seventh = "minor7"
        elif "7" in present:
            seventh = "major7"
        else:
            seventh = "none"
        extensions = {int(token) for token in present if token in {"6", "9", "11", "13"}}
        alterations = {token for token in present if token in {"b5", "#5", "b9", "#9", "#11", "b13"}}
        # b5 defines a diminished triad when paired with b3; otherwise it is
        # an explicit alteration. #5 remains an alteration because this source
        # did not use the augmented shorthand.
        if quality == "diminished":
            alterations.discard("b5")
        for alteration in alterations:
            number = int(alteration[1:])
            if number != 5:
                extensions.add(number)
        chord = SymbolicChord(
            root,
            ChordComponents(quality, seventh, tuple(extensions), tuple(alterations)),
            bass,
        )
        diagnostics = omissions + unsupported
        if diagnostics:
            return ParseResult(raw, NOTATION, "partial", chord, tuple(diagnostics))
        return ParseResult(raw, NOTATION, "ok", chord)


def _archive(raw_root: Path) -> Path:
    candidates = [raw_root] if raw_root.is_file() else list(raw_root.rglob("v1.0.0.zip"))
    if len(candidates) != 1 or not candidates[0].is_file():
        raise ValueError(f"Expected exactly one ChoCo v1.0.0.zip below {raw_root}")
    return candidates[0]


def _partition(member: str) -> str:
    stem = Path(member).stem
    return re.sub(r"_\d+$", "", stem)


def _style(partition: str, document: dict) -> Optional[str]:
    if partition in _POP:
        return "pop"
    if partition in _JAZZ:
        return "jazz"
    if partition in _CLASSICAL:
        return "classical"
    genre = str(document.get("sandbox", {}).get("genre") or "").casefold()
    if "jazz" in genre:
        return "jazz"
    return None


def _key(value: object, reference: str) -> Optional[KeyAnnotation]:
    if not isinstance(value, str):
        return None
    try:
        key = parse_key(value)
    except ValueError:
        return None
    return KeyAnnotation(key, "annotated", reference)


def _active_key(annotations: list, time: float):
    candidates = []
    for index, item in enumerate(annotations):
        try:
            start = float(item["time"])
            duration = float(item["duration"])
        except (KeyError, TypeError, ValueError):
            continue
        if start <= time < start + max(duration, 0) + 1e-9:
            annotation = _key(item.get("value"), f"{ADAPTER_VERSION}: key_mode:{index}")
            if annotation:
                candidates.append((start, -duration, index, annotation))
    return max(candidates)[3] if candidates else None


def _score_position(time: object):
    try:
        text = str(time)
        measure_text, beat_text = text.split(".", 1)
        measure = int(measure_text)
        beat = int(beat_text.rstrip("0") or "0")
        return max(0, measure - 1), max(0.0, float(beat - 1))
    except (TypeError, ValueError):
        return None, None


def convert_dataset(raw_root: Path) -> List[ConvertedSong]:
    archive = _archive(raw_root)
    parser = ChocoChordParser()
    source = provenance("choco", ADAPTER_VERSION)
    converted = []
    with zipfile.ZipFile(archive) as bundle:
        members = sorted(
            name for name in bundle.namelist()
            if name.startswith("v1.0.0/jams/") and name.endswith(".jams")
        )
        for member in members:
            document = json.loads(bundle.read(member))
            partition = _partition(member)
            annotations = document.get("annotations") or []
            chord_annotations = [
                item for item in annotations
                if item.get("namespace") in {"chord", "chord_harte"}
            ] or [None]
            key_annotations = [
                item for item in annotations if item.get("namespace") == "key_mode"
            ]
            file_metadata = document.get("file_metadata") or {}
            sandbox = document.get("sandbox") or {}
            source_type = sandbox.get("type") or "unknown"
            style = _style(partition, document)
            title = str(file_metadata.get("title") or Path(member).stem).strip()
            composers = sandbox.get("composers") or []
            performers = sandbox.get("performers") or []
            creator = "; ".join(str(value).strip() for value in composers if str(value).strip())
            if not creator:
                creator = "; ".join(str(value).strip() for value in performers if str(value).strip())
            identifiers = file_metadata.get("identifiers") or {}
            identity_detail = json.dumps(identifiers, sort_keys=True) if identifiers else title
            work = stable_id("choco-work", partition, identity_detail, creator)
            for view_index, chord_annotation in enumerate(chord_annotations):
                key_annotation = (
                    key_annotations[min(view_index, len(key_annotations) - 1)]
                    if key_annotations else None
                )
                chord_data = chord_annotation.get("data", []) if chord_annotation else []
                key_data = key_annotation.get("data", []) if key_annotation else []
                first_valid_key = None
                for index, item in enumerate(key_data):
                    first_valid_key = _key(
                        item.get("value"), f"{ADAPTER_VERSION}: initial key_mode:{index}"
                    )
                    if first_valid_key:
                        break
                events = []
                boundaries = []
                namespace = chord_annotation.get("namespace", "missing") if chord_annotation else "missing"
                for event_index, item in enumerate(chord_data):
                    raw = str(item.get("value", ""))
                    parsed = parser.parse(raw)
                    try:
                        time = float(item.get("time"))
                    except (TypeError, ValueError):
                        time = float(event_index)
                    active_key = _active_key(key_data, time)
                    local_key = (
                        active_key
                        if active_key and (
                            first_valid_key is None or active_key.key != first_valid_key.key
                        )
                        else None
                    )
                    bar, beat = (
                        _score_position(item.get("time"))
                        if source_type == "score" else (None, None)
                    )
                    duration = None
                    if source_type == "score":
                        try:
                            duration = float(item.get("duration"))
                            if duration <= 0:
                                duration = None
                        except (TypeError, ValueError):
                            duration = None
                    reference = f"choco:{Path(member).stem}:{namespace}:{view_index}:{event_index}"
                    events.append(normalize(
                        parsed,
                        global_key=first_valid_key,
                        local_key=local_key,
                        style=style,
                        context=EventContext(duration, beat, bar),
                        source_reference=reference,
                    ))
                    if parsed.status in {"failure", "no_chord"}:
                        boundaries.append(Boundary(len(events) - 1, reference, parsed.status))
                view_suffix = f"-view-{view_index}" if len(chord_annotations) > 1 else ""
                song = Song(
                    f"choco-{Path(member).stem}{view_suffix}", work, source, tuple(events)
                )
                converted.append(ConvertedSong(
                    song, title, creator, partition, tuple(boundaries),
                    {
                        "choco_id": Path(member).stem,
                        "annotation_view": view_index,
                        "annotation_views_in_file": len(chord_annotations),
                        "source_namespace": namespace,
                        "source_type": source_type,
                        "genre": sandbox.get("genre"),
                        "identifiers": identifiers,
                        "annotation_metadata": chord_annotation.get("annotation_metadata", {}) if chord_annotation else {},
                        "key_annotation_metadata": key_annotation.get("annotation_metadata", {}) if key_annotation else {},
                        "overlap_source": partition in {
                            "billboard", "weimar", "when-in-rome", "mozart-piano-sonatas",
                        },
                        "time_note": "audio times/durations retained only in source JAMS; schema duration is quarter-note units",
                    },
                ))
    if len(members) != 20086:
        raise ValueError(f"Expected 20,086 ChoCo JAMS, found {len(members)}")
    return converted
