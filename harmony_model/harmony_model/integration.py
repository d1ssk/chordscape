"""Cross-corpus work grouping and training-row deduplication.

The integrated corpus is a manifest over the converted JSONL files.  It does
not copy the source events, which keeps provenance intact and avoids another
multi-gigabyte local artifact.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field
import hashlib
import json
import os
from pathlib import Path
import re
import unicodedata
from typing import Dict, Iterable, List, Mapping, Optional, Sequence, Set, Tuple


INTEGRATION_SCHEMA_VERSION = 1
ADAPTER_VERSION = "cross-corpus-integration-v1"
DEFAULT_SEED = "chordscape-integrated-split-v1"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _normalized_text(value: object) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(character for character in text if not unicodedata.combining(character))
    text = re.sub(r"\b(?:1[0-9]{3}|20[0-9]{2})\b", " ", text.casefold())
    return " ".join(re.findall(r"[a-z0-9]+", text))


def _state_signature(event: Mapping) -> Optional[str]:
    parsed = event.get("parsed") or {}
    factors = event.get("factors") or {}
    root = factors.get("root") or {}
    components = factors.get("components") or {}
    if (
        parsed.get("status") != "ok"
        or not root
        or any(components.get(name) is None for name in ("quality", "seventh", "extensions", "alterations"))
    ):
        return None
    try:
        value = [
            int(root["degree"]),
            int(root["accidental"]),
            str(components["quality"]),
            str(components["seventh"]),
            list(components["extensions"]),
            list(components["alterations"]),
        ]
    except (KeyError, TypeError, ValueError):
        return None
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"))


def _sequence_fingerprint(record: Mapping) -> Tuple[Optional[str], int, Counter, Set[str]]:
    song = record["song"]
    events = song.get("events") or []
    boundaries = {
        boundary.get("event_index") for boundary in record.get("boundaries", [])
        if type(boundary.get("event_index")) is int
    }
    digest = hashlib.sha256()
    usable = 0
    statuses = Counter()
    styles: Set[str] = set()
    previous_was_separator = True
    current_style = None
    for index, event in enumerate(events):
        if index in boundaries and not previous_was_separator:
            digest.update(b"|")
            previous_was_separator = True
            current_style = None
        parsed = event.get("parsed") or {}
        statuses[str(parsed.get("status", "missing"))] += 1
        signature = _state_signature(event)
        style = event.get("style")
        if signature is None or not style:
            if not previous_was_separator:
                digest.update(b"|")
            previous_was_separator = True
            current_style = None
            continue
        style = str(style)
        styles.add(style)
        if current_style is not None and style != current_style:
            digest.update(b"|")
        digest.update(style.encode("utf-8"))
        digest.update(b":")
        digest.update(signature.encode("ascii"))
        digest.update(b";")
        previous_was_separator = False
        current_style = style
        usable += 1
    return (digest.hexdigest() if usable else None), usable, statuses, styles


@dataclass
class SourceRecord:
    key: str
    source: str
    song_id: str
    source_work_id: str
    title: str
    creator: str
    source_partition: str
    metadata: Mapping[str, object]
    event_count: int
    usable_events: int
    statuses: Counter
    styles: Set[str]
    sequence_fingerprint: Optional[str]
    selected: bool = True
    exclusion_reason: Optional[str] = None
    canonical_work_id: Optional[str] = None
    split: Optional[str] = None
    matching_evidence: Set[str] = field(default_factory=set)
    rights_review: Optional[Mapping[str, str]] = None

    @property
    def normalized_title(self) -> str:
        return _normalized_text(self.title)

    @property
    def normalized_creator(self) -> str:
        return _normalized_text(self.creator)

    @property
    def choco_id(self) -> Optional[str]:
        value = self.metadata.get("choco_id")
        return str(value) if value is not None else None

    @property
    def annotation_view(self) -> int:
        value = self.metadata.get("annotation_view", 0)
        return int(value) if type(value) is int else 0

    def exclude(self, reason: str) -> None:
        if self.selected:
            self.selected = False
            self.exclusion_reason = reason


class _UnionFind:
    def __init__(self, keys: Iterable[str]) -> None:
        self.parent = {key: key for key in keys}

    def find(self, key: str) -> str:
        parent = self.parent[key]
        if parent != key:
            self.parent[key] = self.find(parent)
        return self.parent[key]

    def union(self, left: str, right: str) -> None:
        left_root = self.find(left)
        right_root = self.find(right)
        if left_root == right_root:
            return
        if left_root < right_root:
            self.parent[right_root] = left_root
        else:
            self.parent[left_root] = right_root


def _union_groups(
    union_find: _UnionFind,
    groups: Mapping[object, Sequence[SourceRecord]],
    evidence: str,
    *,
    cross_scope_only: bool = False,
) -> int:
    merged_groups = 0
    for records in groups.values():
        if len(records) < 2:
            continue
        scopes = {(record.source, record.source_partition) for record in records}
        if cross_scope_only and len(scopes) < 2:
            continue
        first = records[0]
        for record in records[1:]:
            union_find.union(first.key, record.key)
        for record in records:
            record.matching_evidence.add(evidence)
        merged_groups += 1
    return merged_groups


def _source_quality(record: SourceRecord) -> Tuple[int, int, int, int, str]:
    priority = {
        "pop909_cl": 0,
        "when_in_rome": 1,
        "mcgill_billboard": 2,
        "weimar_jazz_database": 2,
        "choco": 3,
        "pop909": 4,
    }.get(record.source, 5)
    return (
        priority,
        -record.usable_events,
        record.statuses.get("partial", 0) + record.statuses.get("failure", 0),
        record.annotation_view,
        record.key,
    )


def _assign_split(work_id: str, seed: str) -> str:
    bucket = int(hashlib.sha256(f"{seed}\x1f{work_id}".encode()).hexdigest()[:16], 16)
    ratio = bucket / 16**16
    return "train" if ratio < 0.8 else "validation" if ratio < 0.9 else "test"


def _scan_sources(processed_root: Path) -> Tuple[List[SourceRecord], dict]:
    records: List[SourceRecord] = []
    sources = {}
    for directory in sorted(path for path in processed_root.iterdir() if path.is_dir()):
        songs_path = directory / "songs.jsonl"
        split_path = directory / "split_manifest.json"
        if not songs_path.is_file() or not split_path.is_file():
            continue
        source_manifest = json.loads(split_path.read_text(encoding="utf-8"))
        source = str(source_manifest.get("dataset") or directory.name)
        if source == "integrated_corpora" or source in sources:
            continue
        sources[source] = {
            "directory": directory,
            "songs_path": songs_path,
            "split_manifest_path": split_path,
            "dataset_version": source_manifest.get("dataset_version"),
            "adapter_version": source_manifest.get("adapter_version"),
        }
        with songs_path.open(encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, 1):
                row = json.loads(line)
                song = row["song"]
                song_id = str(song["song_id"])
                key = f"{source}:{song_id}"
                metadata = dict(row.get("metadata") or {})
                if row.get("chart_slot") is not None:
                    metadata["chart_slot"] = row["chart_slot"]
                fingerprint, usable, statuses, styles = _sequence_fingerprint(row)
                records.append(SourceRecord(
                    key=key,
                    source=source,
                    song_id=song_id,
                    source_work_id=str(song["work_id"]),
                    title=str(row.get("title") or ""),
                    creator=str(row.get("creator") or row.get("artist") or ""),
                    source_partition=str(row.get("source_partition") or source),
                    metadata=metadata,
                    event_count=len(song.get("events") or []),
                    usable_events=usable,
                    statuses=statuses,
                    styles=styles,
                    sequence_fingerprint=fingerprint,
                ))
    if not records:
        raise ValueError(f"No converted corpora found below {processed_root}")
    return records, sources


def _identity_groups(records: Sequence[SourceRecord]) -> Tuple[_UnionFind, dict]:
    union_find = _UnionFind(record.key for record in records)
    evidence_counts = Counter()

    source_works = defaultdict(list)
    title_creators = defaultdict(list)
    identifiers = defaultdict(list)
    pop909_ids = defaultdict(list)
    billboard_slots = defaultdict(list)
    jazz_titles = defaultdict(list)
    for record in records:
        source_works[(record.source, record.source_work_id)].append(record)
        if record.normalized_title and record.normalized_creator:
            title_creators[(record.normalized_title, record.normalized_creator)].append(record)
        raw_identifiers = record.metadata.get("identifiers") or {}
        if isinstance(raw_identifiers, Mapping):
            for name, value in raw_identifiers.items():
                if value not in (None, ""):
                    identifiers[(str(name).casefold(), _normalized_text(value))].append(record)
        pop909_id = record.metadata.get("pop909_id")
        if pop909_id not in (None, ""):
            pop909_ids[str(pop909_id).zfill(3)].append(record)
        slot = None
        if record.source == "mcgill_billboard":
            slot = record.metadata.get("chart_slot")
        elif record.source == "choco" and record.source_partition == "casd":
            values = record.metadata.get("identifiers") or {}
            if isinstance(values, Mapping):
                slot = values.get("dataid_billboard")
        if slot not in (None, ""):
            billboard_slots[str(slot)].append(record)
        if "jazz" in record.styles and record.normalized_title:
            title = record.normalized_title
            if len(title) >= 8 or len(title.split()) >= 2:
                jazz_titles[title].append(record)

    evidence_counts["source_work"] = _union_groups(union_find, source_works, "source_work")
    evidence_counts["title_creator"] = _union_groups(
        union_find, title_creators, "exact_title_creator", cross_scope_only=True
    )
    evidence_counts["external_identifier"] = _union_groups(
        union_find, identifiers, "external_identifier", cross_scope_only=True
    )
    evidence_counts["pop909_id"] = _union_groups(
        union_find, pop909_ids, "pop909_id", cross_scope_only=True
    )
    evidence_counts["billboard_slot"] = _union_groups(
        union_find, billboard_slots, "billboard_slot", cross_scope_only=True
    )
    conservative_jazz = {}
    for title, candidates in jazz_titles.items():
        scopes = {(record.source, record.source_partition) for record in candidates}
        creators = {record.normalized_creator for record in candidates if record.normalized_creator}
        has_missing_creator = any(not record.normalized_creator for record in candidates)
        if len(scopes) >= 2 and (len(creators) <= 1 or has_missing_creator):
            conservative_jazz[title] = candidates
    evidence_counts["jazz_title"] = _union_groups(
        union_find, conservative_jazz, "conservative_jazz_title", cross_scope_only=True
    )
    return union_find, dict(evidence_counts)


def _publication_review(path: Path, records: Sequence[SourceRecord], sources: Mapping) -> dict:
    policy = json.loads(path.read_text(encoding="utf-8"))
    if policy.get("schema_version") != 1 or policy.get("profile") != "chordscape-public-training-v1":
        raise ValueError("Unsupported publication corpus policy")
    if set(policy.get("expected_songs_sha256", {})) != {"choco", "when_in_rome"}:
        raise ValueError("Publication review must pin both ChoCo and When in Rome sources")
    if not {"pop909", "pop909_cl"}.issubset(policy.get("excluded_sources", [])):
        raise ValueError("Publication review must exclude POP909 and POP909-CL")
    if not {"jaah", "mozart-piano-sonatas"}.issubset(policy.get("excluded_choco_partitions", [])):
        raise ValueError("Publication review must exclude ChoCo noncommercial partitions")
    for source, expected in policy["expected_songs_sha256"].items():
        if source not in sources or _sha256(sources[source]["songs_path"]) != expected:
            raise ValueError(f"Publication review source changed: {source}")
    record_index = records_by_key(records)
    licenses = policy["licenses"]
    reviewed = policy["reviewed_choco_when_in_rome"]
    expected_keys = {
        record.key for record in records
        if (record.source, record.source_partition) == ("choco", "when-in-rome")
    }
    if set(reviewed) != expected_keys:
        raise ValueError("Publication review must cover every ChoCo When in Rome item")
    for key, review in reviewed.items():
        record = record_index.get(key)
        if record is None or (record.source, record.source_partition) != ("choco", "when-in-rome"):
            raise ValueError(f"Publication review references unknown ChoCo item: {key}")
        if (record.title, record.creator) != (
            review["reviewed_title"], review["reviewed_creator"]
        ):
            raise ValueError(f"Publication review identity changed: {key}")
        decision = review.get("decision")
        if decision not in {"include", "duplicate", "exclude"}:
            raise ValueError(f"Invalid publication review decision: {key}")
        if decision == "exclude":
            if not review.get("reason") or "license_id" in review or "duplicate_of" in review:
                raise ValueError(f"Invalid excluded publication item: {key}")
        elif review.get("license_id") not in licenses:
            raise ValueError(f"Invalid publication review license: {key}")
        if ("analysis_path" in review) != ("analysis_sha256" in review):
            raise ValueError(f"Incomplete source analysis reference: {key}")
        if decision != "exclude" and "analysis_path" not in review:
            raise ValueError(f"Missing source analysis reference: {key}")
        if "analysis_path" in review and (
            not review["analysis_path"].startswith("Corpus/")
            or len(review["analysis_sha256"]) != 64
            or any(char not in "0123456789abcdef" for char in review["analysis_sha256"])
        ):
            raise ValueError(f"Invalid source analysis reference: {key}")
        if decision == "duplicate":
            target = record_index.get(review.get("duplicate_of"))
            if target is None or target.source != "when_in_rome":
                raise ValueError(f"Publication review duplicate has no direct source: {key}")
            expected_path = "Corpus/OpenScore-LiederCorpus/" + str(target.metadata.get("path", ""))
            if review["analysis_path"] != expected_path:
                raise ValueError(f"Publication review duplicate path mismatch: {key}")
        elif "duplicate_of" in review:
            raise ValueError(f"Included publication item has duplicate target: {key}")
    return policy


def _apply_publication_review(
    records: Sequence[SourceRecord], union_find: _UnionFind, policy: Mapping
) -> dict:
    index = records_by_key(records)
    review = policy["reviewed_choco_when_in_rome"]
    by_path = defaultdict(list)
    for key, value in review.items():
        if value["decision"] == "exclude":
            continue
        by_path[value["analysis_path"]].append(index[key])
        if value["decision"] == "duplicate":
            target = index[value["duplicate_of"]]
            union_find.union(key, target.key)
            index[key].matching_evidence.add("reviewed_when_in_rome_source_path")
            target.matching_evidence.add("reviewed_when_in_rome_source_path")
    for group in by_path.values():
        for record in group[1:]:
            union_find.union(group[0].key, record.key)
            record.matching_evidence.add("reviewed_when_in_rome_source_path")
            group[0].matching_evidence.add("reviewed_when_in_rome_source_path")
    counts = Counter()
    for record in records:
        if record.source in policy["excluded_sources"]:
            record.exclude("publication_excluded_source")
        elif record.source == "choco" and record.source_partition in policy["excluded_choco_partitions"]:
            record.exclude("publication_nc_partition")
        elif record.source == "choco" and record.source_partition == "when-in-rome":
            decision = review.get(record.key)
            if decision is None:
                record.exclude("publication_unverified_origin")
            else:
                record.rights_review = {
                    field: decision[field] for field in (
                        "analysis_path", "analysis_sha256", "license_id", "decision", "reason"
                    ) if field in decision
                }
                if decision["decision"] == "duplicate":
                    record.exclude("publication_upstream_duplicate")
                elif decision["decision"] == "exclude":
                    record.exclude("publication_review_excluded")
        if record.exclusion_reason and record.exclusion_reason.startswith("publication_"):
            counts[record.exclusion_reason] += 1
    return dict(sorted(counts.items()))


def _exclude_non_pop_jazz(records: Sequence[SourceRecord]) -> None:
    allowed = {"pop", "jazz"}
    for record in records:
        # Reject an entire mixed-style record rather than silently retaining
        # classical events from a future adapter.
        if record.selected and record.styles and not record.styles.issubset(allowed):
            record.exclude("publication_non_pop_jazz_style")


def _canonicalize(records: Sequence[SourceRecord], union_find: _UnionFind, seed: str) -> None:
    components = defaultdict(list)
    for record in records:
        components[union_find.find(record.key)].append(record)
    for component in components.values():
        anchors = sorted(f"{record.source}:{record.source_work_id}" for record in component)
        identity = "\x1f".join(anchors)
        digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:20]
        work_id = f"integrated-work-{digest}"
        split = _assign_split(work_id, seed)
        for record in component:
            record.canonical_work_id = work_id
            record.split = split


def _deduplicate(records: Sequence[SourceRecord], available_sources: Set[str]) -> None:
    # A JAMS file can contain alternative annotation views of the same item.
    views = defaultdict(list)
    for record in records:
        if record.selected and record.source == "choco" and record.choco_id:
            views[record.choco_id].append(record)
    for candidates in views.values():
        if len(candidates) > 1:
            winner = min(candidates, key=_source_quality)
            for candidate in candidates:
                if candidate is not winner:
                    candidate.exclude("alternate_annotation_view")

    # ChoCo includes byte-level or format-converted mirrors of these complete
    # upstream collections.  Prefer the direct adapters and their richer fields.
    mirror_targets = {
        "billboard": "mcgill_billboard",
        "weimar": "weimar_jazz_database",
    }
    for record in records:
        target = mirror_targets.get(record.source_partition)
        if record.source == "choco" and target in available_sources:
            record.exclude("upstream_mirror")

    by_work = defaultdict(list)
    for record in records:
        by_work[record.canonical_work_id].append(record)
    for family in by_work.values():
        sources = {record.source for record in family}
        for record in family:
            if (
                record.source == "choco"
                and record.source_partition == "when-in-rome"
                and "when_in_rome" in sources
            ):
                record.exclude("upstream_mirror")
            if (
                record.source == "choco"
                and record.source_partition == "casd"
                and "mcgill_billboard" in sources
                and "billboard_slot" in record.matching_evidence
            ):
                record.exclude("upstream_recording_duplicate")

    # POP909-CL is expert-reviewed.  Keep the weak-label record only when the
    # corrected archive is absent or has no trainable chord events.
    pop_groups = defaultdict(list)
    for record in records:
        pop_id = record.metadata.get("pop909_id")
        if record.source in {"pop909", "pop909_cl"} and pop_id not in (None, ""):
            pop_groups[str(pop_id).zfill(3)].append(record)
    for candidates in pop_groups.values():
        corrected = [
            record for record in candidates
            if record.source == "pop909_cl" and record.usable_events > 0
        ]
        if corrected:
            winner = min(corrected, key=_source_quality)
        else:
            weak = [record for record in candidates if record.source == "pop909" and record.usable_events > 0]
            winner = min(weak, key=_source_quality) if weak else min(candidates, key=_source_quality)
        for candidate in candidates:
            if candidate is not winner:
                candidate.exclude(
                    "superseded_weak_annotation"
                    if candidate.source == "pop909"
                    else "corrected_annotation_unusable"
                )

    for record in records:
        if record.usable_events == 0:
            record.exclude("no_trainable_events")

    # Finally remove identical normalized sequences inside a work family.  This
    # catches duplicate charts without collapsing distinct performances or
    # independently differing annotations of the same composition.
    fingerprints = defaultdict(list)
    for record in records:
        if record.selected and record.sequence_fingerprint:
            fingerprints[(record.canonical_work_id, record.sequence_fingerprint)].append(record)
    for candidates in fingerprints.values():
        if len(candidates) < 2:
            continue
        winner = min(candidates, key=_source_quality)
        for candidate in candidates:
            if candidate is not winner:
                candidate.exclude("exact_sequence_duplicate")


def build_integrated_manifest(
    processed_root: Path,
    output_dir: Path,
    *,
    seed: str = DEFAULT_SEED,
    publication_policy: Optional[Path] = None,
    pop_jazz_only: bool = False,
) -> dict:
    if pop_jazz_only and publication_policy is None:
        raise ValueError("Pop/jazz training requires a publication corpus policy")
    records, sources = _scan_sources(processed_root)
    union_find, matching_summary = _identity_groups(records)
    review = None
    if publication_policy is not None:
        review = _publication_review(publication_policy, records, sources)
        matching_summary["reviewed_when_in_rome_links"] = sum(
            item["decision"] == "duplicate"
            for item in review["reviewed_choco_when_in_rome"].values()
        )
        publication_exclusions = _apply_publication_review(records, union_find, review)
    if pop_jazz_only:
        _exclude_non_pop_jazz(records)
    _canonicalize(records, union_find, seed)
    _deduplicate(records, set(sources))

    output_dir.mkdir(parents=True, exist_ok=True)
    source_output = {}
    for source, values in sorted(sources.items()):
        source_output[source] = {
            "songs_path": os.path.relpath(values["songs_path"], output_dir),
            "split_manifest_path": os.path.relpath(values["split_manifest_path"], output_dir),
            "dataset_version": values["dataset_version"],
            "adapter_version": values["adapter_version"],
            "songs_sha256": _sha256(values["songs_path"]),
            "split_manifest_sha256": _sha256(values["split_manifest_path"]),
        }

    works = defaultdict(lambda: {
        "all_song_keys": [], "selected_song_keys": [], "titles": set(),
        "creators": set(), "sources": set(), "matching_evidence": set(),
    })
    serialized_records = {}
    for record in sorted(records, key=lambda item: item.key):
        work = works[record.canonical_work_id]
        work["all_song_keys"].append(record.key)
        if record.selected:
            work["selected_song_keys"].append(record.key)
        if record.title:
            work["titles"].add(record.title)
        if record.creator:
            work["creators"].add(record.creator)
        work["sources"].add(record.source)
        work["matching_evidence"].update(record.matching_evidence)
        serialized_records[record.key] = {
            "source": record.source,
            "song_id": record.song_id,
            "source_work_id": record.source_work_id,
            "canonical_work_id": record.canonical_work_id,
            "split": record.split,
            "selected": record.selected,
            "exclusion_reason": record.exclusion_reason,
            "title": record.title,
            "creator": record.creator,
            "source_partition": record.source_partition,
            "event_count": record.event_count,
            "usable_events": record.usable_events,
            "styles": sorted(record.styles),
            "matching_evidence": sorted(record.matching_evidence),
            "sequence_fingerprint": record.sequence_fingerprint,
        }
        if record.rights_review is not None:
            serialized_records[record.key]["rights_review"] = record.rights_review
    record_index = records_by_key(records)
    serialized_works = {}
    for work_id, value in sorted(works.items()):
        selected = value["selected_song_keys"]
        sample = record_index[value["all_song_keys"][0]]
        serialized_works[work_id] = {
            "split": sample.split,
            "all_song_keys": sorted(value["all_song_keys"]),
            "selected_song_keys": sorted(selected),
            "titles": sorted(value["titles"]),
            "creators": sorted(value["creators"]),
            "sources": sorted(value["sources"]),
            "matching_evidence": sorted(value["matching_evidence"]),
        }

    exclusion_reasons = Counter(
        record.exclusion_reason for record in records if not record.selected
    )
    selected_by_source = Counter(record.source for record in records if record.selected)
    selected_events_by_source = Counter()
    selected_styles = Counter()
    for record in records:
        if not record.selected:
            continue
        selected_events_by_source[record.source] += record.usable_events
        for style in record.styles:
            selected_styles[style] += record.usable_events
    split_summary = {}
    for split in ("train", "validation", "test"):
        split_works = [value for value in serialized_works.values() if value["split"] == split]
        selected_works = [value for value in split_works if value["selected_song_keys"]]
        selected_keys = [key for value in selected_works for key in value["selected_song_keys"]]
        split_summary[split] = {
            "works": len(selected_works),
            "all_input_works": len(split_works),
            "songs": len(selected_keys),
            "usable_events": sum(serialized_records[key]["usable_events"] for key in selected_keys),
        }
    manifest = {
        "schema_version": INTEGRATION_SCHEMA_VERSION,
        "dataset": "integrated_corpora",
        "dataset_version": (
            "public-pop-jazz-v1" if pop_jazz_only else "public-v1" if review else "v1"
        ),
        "adapter_version": (
            "cross-corpus-integration-public-pop-jazz-v1" if pop_jazz_only
            else "cross-corpus-integration-public-v1" if review else ADAPTER_VERSION
        ),
        "seed": seed,
        "policy": {
            "work_grouping": [
                "source work identity",
                "exact normalized title + creator across source scopes",
                "exact external identifier",
                "POP909 numeric ID",
                "Billboard chart slot where explicitly linked",
                "conservative exact jazz title when creator evidence does not conflict",
            ],
            "deduplication": [
                "one ChoCo annotation view per JAMS item",
                "direct McGill and Weimar adapters replace their ChoCo mirrors",
                "direct When in Rome replaces an exactly matched ChoCo mirror",
                "POP909-CL corrected labels replace POP909 weak labels when usable",
                "identical normalized sequences occur once per canonical work",
            ],
            "non_identical_performances_retained": True,
        },
        "matching_groups": matching_summary,
        "sources": source_output,
        "summary": {
            "input_songs": len(records),
            "selected_songs": sum(record.selected for record in records),
            "excluded_songs": sum(not record.selected for record in records),
            "canonical_works": len(serialized_works),
            "selected_works": sum(
                bool(value["selected_song_keys"]) for value in serialized_works.values()
            ),
            "selected_usable_events": sum(
                record.usable_events for record in records if record.selected
            ),
            "exclusion_reasons": dict(sorted(exclusion_reasons.items())),
            "selected_songs_by_source": dict(sorted(selected_by_source.items())),
            "selected_usable_events_by_source": dict(sorted(selected_events_by_source.items())),
            "selected_usable_events_by_style_membership": dict(sorted(selected_styles.items())),
            "split": split_summary,
            "split_leakage": {"canonical_works_in_multiple_splits": 0},
        },
        "works": serialized_works,
        "songs": serialized_records,
    }
    if review is not None:
        manifest["policy"]["publication"] = {
            "profile": review["profile"],
            "review_path": os.path.relpath(publication_policy, output_dir),
            "review_sha256": _sha256(publication_policy),
            "exclusions_before_deduplication": publication_exclusions,
            "licenses": review["licenses"],
        }
    if pop_jazz_only:
        manifest["policy"]["allowed_styles"] = ["jazz", "pop"]
    path = output_dir / "corpus_manifest.json"
    path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return manifest


def records_by_key(records: Sequence[SourceRecord]) -> Dict[str, SourceRecord]:
    return {record.key: record for record in records}
