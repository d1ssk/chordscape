"""McGill Billboard 2.0 adapter.

The source combines SALAMI structure with Harte chord labels.  This module
keeps those dataset-specific rules out of the small ``plain-v1`` parser.
"""
from __future__ import annotations

import csv
from dataclasses import asdict, dataclass
import hashlib
import json
from pathlib import Path
import re
import unicodedata
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from .dataset_catalog import load_catalog
from .normalize import normalize
from .parser import parse_pitch
from .schema import (
    ChordComponents,
    ChordEvent,
    EventContext,
    Key,
    KeyAnnotation,
    ParseResult,
    Pitch,
    Provenance,
    Song,
    SymbolicChord,
)

NOTATION = "mcgill-billboard-harte-v1"
ADAPTER_VERSION = "mcgill-billboard-v1"
DEFAULT_SEED = "chordscape-mcgill-split-v1"
DEFAULT_CANDIDATE_MANIFEST = (
    Path(__file__).resolve().parents[1] / "datasets" / "chordscape_candidates.v1.json"
)
CHORD_PATTERN = re.compile(
    r"^(?P<root>[A-G](?:#+|b+)?):(?P<body>[^/]+?)(?:/(?P<bass>[#b]*\d+))?$"
)
METER_PATTERN = re.compile(r"^(\d+)/(\d+)$")


@dataclass(frozen=True)
class Boundary:
    # The boundary occurs immediately before this zero-based event index.
    event_index: int
    source_reference: str
    reason: str


@dataclass(frozen=True)
class KeyHint:
    tonic: Optional[Pitch]
    line_number: int
    inferred_mode: Optional[str]
    evidence: Optional[str]


@dataclass(frozen=True)
class ConvertedBillboardSong:
    song: Song
    title: str
    artist: str
    chart_slot: int
    boundaries: Tuple[Boundary, ...]
    key_hints: Tuple[KeyHint, ...]


@dataclass
class _DraftEvent:
    parsed: ParseResult
    context: EventContext
    source_reference: str
    tonic_region: int


@dataclass
class _TonicRegion:
    tonic: Optional[Pitch]
    line_number: int
    mode: Optional[str] = None
    evidence: Optional[str] = None


