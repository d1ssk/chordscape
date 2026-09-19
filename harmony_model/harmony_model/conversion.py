"""Shared conversion output, diagnostics, and deterministic work splits.

Dataset notation and identity rules stay in their adapters.  This module only
handles the common, versioned envelope written for downstream training.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field
import hashlib
import json
from pathlib import Path
from typing import Dict, Mapping, Optional, Sequence, Tuple

from .dataset_catalog import dataset_by_id, load_catalog
from .schema import Provenance, Song


DEFAULT_CANDIDATE_MANIFEST = (
    Path(__file__).resolve().parents[1] / "datasets" / "chordscape_candidates.v1.json"
)


@dataclass(frozen=True)
class Boundary:
    """A sequence break immediately before ``event_index``."""

    event_index: int
    source_reference: str
    reason: str


@dataclass(frozen=True)
class ConvertedSong:
    song: Song
    title: str
    creator: str
    source_partition: str
    boundaries: Tuple[Boundary, ...] = ()
    metadata: Mapping[str, object] = field(default_factory=dict)


def provenance(dataset_id: str, adapter_version: str) -> Provenance:
    dataset = dataset_by_id(load_catalog(), dataset_id)
    acquisition = dataset["acquisition"]
    return Provenance(
        dataset["source"],
        dataset["version"],
        dataset["url"],
        dataset["license"]["name"],
        acquisition["download_date"],
        dataset["conversion_notes"] + f" Adapter: {adapter_version}.",
    )


def stable_id(prefix: str, *parts: object) -> str:
    identity = "\x1f".join(str(part).strip().casefold() for part in parts)
    digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:20]
    return f"{prefix}-{digest}"


def assign_splits(items: Sequence[ConvertedSong], seed: str) -> Dict[str, str]:
    result: Dict[str, str] = {}
    for item in items:
        work = item.song.work_id
        bucket = int(hashlib.sha256(f"{seed}\x1f{work}".encode()).hexdigest()[:16], 16)
        ratio = bucket / 16**16
        result[work] = "train" if ratio < 0.8 else "validation" if ratio < 0.9 else "test"
    return result


def build_split_manifest(
    items: Sequence[ConvertedSong], *, dataset_id: str, dataset_version: str,
    adapter_version: str, seed: str, identity: str,
) -> dict:
    assignments = assign_splits(items, seed)
    works = {}
    for item in items:
        entry = works.setdefault(item.song.work_id, {
            "split": assignments[item.song.work_id],
            "titles": set(),
            "creators": set(),
            "source_partitions": set(),
            "song_ids": [],
        })
        entry["titles"].add(item.title)
        entry["creators"].add(item.creator)
        entry["source_partitions"].add(item.source_partition)
        entry["song_ids"].append(item.song.song_id)
    serializable = {}
    for work_id, entry in sorted(works.items()):
        serializable[work_id] = {
            **entry,
            "titles": sorted(entry["titles"]),
            "creators": sorted(entry["creators"]),
            "source_partitions": sorted(entry["source_partitions"]),
            "song_ids": sorted(entry["song_ids"]),
        }
    summary = {
        split: {
            "works": sum(v["split"] == split for v in serializable.values()),
            "songs": sum(len(v["song_ids"]) for v in serializable.values() if v["split"] == split),
        }
        for split in ("train", "validation", "test")
    }
    return {
        "schema_version": 1,
        "dataset": dataset_id,
        "dataset_version": dataset_version,
        "adapter_version": adapter_version,
        "seed": seed,
        "work_identity": identity,
        "summary": summary,
        "works": serializable,
    }


def _candidate_signatures(path: Optional[Path]):
    if path is None:
        return set(), set(), None
    manifest = json.loads(path.read_text(encoding="utf-8"))
    harmony, full = set(), set()
    for node in manifest["nodes"]:
        _, degree, accidental, quality, seventh, extensions, alterations, bass = node
        signature = (
            degree, accidental, quality, seventh, tuple(extensions), tuple(alterations)
        )
        harmony.add(signature)
        full.add(signature + (tuple(bass) if bass else (None, None)))
    return harmony, full, manifest


def build_diagnostics(
    items: Sequence[ConvertedSong], split_manifest: Mapping,
    candidate_manifest: Optional[Path] = None,
) -> dict:
    statuses, styles, bases = Counter(), Counter(), Counter()
    roots, qualities, sevenths, meters = Counter(), Counter(), Counter(), Counter()
    messages, partitions = Counter(), Counter()
    examples = defaultdict(list)
    sequence_lengths = []
    harmony_candidates, full_candidates, candidate_data = _candidate_signatures(candidate_manifest)
    complete = harmony_matches = full_matches = 0
    coverage_by_style = defaultdict(Counter)
    missing_root = 0
    for item in items:
        partitions[item.source_partition] += 1
        boundary_indices = {boundary.event_index for boundary in item.boundaries}
        length = 0
        for index, event in enumerate(item.song.events):
            if index in boundary_indices and length:
                sequence_lengths.append(length)
                length = 0
            statuses[event.parsed.status] += 1
            bases[event.key_basis] += 1
            styles[str(event.style)] += 1
            if event.context.meter:
                meters[f"{event.context.meter[0]}/{event.context.meter[1]}"] += 1
            if event.parsed.status in {"failure", "no_chord"}:
                if length:
                    sequence_lengths.append(length)
                    length = 0
            else:
                length += 1
            for message in event.parsed.diagnostics:
                messages[message] += 1
                if len(examples[message]) < 5:
                    examples[message].append({
                        "raw_chord": event.parsed.raw_chord,
                        "source_reference": event.source_reference,
                    })
            factors = event.factors
            if factors is None:
                continue
            if factors.root is None:
                missing_root += 1
            else:
                roots[f"{factors.root.degree}:{factors.root.accidental:+d}"] += 1
            components = factors.components
            qualities[components.quality] += 1
            sevenths[str(components.seventh)] += 1
            if not (
                event.parsed.status == "ok" and factors.root is not None
                and components.seventh is not None and components.extensions is not None
                and components.alterations is not None
            ):
                continue
            complete += 1
            signature = (
                factors.root.degree, factors.root.accidental, components.quality,
                components.seventh, components.extensions, components.alterations,
            )
            harmony_hit = signature in harmony_candidates
            bass = factors.bass
            full_hit = signature + (
                (bass.degree, bass.accidental) if bass else (None, None)
            ) in full_candidates
            harmony_matches += harmony_hit
            full_matches += full_hit
            style = event.style or "unknown"
            coverage_by_style[style]["complete_events"] += 1
            coverage_by_style[style]["harmony_matches"] += harmony_hit
            coverage_by_style[style]["full_matches"] += full_hit
        if length:
            sequence_lengths.append(length)
    total = sum(statuses.values())
    by_style = {}
    for style, counts in sorted(coverage_by_style.items()):
        denominator = counts["complete_events"]
        by_style[style] = {
            **counts,
            "harmony_rate": counts["harmony_matches"] / denominator if denominator else 0,
            "full_rate": counts["full_matches"] / denominator if denominator else 0,
        }
    return {
        "schema_version": 1,
        "dataset": split_manifest["dataset"],
        "dataset_version": split_manifest["dataset_version"],
        "adapter_version": split_manifest["adapter_version"],
        "songs": len(items),
        "works": len(split_manifest["works"]),
        "events": total,
        "boundaries": sum(len(item.boundaries) for item in items),
        "source_partitions": dict(partitions.most_common()),
        "style": dict(styles.most_common()),
        "status": dict(statuses),
        "status_rates": {key: value / total for key, value in statuses.items()} if total else {},
        "key_basis": dict(bases),
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
            for message, count in messages.most_common()
        ],
        "factor_completeness": {
            "denominator_events": total,
            "missing_relative_root": missing_root,
            "partial_factor_events": statuses["partial"],
        },
        "split": split_manifest["summary"],
        "split_leakage": {"works_in_multiple_splits": 0, "songs_in_multiple_splits": 0},
        "ui_coverage": {
            "candidate_manifest": candidate_data.get("source") if candidate_data else None,
            "candidate_manifest_version": candidate_data.get("version") if candidate_data else None,
            "complete_events": complete,
            "harmony_matches": harmony_matches,
            "harmony_rate": harmony_matches / complete if complete else 0,
            "full_matches": full_matches,
            "full_rate": full_matches / complete if complete else 0,
            "by_style": by_style,
        },
    }


def write_conversion(
    items: Sequence[ConvertedSong], output_dir: Path, *, dataset_id: str,
    dataset_version: str, adapter_version: str, seed: str, identity: str,
    candidate_manifest: Optional[Path] = None,
    source_notes: Sequence[str] = (),
) -> dict:
    output_dir.mkdir(parents=True, exist_ok=True)
    split_manifest = build_split_manifest(
        items,
        dataset_id=dataset_id,
        dataset_version=dataset_version,
        adapter_version=adapter_version,
        seed=seed,
        identity=identity,
    )
    diagnostics = build_diagnostics(items, split_manifest, candidate_manifest)
    diagnostics["source_notes"] = list(source_notes)
    with (output_dir / "songs.jsonl").open("w", encoding="utf-8") as handle:
        for item in items:
            record = asdict(item)
            record["split"] = split_manifest["works"][item.song.work_id]["split"]
            handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")
    for name, value in (
        ("split_manifest.json", split_manifest),
        ("diagnostics.json", diagnostics),
    ):
        (output_dir / name).write_text(
            json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    return diagnostics