class McGillChordParser:
    """Parse the Harte dialect used by McGill Billboard."""

    _BASES = {
        "maj": ("major", "none", ()),
        "min": ("minor", "none", ()),
        "7": ("major", "minor7", ()),
        "maj7": ("major", "major7", ()),
        "min7": ("minor", "minor7", ()),
        "minmaj7": ("minor", "major7", ()),
        "dim": ("diminished", "none", ()),
        "dim7": ("diminished", "diminished7", ()),
        "hdim7": ("diminished", "minor7", ()),
        "aug": ("augmented", "none", ()),
        "sus2": ("sus2", "none", ()),
        "sus4": ("sus4", "none", ()),
        "1": ("no3", "none", ()),
        "5": ("power", "none", ()),
        "maj6": ("major", "none", (6,)),
        "min6": ("minor", "none", (6,)),
        "9": ("major", "minor7", (9,)),
        "maj9": ("major", "major7", (9,)),
        "min9": ("minor", "minor7", (9,)),
        "11": ("major", "minor7", (11,)),
        "maj11": ("major", "major7", (11,)),
        "min11": ("minor", "minor7", (11,)),
        "13": ("major", "minor7", (13,)),
        "maj13": ("major", "major7", (13,)),
        "min13": ("minor", "minor7", (13,)),
    }

    def parse(self, raw: str) -> ParseResult:
        text = raw.strip()
        if text == "N" or text == "&pause":
            return ParseResult(raw, NOTATION, "no_chord", None)
        if text == "*":
            return ParseResult(
                raw, NOTATION, "failure", None,
                ("Source marks this bar as too elaborate for beat-level analysis",),
            )
        match = CHORD_PATTERN.fullmatch(text)
        if not match:
            return ParseResult(raw, NOTATION, "failure", None, ("Malformed Harte chord",))
        try:
            root = parse_pitch(match["root"])
            bass = _pitch_from_interval(root, match["bass"]) if match["bass"] else None
        except ValueError as error:
            return ParseResult(raw, NOTATION, "failure", None, (str(error),))

        body = match["body"]
        base_match = re.fullmatch(r"([^()]*)((?:\([^()]*\))?)", body)
        if not base_match or base_match[1] not in self._BASES:
            chord = SymbolicChord(root, ChordComponents("other", None, None, None), bass)
            return ParseResult(
                raw, NOTATION, "partial", chord,
                (f"Unsupported McGill shorthand: {body!r}",),
            )
        quality, seventh, initial_extensions = self._BASES[base_match[1]]
        extensions = set(initial_extensions)
        alterations = set()
        unsupported = []
        modifiers = base_match[2]
        if modifiers:
            contents = modifiers[1:-1]
            if not contents:
                unsupported.append("empty modifier")
            for modifier in contents.split(","):
                if modifier == "b7":
                    if seventh not in {"none", "minor7"}:
                        unsupported.append(f"b7 alongside {seventh}")
                    else:
                        seventh = "minor7"
                elif modifier == "7":
                    if seventh not in {"none", "major7"}:
                        unsupported.append(f"7 alongside {seventh}")
                    else:
                        seventh = "major7"
                elif modifier in {"6", "9", "11", "13"}:
                    extensions.add(int(modifier))
                elif modifier in {"b5", "#5", "b9", "#9", "#11", "b13"}:
                    alterations.add(modifier)
                    number = int(modifier[1:])
                    if number != 5:
                        extensions.add(number)
                elif modifier in {"1", "3", "5"}:
                    # Explicit chord members add no information to schema v1.
                    pass
                else:
                    unsupported.append(modifier)
        components = ChordComponents(
            quality, seventh, tuple(extensions), tuple(alterations)
        )
        chord = SymbolicChord(root, components, bass)
        if unsupported:
            return ParseResult(
                raw, NOTATION, "partial", chord,
                ("Unrepresentable explicit degrees: " + ", ".join(unsupported),),
            )
        return ParseResult(raw, NOTATION, "ok", chord)


def _pitch_from_interval(root: Pitch, interval: str) -> Pitch:
    match = re.fullmatch(r"([#b]*)(\d+)", interval)
    if not match:
        raise ValueError(f"Invalid Harte bass degree: {interval!r}")
    number = int(match[2])
    if number < 1:
        raise ValueError(f"Invalid Harte bass degree: {interval!r}")
    degree = (number - 1) % 7
    letters = "CDEFGAB"
    naturals = (0, 2, 4, 5, 7, 9, 11)
    target_letter_index = (letters.index(root.letter) + degree) % 7
    target_pc = (
        root.pitch_class
        + (0, 2, 4, 5, 7, 9, 11)[degree]
        + match[1].count("#")
        - match[1].count("b")
    ) % 12
    natural_pc = naturals[target_letter_index]
    accidental = (target_pc - natural_pc) % 12
    if accidental > 6:
        accidental -= 12
    return Pitch(letters[target_letter_index], accidental)


def parse_meter(text: str) -> Tuple[int, int]:
    match = METER_PATTERN.fullmatch(text.strip())
    if not match:
        raise ValueError(f"Invalid metre: {text!r}")
    meter = int(match[1]), int(match[2])
    if meter[0] <= 0 or meter[1] <= 0:
        raise ValueError(f"Invalid metre: {text!r}")
    return meter


def _bar_quarters(meter: Tuple[int, int]) -> float:
    return meter[0] * 4 / meter[1]


def _pulse_count(meter: Tuple[int, int]) -> int:
    numerator, denominator = meter
    if denominator == 8 and numerator >= 6 and numerator % 3 == 0:
        return numerator // 3
    return numerator


def _slot_duration(meter: Tuple[int, int], token_count: int) -> float:
    if token_count == 1:
        return _bar_quarters(meter)
    if token_count == 2 and _pulse_count(meter) == 4:
        return _bar_quarters(meter) / 2
    return _bar_quarters(meter) / token_count


def _canonical_identity(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text).casefold()
    return " ".join(re.findall(r"[a-z0-9]+", decomposed))


def work_id(title: str, artist: str) -> str:
    identity = _canonical_identity(title) + "\x1f" + _canonical_identity(artist)
    digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:16]
    return f"mcgill-work-{digest}"


def _provenance() -> Provenance:
    dataset = next(
        item for item in load_catalog()["datasets"] if item["id"] == "mcgill_billboard"
    )
    return Provenance(
        dataset["source"], dataset["version"], dataset["url"],
        dataset["license"]["name"], dataset["acquisition"]["download_date"],
        dataset["conversion_notes"] + f" Adapter: {ADAPTER_VERSION}.",
    )


def _parse_headers(lines: Sequence[str]) -> Dict[str, str]:
    result = {}
    for line in lines:
        match = re.match(r"#\s*(title|artist|metre|tonic):\s*(.*?)\s*$", line)
        if match and match[1] not in result:
            result[match[1]] = match[2]
    return result


def _parse_tonic(text: str) -> Optional[Pitch]:
    if text.strip() == "?":
        return None
    return parse_pitch(text.strip())


def _mode_for_region(region: _TonicRegion, drafts: Iterable[_DraftEvent]) -> None:
    if region.tonic is None:
        return
    for draft in drafts:
        chord = draft.parsed.chord
        if not chord or chord.root.pitch_class != region.tonic.pitch_class:
            continue
        quality = chord.components.quality
        if quality == "minor":
            region.mode = "minor"
        elif quality in {"major", "augmented", "sus2", "sus4", "power", "no3"}:
            region.mode = "major"
        else:
            continue
        region.evidence = (
            f"{ADAPTER_VERSION}: annotated tonic {region.tonic.letter}"
            f"{_accidental_text(region.tonic.accidental)}; mode inferred from "
            f"{draft.parsed.raw_chord} at {draft.source_reference}"
        )
        return


def _accidental_text(accidental: int) -> str:
    return "#" * accidental if accidental >= 0 else "b" * -accidental


def _section_update(prefix: str, phrase: Optional[str], section: Optional[str]):
    items = [item.strip() for item in prefix.split(",") if item.strip()]
    if items and re.fullmatch(r"[A-Z]'*", items[0]):
        phrase = items.pop(0)
    if items:
        candidate = items[0]
        if not candidate.startswith("(") and not candidate.endswith(")"):
            section = candidate
    return phrase, section


def convert_chart(path: Path, *, chart_slot: Optional[int] = None) -> ConvertedBillboardSong:
    lines = path.read_text(encoding="utf-8").splitlines()
    headers = _parse_headers(lines)
    missing = {"title", "artist", "metre", "tonic"} - headers.keys()
    if missing:
        raise ValueError(f"{path}: missing headers: {', '.join(sorted(missing))}")
    if not headers["title"] or not headers["artist"]:
        raise ValueError(f"{path}: title and artist must be non-empty")
    slot = chart_slot if chart_slot is not None else int(path.parent.name)
    meter = parse_meter(headers["metre"])
    regions = [_TonicRegion(_parse_tonic(headers["tonic"]), 1)]
    current_region = 0
    phrase = None
    section = None
    bar_position = 0
    drafts: List[_DraftEvent] = []
    boundaries: List[Boundary] = []
    chord_parser = McGillChordParser()

    for line_number, line in enumerate(lines, 1):
        comment = re.match(r"#\s*(metre|tonic):\s*(.*?)\s*$", line)
        if comment:
            if line_number <= 5:
                continue
            if comment[1] == "metre":
                meter = parse_meter(comment[2])
            else:
                regions.append(_TonicRegion(_parse_tonic(comment[2]), line_number))
                current_region = len(regions) - 1
            continue
        if not line or line.startswith("#"):
            continue
        body_match = re.match(r"([^\t]+)\t(.*)$", line)
        if not body_match:
            boundaries.append(Boundary(
                len(drafts), f"mcgill:{slot}:line:{line_number}", "malformed_line"
            ))
            continue
        try:
            float(body_match[1])
        except ValueError:
            boundaries.append(Boundary(
                len(drafts), f"mcgill:{slot}:line:{line_number}", "invalid_timestamp"
            ))
            continue
        body = body_match[2].strip()
        if "|" not in body:
            reason = "silence" if body == "silence" else "end" if body == "end" else "non_musical"
            boundaries.append(Boundary(
                len(drafts), f"mcgill:{slot}:line:{line_number}", reason
            ))
            continue
        prefix = body.split("|", 1)[0].strip().rstrip(",")
        phrase, section = _section_update(prefix, phrase, section)
        pipe_parts = body.split("|")
        bars = pipe_parts[1:-1]
        suffix = pipe_parts[-1]
        repeat_match = re.search(r"\bx(\d+)\b", suffix)
        repeats = int(repeat_match[1]) if repeat_match else 1
        if repeats < 1 or repeats > 64:
            boundaries.append(Boundary(
                len(drafts), f"mcgill:{slot}:line:{line_number}", "invalid_repeat"
            ))
            repeats = 1
        for repeat_index in range(repeats):
            for bar_index, raw_bar in enumerate(bars):
                bar = raw_bar.strip()
                inline_meter = re.match(r"^\((\d+/\d+)\)\s*(.*)$", bar)
                bar_meter = parse_meter(inline_meter[1]) if inline_meter else meter
                if inline_meter:
                    bar = inline_meter[2]
                tokens = bar.split()
                if not tokens:
                    boundaries.append(Boundary(
                        len(drafts),
                        f"mcgill:{slot}:line:{line_number}:bar:{bar_index}:repeat:{repeat_index}",
                        "empty_bar",
                    ))
                    bar_position += 1
                    continue
                slot_duration = _slot_duration(bar_meter, len(tokens))
                beat = 0.0
                previous: Optional[_DraftEvent] = None
                for token_index, token in enumerate(tokens):
                    if token == ".":
                        if previous is None:
                            boundaries.append(Boundary(
                                len(drafts),
                                f"mcgill:{slot}:line:{line_number}:bar:{bar_index}:token:{token_index}",
                                "orphan_repeat_dot",
                            ))
                        else:
                            context = previous.context
                            previous.context = EventContext(
                                context.duration + slot_duration,
                                context.beat_position,
                                context.bar_position,
                                context.meter,
                                context.phrase,
                                context.section,
                            )
                        beat += slot_duration
                        continue
                    reference = (
                        f"mcgill:{slot}:line:{line_number}:bar:{bar_index}:"
                        f"token:{token_index}:repeat:{repeat_index}"
                    )
                    parsed = chord_parser.parse(token)
                    draft = _DraftEvent(
                        parsed,
                        EventContext(slot_duration, beat, bar_position, bar_meter, phrase, section),
                        reference,
                        current_region,
                    )
                    drafts.append(draft)
                    previous = draft
                    if parsed.status in {"failure", "no_chord"}:
                        boundaries.append(Boundary(len(drafts) - 1, reference, parsed.status))
                    beat += slot_duration
                bar_position += 1

    for index, region in enumerate(regions):
        _mode_for_region(region, (draft for draft in drafts if draft.tonic_region == index))
    annotations: List[Optional[KeyAnnotation]] = []
    for region in regions:
        annotations.append(
            KeyAnnotation(Key(region.tonic, region.mode), "estimated", region.evidence)
            if region.tonic is not None and region.mode is not None and region.evidence
            else None
        )
    global_key = annotations[0]
    events: List[ChordEvent] = []
    for draft in drafts:
        local_key = annotations[draft.tonic_region] if draft.tonic_region > 0 else None
        events.append(normalize(
            draft.parsed,
            global_key=global_key,
            local_key=local_key,
            style="pop",
            context=draft.context,
            source_reference=draft.source_reference,
        ))
    song = Song(
        f"mcgill-{slot:04d}", work_id(headers["title"], headers["artist"]),
        _provenance(), tuple(events),
    )
    hints = tuple(KeyHint(region.tonic, region.line_number, region.mode, region.evidence) for region in regions)
    return ConvertedBillboardSong(
        song, headers["title"], headers["artist"], slot, tuple(boundaries), hints
    )


def find_dataset_paths(raw_root: Path) -> Tuple[Path, Path]:
    candidates = [
        raw_root,
        raw_root / "2.0",
        raw_root / "mcgill_billboard" / "2.0",
    ]
    for base in candidates:
        charts = base / "McGill-Billboard"
        index = base / "billboard-2.0-index.csv"
        if charts.is_dir() and index.is_file():
            return charts, index
    raise ValueError(f"Could not find McGill Billboard 2.0 below {raw_root}")


def convert_dataset(raw_root: Path) -> List[ConvertedBillboardSong]:
    charts, index_path = find_dataset_paths(raw_root)
    with index_path.open(encoding="utf-8", newline="") as handle:
        index = {int(row["id"]): row for row in csv.DictReader(handle)}
    converted = []
    for path in sorted(charts.glob("*/salami_chords.txt")):
        slot = int(path.parent.name)
        item = convert_chart(path, chart_slot=slot)
        row = index.get(slot)
        if not row or not row.get("title"):
            raise ValueError(f"Chart slot {slot} is missing from the version 2.0 index")
        converted.append(item)
    return converted


def assign_splits(
    songs: Sequence[ConvertedBillboardSong], seed: str = DEFAULT_SEED
) -> Dict[str, str]:
    assignments = {}
    for item in songs:
        identity = f"{seed}\x1f{item.song.work_id}".encode("utf-8")
        bucket = int(hashlib.sha256(identity).hexdigest()[:16], 16) / 16 ** 16
        assignments[item.song.work_id] = (
            "train" if bucket < 0.8 else "validation" if bucket < 0.9 else "test"
        )
    return assignments


def build_split_manifest(
    songs: Sequence[ConvertedBillboardSong], seed: str = DEFAULT_SEED
) -> dict:
    assignments = assign_splits(songs, seed)
    works = {}
    for item in songs:
        entry = works.setdefault(item.song.work_id, {
            "split": assignments[item.song.work_id],
            "title": item.title,
            "artist": item.artist,
            "song_ids": [],
        })
        entry["song_ids"].append(item.song.song_id)
    split_summary = {
        name: {
            "works": sum(1 for entry in works.values() if entry["split"] == name),
            "songs": sum(
                len(entry["song_ids"])
                for entry in works.values()
                if entry["split"] == name
            ),
        }
        for name in ("train", "validation", "test")
    }
    return {
        "schema_version": 1,
        "dataset": "mcgill_billboard",
        "dataset_version": "2.0",
        "adapter_version": ADAPTER_VERSION,
        "seed": seed,
        "summary": split_summary,
        "works": dict(sorted(works.items())),
    }


def _load_candidate_signatures(path: Optional[Path]) -> Tuple[set, set, Optional[dict]]:
    if path is None:
        return set(), set(), None
    manifest = json.loads(path.read_text(encoding="utf-8"))
    harmony, full = set(), set()
    for node in manifest["nodes"]:
        if isinstance(node, list):
            _, degree, accidental, quality, seventh, extensions, alterations, bass = node
            signature = (
                degree, accidental, quality, seventh,
                tuple(extensions), tuple(alterations),
            )
        else:
            # Kept for third-party diagnostic manifests using the verbose form.
            factors = node["factors"]
            signature = (
                factors["root"]["degree"], factors["root"]["accidental"],
                factors["quality"], factors["seventh"],
                tuple(factors["extensions"]), tuple(factors["alterations"]),
            )
            bass = factors.get("bass")
        harmony.add(signature)
        if isinstance(bass, list):
            bass_signature = tuple(bass)
        elif bass:
            bass_signature = (bass["degree"], bass["accidental"])
        else:
            bass_signature = (None, None)
        full.add(signature + bass_signature)
    return harmony, full, manifest


def build_diagnostics(
    songs: Sequence[ConvertedBillboardSong], candidate_manifest: Optional[Path] = None,
    *, seed: str = DEFAULT_SEED,
) -> dict:
    from collections import Counter, defaultdict

    statuses = Counter()
    qualities = Counter()
    sevenths = Counter()
    roots = Counter()
    meters = Counter()
    key_basis = Counter()
    diagnostics = Counter()
    examples = defaultdict(list)
    sequence_lengths = []
    complete = harmony_matches = full_matches = 0
    coverage_by_mode = defaultdict(Counter)
    harmony_candidates, full_candidates, manifest = _load_candidate_signatures(candidate_manifest)
    for item in songs:
        current_length = 0
        boundary_indices = {boundary.event_index for boundary in item.boundaries}
        for event_index, event in enumerate(item.song.events):
            if event_index in boundary_indices and current_length:
                sequence_lengths.append(current_length)
                current_length = 0
            statuses[event.parsed.status] += 1
            key_basis[event.key_basis] += 1
            if event.context.meter:
                meters[f"{event.context.meter[0]}/{event.context.meter[1]}"] += 1
            if event.parsed.status in {"failure", "no_chord"}:
                if current_length:
                    sequence_lengths.append(current_length)
                    current_length = 0
            else:
                current_length += 1
            for diagnostic in event.parsed.diagnostics:
                diagnostics[diagnostic] += 1
                if len(examples[diagnostic]) < 5:
                    examples[diagnostic].append({
                        "raw_chord": event.parsed.raw_chord,
                        "source_reference": event.source_reference,
                    })
            factors = event.factors
            if factors is None:
                continue
            qualities[factors.components.quality] += 1
            sevenths[str(factors.components.seventh)] += 1
            if factors.root:
                roots[f"{factors.root.degree}:{factors.root.accidental:+d}"] += 1
            components = factors.components
            if (
                event.parsed.status == "ok" and factors.root is not None
                and components.seventh is not None
                and components.extensions is not None
                and components.alterations is not None
            ):
                complete += 1
                signature = (
                    factors.root.degree, factors.root.accidental, components.quality,
                    components.seventh, components.extensions, components.alterations,
                )
                bass = factors.bass
                if signature in harmony_candidates:
                    harmony_matches += 1
                    harmony_match = True
                else:
                    harmony_match = False
                full_signature = signature + (
                    (bass.degree, bass.accidental) if bass else (None, None)
                )
                if full_signature in full_candidates:
                    full_matches += 1
                    full_match = True
                else:
                    full_match = False
                reference = event.local_key or event.global_key
                mode = reference.key.mode if reference else "missing"
                coverage_by_mode[mode]["complete_events"] += 1
                coverage_by_mode[mode]["harmony_matches"] += int(harmony_match)
                coverage_by_mode[mode]["full_matches"] += int(full_match)
        if current_length:
            sequence_lengths.append(current_length)
    total = sum(statuses.values())
    works = {item.song.work_id for item in songs}
    boundary_total = sum(len(item.boundaries) for item in songs)
    split_manifest = build_split_manifest(songs, seed)
    work_splits = defaultdict(set)
    song_splits = defaultdict(set)
    for item in songs:
        split = split_manifest["works"][item.song.work_id]["split"]
        work_splits[item.song.work_id].add(split)
        song_splits[item.song.song_id].add(split)
    metadata_by_work = defaultdict(set)
    for item in songs:
        metadata_by_work[item.song.work_id].add((item.title, item.artist))
    metadata_variants = [
        {
            "work_id": identifier,
            "variants": [
                {"title": title, "artist": artist}
                for title, artist in sorted(variants)
            ],
        }
        for identifier, variants in sorted(metadata_by_work.items())
        if len(variants) > 1
    ]
    by_mode = {}
    for mode, counts in sorted(coverage_by_mode.items()):
        denominator = counts["complete_events"]
        by_mode[mode] = {
            **counts,
            "harmony_rate": counts["harmony_matches"] / denominator,
            "full_rate": counts["full_matches"] / denominator,
        }
    report = {
        "schema_version": 1,
        "dataset": "mcgill_billboard",
        "dataset_version": "2.0",
        "adapter_version": ADAPTER_VERSION,
        "songs": len(songs),
        "works": len(works),
        "events": total,
        "boundaries": boundary_total,
        "style": {"pop": total},
        "status": dict(statuses),
        "status_rates": {name: count / total for name, count in statuses.items()} if total else {},
        "key_basis": dict(key_basis),
        "sequence_length": {
            "count": len(sequence_lengths),
            "min": min(sequence_lengths, default=0),
            "max": max(sequence_lengths, default=0),
            "mean": sum(sequence_lengths) / len(sequence_lengths) if sequence_lengths else 0,
        },
        "factor_distribution": {
            "root": dict(roots.most_common()),
            "quality": dict(qualities.most_common()),
            "seventh": dict(sevenths.most_common()),
            "meter": dict(meters.most_common()),
        },
        "diagnostics": [
            {"message": message, "count": count, "examples": examples[message]}
            for message, count in diagnostics.most_common()
        ],
        "factor_completeness": {
            "denominator_events": total,
            "missing_relative_root": sum(
                1
                for item in songs
                for event in item.song.events
                if event.factors is not None and event.factors.root is None
            ),
            "partial_factor_events": statuses["partial"],
        },
        "work_grouping": {
            "derived_works": len(works),
            "source_documentation_claim": 740,
            "difference_from_claim": len(works) - 740,
            "identity": "NFKD/casefold/alphanumeric title + artist from chart header",
            "metadata_variant_groups": metadata_variants,
        },
        "split": split_manifest["summary"],
        "split_leakage": {
            "works_in_multiple_splits": sum(
                1 for splits in work_splits.values() if len(splits) > 1
            ),
            "songs_in_multiple_splits": sum(
                1 for splits in song_splits.values() if len(splits) > 1
            ),
        },
        "ui_coverage": {
            "candidate_manifest": (
                manifest.get("source", candidate_manifest.name)
                if manifest and candidate_manifest
                else None
            ),
            "candidate_manifest_version": manifest.get("version") if manifest else None,
            "complete_events": complete,
            "harmony_matches": harmony_matches,
            "harmony_rate": harmony_matches / complete if complete else 0,
            "full_matches": full_matches,
            "full_rate": full_matches / complete if complete else 0,
            "by_key_mode": by_mode,
        },
    }
    return report


def write_conversion(
    songs: Sequence[ConvertedBillboardSong], output_dir: Path, *,
    seed: str = DEFAULT_SEED, candidate_manifest: Optional[Path] = None,
) -> dict:
    output_dir.mkdir(parents=True, exist_ok=True)
    split_manifest = build_split_manifest(songs, seed)
    diagnostics = build_diagnostics(songs, candidate_manifest, seed=seed)
    with (output_dir / "songs.jsonl").open("w", encoding="utf-8") as handle:
        for item in songs:
            record = asdict(item)
            record["split"] = split_manifest["works"][item.song.work_id]["split"]
            handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")
    (output_dir / "split_manifest.json").write_text(
        json.dumps(split_manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    (output_dir / "diagnostics.json").write_text(
        json.dumps(diagnostics, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return diagnostics
