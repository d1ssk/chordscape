"""Factorized unigram and Markov baselines for normalized harmony sequences."""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field
import hashlib
import json
from math import exp, fsum, isfinite, log
from pathlib import Path
from typing import Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from .schema import ALTERATIONS, EXTENSIONS, QUALITIES, SEVENTHS

MODEL_SCHEMA_VERSION = 1
UNK = "__UNK__"
CATEGORICAL_HEADS = ("degree", "accidental", "quality", "seventh")
DEFAULT_VOCABULARY = {
    "degree": tuple(str(value) for value in range(1, 8)) + (UNK,),
    "accidental": tuple(str(value) for value in range(-2, 3)) + (UNK,),
    "quality": tuple(sorted(QUALITIES)) + (UNK,),
    "seventh": tuple(sorted(SEVENTHS)) + (UNK,),
    "extensions": tuple(str(value) for value in EXTENSIONS),
    "alterations": tuple(ALTERATIONS),
}


@dataclass(frozen=True)
class FactorState:
    degree: int
    accidental: int
    quality: str
    seventh: str
    extensions: Tuple[int, ...] = ()
    alterations: Tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if type(self.degree) is not int or not 1 <= self.degree <= 7:
            raise ValueError("degree must be an integer from 1 to 7")
        if type(self.accidental) is not int:
            raise ValueError("accidental must be an integer")
        if self.quality not in QUALITIES:
            raise ValueError("unknown quality")
        if self.seventh not in SEVENTHS:
            raise ValueError("unknown seventh")
        if any(value not in EXTENSIONS for value in self.extensions):
            raise ValueError("unknown extension")
        if any(value not in ALTERATIONS for value in self.alterations):
            raise ValueError("unknown alteration")
        object.__setattr__(
            self, "extensions", tuple(value for value in EXTENSIONS if value in self.extensions)
        )
        object.__setattr__(
            self, "alterations", tuple(value for value in ALTERATIONS if value in self.alterations)
        )

    def token(self) -> str:
        return json.dumps(
            [
                self.degree,
                self.accidental,
                self.quality,
                self.seventh,
                self.extensions,
                self.alterations,
            ],
            ensure_ascii=True,
            separators=(",", ":"),
        )

    @classmethod
    def from_token(cls, token: str) -> "FactorState":
        degree, accidental, quality, seventh, extensions, alterations = json.loads(token)
        return cls(degree, accidental, quality, seventh, tuple(extensions), tuple(alterations))

    @classmethod
    def from_event(cls, event: Mapping) -> Optional["FactorState"]:
        parsed = event.get("parsed") or {}
        factors = event.get("factors")
        if parsed.get("status") != "ok" or not factors or not factors.get("root"):
            return None
        components = factors.get("components") or {}
        if any(
            components.get(name) is None
            for name in ("seventh", "extensions", "alterations")
        ):
            return None
        root = factors["root"]
        try:
            return cls(
                root["degree"],
                root["accidental"],
                components["quality"],
                components["seventh"],
                tuple(components["extensions"]),
                tuple(components["alterations"]),
            )
        except (KeyError, TypeError, ValueError):
            return None

    def categorical(self, vocabulary: Mapping[str, Sequence[str]]) -> Dict[str, str]:
        raw = {
            "degree": str(self.degree),
            "accidental": str(self.accidental),
            "quality": self.quality,
            "seventh": self.seventh,
        }
        return {
            head: value if value in vocabulary[head] else UNK
            for head, value in raw.items()
        }


@dataclass(frozen=True)
class CorpusSequence:
    song_id: str
    work_id: str
    split: str
    style: str
    states: Tuple[FactorState, ...]
    source: str = "unknown"

    def __post_init__(self) -> None:
        if self.split not in {"train", "validation", "test"}:
            raise ValueError("invalid split")
        if not self.style or not self.states:
            raise ValueError("sequence requires a style and at least one state")


@dataclass(frozen=True)
class Candidate:
    ids: Tuple[str, ...]
    state: FactorState


@dataclass
class HeadCounts:
    total: int = 0
    categorical: Dict[str, Counter] = field(
        default_factory=lambda: {head: Counter() for head in CATEGORICAL_HEADS}
    )
    positive: Dict[str, Counter] = field(
        default_factory=lambda: {"extensions": Counter(), "alterations": Counter()}
    )

    def observe(self, state: FactorState, vocabulary: Mapping[str, Sequence[str]]) -> None:
        self.total += 1
        for head, value in state.categorical(vocabulary).items():
            self.categorical[head][value] += 1
        for value in state.extensions:
            self.positive["extensions"][str(value)] += 1
        for value in state.alterations:
            self.positive["alterations"][value] += 1

    def to_dict(self) -> dict:
        return {
            "total": self.total,
            "categorical": {
                head: dict(sorted(counts.items()))
                for head, counts in self.categorical.items()
            },
            "positive": {
                head: dict(sorted(counts.items()))
                for head, counts in self.positive.items()
            },
        }

    @classmethod
    def from_dict(cls, value: Mapping) -> "HeadCounts":
        result = cls(total=int(value["total"]))
        result.categorical = {
            head: Counter({key: int(count) for key, count in value["categorical"][head].items()})
            for head in CATEGORICAL_HEADS
        }
        result.positive = {
            head: Counter({key: int(count) for key, count in value["positive"][head].items()})
            for head in ("extensions", "alterations")
        }
        return result


class FactorizedMarkovModel:
    """Independent factor heads conditioned on zero, one, or two prior chords."""

    def __init__(
        self,
        order: int,
        style: str,
        *,
        alpha: float = 0.5,
        min_context_count: int = 1,
        vocabulary: Optional[Mapping[str, Sequence[str]]] = None,
    ) -> None:
        if order not in {0, 1, 2}:
            raise ValueError("order must be 0, 1, or 2")
        if not isfinite(alpha) or alpha <= 0:
            raise ValueError("alpha must be finite and positive")
        if type(min_context_count) is not int or min_context_count < 1:
            raise ValueError("min_context_count must be a positive integer")
        if not style:
            raise ValueError("style is required")
        self.order = order
        self.style = style
        self.alpha = alpha
        self.min_context_count = min_context_count
        source = vocabulary or DEFAULT_VOCABULARY
        self.vocabulary = {name: tuple(values) for name, values in source.items()}
        self.tables: Dict[int, Dict[Tuple[FactorState, ...], HeadCounts]] = {
            value: {} for value in range(order + 1)
        }
        self.training_sequences = 0
        self.training_events = 0

    def fit(self, sequences: Iterable[Sequence[FactorState]]) -> "FactorizedMarkovModel":
        for sequence in sequences:
            states = tuple(sequence)
            if not states:
                continue
            self.training_sequences += 1
            self.training_events += len(states)
            history: List[FactorState] = []
            for state in states:
                for context_order in range(self.order + 1):
                    if len(history) < context_order:
                        continue
                    context = tuple(history[-context_order:]) if context_order else ()
                    counts = self.tables[context_order].setdefault(context, HeadCounts())
                    counts.observe(state, self.vocabulary)
                history.append(state)
        if self.training_events == 0:
            raise ValueError("cannot train an empty model")
        return self

    def _select_counts(
        self, history: Sequence[FactorState]
    ) -> Tuple[int, HeadCounts]:
        for context_order in range(min(self.order, len(history)), -1, -1):
            context = tuple(history[-context_order:]) if context_order else ()
            counts = self.tables[context_order].get(context)
            if counts is not None and counts.total >= self.min_context_count:
                return context_order, counts
        raise ValueError("model has no unigram counts")

    def score_breakdown(
        self, history: Sequence[FactorState], candidate: FactorState
    ) -> dict:
        context_order, counts = self._select_counts(history)
        categorical_values = candidate.categorical(self.vocabulary)
        heads = {}
        for head, value in categorical_values.items():
            vocabulary = self.vocabulary[head]
            probability = (
                counts.categorical[head][value] + self.alpha
            ) / (counts.total + self.alpha * len(vocabulary))
            heads[head] = log(probability)
        extension_set = {str(value) for value in candidate.extensions}
        alteration_set = set(candidate.alterations)
        for head, present in (
            ("extensions", extension_set),
            ("alterations", alteration_set),
        ):
            for value in self.vocabulary[head]:
                positive_probability = (
                    counts.positive[head][value] + self.alpha
                ) / (counts.total + 2 * self.alpha)
                probability = (
                    positive_probability if value in present else 1 - positive_probability
                )
                heads[f"{head}:{value}:{'present' if value in present else 'absent'}"] = log(
                    probability
                )
        return {
            "log_probability": fsum(heads.values()),
            "context_order": context_order,
            "heads": heads,
        }

    def score_candidate(
        self, history: Sequence[FactorState], style: str, candidate: FactorState
    ) -> float:
        if style != self.style:
            raise ValueError(f"model style is {self.style!r}, not {style!r}")
        return self.score_breakdown(history, candidate)["log_probability"]

    def categorical_distribution(
        self, history: Sequence[FactorState], head: str
    ) -> Dict[str, float]:
        if head not in CATEGORICAL_HEADS:
            raise ValueError("unknown categorical head")
        _, counts = self._select_counts(history)
        vocabulary = self.vocabulary[head]
        denominator = counts.total + self.alpha * len(vocabulary)
        return {
            value: (counts.categorical[head][value] + self.alpha) / denominator
            for value in vocabulary
        }

    def predict(self, history: Sequence[FactorState]) -> dict:
        context_order, counts = self._select_counts(history)
        categorical = {}
        for head in CATEGORICAL_HEADS:
            distribution = self.categorical_distribution(history, head)
            categorical[head] = max(
                self.vocabulary[head], key=lambda value: (distribution[value], value)
            )
        multilabel = {}
        for head in ("extensions", "alterations"):
            multilabel[head] = tuple(
                value
                for value in self.vocabulary[head]
                if (counts.positive[head][value] + self.alpha)
                / (counts.total + 2 * self.alpha)
                >= 0.5
            )
        return {
            "context_order": context_order,
            "categorical": categorical,
            "multilabel": multilabel,
        }

    def to_dict(self) -> dict:
        return {
            "schema_version": MODEL_SCHEMA_VERSION,
            "model_type": "factorized_markov",
            "order": self.order,
            "style": self.style,
            "alpha": self.alpha,
            "min_context_count": self.min_context_count,
            "vocabulary": {name: list(values) for name, values in self.vocabulary.items()},
            "training_sequences": self.training_sequences,
            "training_events": self.training_events,
            "tables": {
                str(context_order): [
                    {
                        "context": [state.token() for state in context],
                        "counts": counts.to_dict(),
                    }
                    for context, counts in sorted(
                        table.items(), key=lambda item: tuple(state.token() for state in item[0])
                    )
                ]
                for context_order, table in self.tables.items()
            },
        }

    @classmethod
    def from_dict(cls, value: Mapping) -> "FactorizedMarkovModel":
        if value.get("schema_version") != MODEL_SCHEMA_VERSION:
            raise ValueError("unsupported baseline model schema")
        result = cls(
            int(value["order"]),
            value["style"],
            alpha=float(value["alpha"]),
            min_context_count=int(value["min_context_count"]),
            vocabulary=value["vocabulary"],
        )
        result.training_sequences = int(value["training_sequences"])
        result.training_events = int(value["training_events"])
        result.tables = {context_order: {} for context_order in range(result.order + 1)}
        for context_order_text, entries in value["tables"].items():
            context_order = int(context_order_text)
            for entry in entries:
                context = tuple(FactorState.from_token(token) for token in entry["context"])
                result.tables[context_order][context] = HeadCounts.from_dict(entry["counts"])
        return result


def _logsumexp(values: Sequence[float]) -> float:
    maximum = max(values)
    return maximum + log(fsum(exp(value - maximum) for value in values))


def mixture_log_probability(
    log_probabilities: Mapping[str, float], weights: Mapping[str, float]
) -> float:
    names = sorted(log_probabilities)
    if set(names) != set(weights):
        raise ValueError("mixture models and weights must have identical styles")
    if not names or any(not isfinite(weights[name]) or weights[name] <= 0 for name in names):
        raise ValueError("mixture weights must be finite and positive")
    total_weight = fsum(weights[name] for name in names)
    return _logsumexp(
        [log(weights[name] / total_weight) + log_probabilities[name] for name in names]
    )


class BaselineBundle:
    def __init__(
        self,
        order: int,
        models: Mapping[str, FactorizedMarkovModel],
        free_weights: Optional[Mapping[str, float]] = None,
    ) -> None:
        if not models:
            raise ValueError("a bundle requires at least one style model")
        if any(model.order != order or model.style != style for style, model in models.items()):
            raise ValueError("bundle model metadata mismatch")
        self.order = order
        self.models = dict(sorted(models.items()))
        self.free_weights = dict(free_weights or {style: 1.0 for style in self.models})
        if set(self.free_weights) != set(self.models):
            raise ValueError("free weights must cover every style model")

    def score_candidate(
        self, history: Sequence[FactorState], style: str, candidate: FactorState
    ) -> float:
        if style == "free":
            scores = {
                name: model.score_candidate(history, name, candidate)
                for name, model in self.models.items()
            }
            return mixture_log_probability(scores, self.free_weights)
        if style not in self.models:
            raise ValueError(f"untrained style: {style!r}")
        return self.models[style].score_candidate(history, style, candidate)

    def normalize_candidates(
        self,
        history: Sequence[FactorState],
        style: str,
        candidates: Sequence[FactorState],
    ) -> List[float]:
        if not candidates:
            raise ValueError("candidate set must not be empty")
        scores = [self.score_candidate(history, style, candidate) for candidate in candidates]
        normalizer = _logsumexp(scores)
        return [exp(score - normalizer) for score in scores]

    def to_dict(self) -> dict:
        return {
            "schema_version": MODEL_SCHEMA_VERSION,
            "artifact_type": "baseline_bundle",
            "order": self.order,
            "free_weights": self.free_weights,
            "models": {style: model.to_dict() for style, model in self.models.items()},
        }

    @classmethod
    def from_dict(cls, value: Mapping) -> "BaselineBundle":
        if value.get("schema_version") != MODEL_SCHEMA_VERSION:
            raise ValueError("unsupported baseline bundle schema")
        models = {
            style: FactorizedMarkovModel.from_dict(model)
            for style, model in value["models"].items()
        }
        return cls(int(value["order"]), models, value["free_weights"])


def load_candidate_manifest(path: Path) -> List[Candidate]:
    manifest = json.loads(path.read_text(encoding="utf-8"))
    grouped: Dict[FactorState, List[str]] = {}
    for node in manifest["nodes"]:
        if not isinstance(node, list) or len(node) != 8:
            raise ValueError("candidate manifest must use compact schema v1 nodes")
        identifier, degree, accidental, quality, seventh, extensions, alterations, _bass = node
        state = FactorState(
            degree, accidental, quality, seventh, tuple(extensions), tuple(alterations)
        )
        grouped.setdefault(state, []).append(identifier)
    return [
        Candidate(tuple(ids), state)
        for state, ids in sorted(grouped.items(), key=lambda item: item[1][0])
    ]


def _record_sequences(
    record: Mapping,
    *,
    song_id: str,
    work_id: str,
    split: str,
    source: str,
) -> List[CorpusSequence]:
    song = record["song"]
    events = song["events"]
    boundary_indices = set()
    for boundary in record.get("boundaries", []):
        index = boundary["event_index"]
        if type(index) is not int or not 0 <= index <= len(events):
            raise ValueError(f"invalid boundary for {song_id}")
        boundary_indices.add(index)
    sequences = []
    current: List[FactorState] = []
    current_style = None

    def flush() -> None:
        nonlocal current, current_style
        if current:
            sequences.append(CorpusSequence(
                song_id, work_id, split, current_style, tuple(current), source
            ))
        current = []
        current_style = None

    for event_index, event in enumerate(events):
        if event_index in boundary_indices:
            flush()
        state = FactorState.from_event(event)
        style = event.get("style")
        if state is None or not style:
            flush()
            continue
        if current_style is not None and style != current_style:
            flush()
        current_style = style
        current.append(state)
    flush()
    return sequences


def load_sequences(songs_path: Path, split_manifest_path: Path) -> List[CorpusSequence]:
    manifest = json.loads(split_manifest_path.read_text(encoding="utf-8"))
    source = str(manifest.get("dataset") or "unknown")
    expected = {}
    for work_id, work in manifest["works"].items():
        split = work["split"]
        for song_id in work["song_ids"]:
            if song_id in expected:
                raise ValueError(f"duplicate song in split manifest: {song_id}")
            expected[song_id] = (work_id, split)
    seen = set()
    sequences = []
    with songs_path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            record = json.loads(line)
            song = record["song"]
            song_id = song["song_id"]
            work_id = song["work_id"]
            if song_id in seen:
                raise ValueError(f"duplicate song in JSONL: {song_id}")
            seen.add(song_id)
            if song_id not in expected:
                raise ValueError(f"song missing from split manifest: {song_id}")
            expected_work, expected_split = expected[song_id]
            if work_id != expected_work or record["split"] != expected_split:
                raise ValueError(f"split mismatch for {song_id} at line {line_number}")
            sequences.extend(_record_sequences(
                record,
                song_id=song_id,
                work_id=work_id,
                split=record["split"],
                source=source,
            ))
    missing = set(expected) - seen
    if missing:
        raise ValueError(f"{len(missing)} split-manifest songs are absent from JSONL")
    return sequences


def load_integrated_sequences(corpus_manifest_path: Path) -> List[CorpusSequence]:
    manifest = json.loads(corpus_manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schema_version") != 1 or manifest.get("dataset") != "integrated_corpora":
        raise ValueError("unsupported integrated corpus manifest")
    selected_by_source = defaultdict(dict)
    for song_key, entry in manifest["songs"].items():
        if not entry.get("selected"):
            continue
        source = entry["source"]
        song_id = entry["song_id"]
        if song_id in selected_by_source[source]:
            raise ValueError(f"duplicate selected source song: {source}:{song_id}")
        selected_by_source[source][song_id] = (song_key, entry)
    sequences = []
    for source, expected in sorted(selected_by_source.items()):
        source_info = manifest["sources"].get(source)
        if source_info is None:
            raise ValueError(f"selected song references unknown source: {source}")
        songs_path = (corpus_manifest_path.parent / source_info["songs_path"]).resolve()
        seen = set()
        with songs_path.open(encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, 1):
                record = json.loads(line)
                source_song_id = str(record["song"]["song_id"])
                if source_song_id not in expected:
                    continue
                if source_song_id in seen:
                    raise ValueError(f"duplicate song in {source} JSONL: {source_song_id}")
                seen.add(source_song_id)
                song_key, entry = expected[source_song_id]
                if record["song"]["work_id"] != entry["source_work_id"]:
                    raise ValueError(f"source work mismatch for {song_key} at line {line_number}")
                sequences.extend(_record_sequences(
                    record,
                    song_id=song_key,
                    work_id=entry["canonical_work_id"],
                    split=entry["split"],
                    source=source,
                ))
        missing = set(expected) - seen
        if missing:
            raise ValueError(f"{len(missing)} selected {source} songs are absent from JSONL")
    return sequences


@dataclass
class _EvaluationAccumulator:
    events: int = 0
    log_probability: float = 0.0
    head_log_probability: Counter = field(default_factory=Counter)
    context_order: Counter = field(default_factory=Counter)
    rankable: int = 0
    reciprocal_rank: float = 0.0
    top1: int = 0
    top3: int = 0
    categorical_correct: Counter = field(default_factory=Counter)
    multilabel_true_positive: Counter = field(default_factory=Counter)
    multilabel_false_positive: Counter = field(default_factory=Counter)
    multilabel_false_negative: Counter = field(default_factory=Counter)

    def result(self) -> dict:
        average_nll = -self.log_probability / self.events if self.events else None
        multilabel = {}
        for head in ("extensions", "alterations"):
            true_positive = self.multilabel_true_positive[head]
            false_positive = self.multilabel_false_positive[head]
            false_negative = self.multilabel_false_negative[head]
            precision_denominator = true_positive + false_positive
            recall_denominator = true_positive + false_negative
            precision = true_positive / precision_denominator if precision_denominator else 0
            recall = true_positive / recall_denominator if recall_denominator else 0
            multilabel[head] = {
                "true_positive": true_positive,
                "false_positive": false_positive,
                "false_negative": false_negative,
                "precision": precision,
                "recall": recall,
                "f1": 2 * precision * recall / (precision + recall)
                if precision + recall
                else 0,
            }
        return {
            "events": self.events,
            "nll": average_nll,
            "perplexity": exp(average_nll) if average_nll is not None else None,
            "head_nll": {
                head: -value / self.events
                for head, value in sorted(self.head_log_probability.items())
            } if self.events else {},
            "backoff_order_usage": {
                str(order): count for order, count in sorted(self.context_order.items())
            },
            "categorical_accuracy": {
                head: self.categorical_correct[head] / self.events
                for head in CATEGORICAL_HEADS
            } if self.events else {},
            "multilabel": multilabel,
            "candidate_ranking": {
                "tie_policy": "average_rank",
                "rankable_events": self.rankable,
                "coverage": self.rankable / self.events if self.events else 0,
                "mrr": self.reciprocal_rank / self.rankable if self.rankable else 0,
                "top1": self.top1 / self.rankable if self.rankable else 0,
                "top3": self.top3 / self.rankable if self.rankable else 0,
            },
        }


def evaluate_bundle(
    bundle: BaselineBundle,
    sequences: Sequence[CorpusSequence],
    candidates: Sequence[Candidate],
) -> dict:
    overall = _EvaluationAccumulator()
    by_style = defaultdict(_EvaluationAccumulator)
    by_source = defaultdict(_EvaluationAccumulator)
    candidate_states = [candidate.state for candidate in candidates]
    candidate_set = set(candidate_states)
    for sequence in sequences:
        history: List[FactorState] = []
        model = bundle.models.get(sequence.style)
        if model is None:
            raise ValueError(f"no model for evaluation style {sequence.style!r}")
        for state in sequence.states:
            breakdown = model.score_breakdown(history, state)
            prediction = model.predict(history)
            truth_categorical = state.categorical(model.vocabulary)
            truth_multilabel = {
                "extensions": {str(value) for value in state.extensions},
                "alterations": set(state.alterations),
            }
            for accumulator in (
                overall,
                by_style[sequence.style],
                by_source[sequence.source],
            ):
                accumulator.events += 1
                accumulator.log_probability += breakdown["log_probability"]
                accumulator.context_order[breakdown["context_order"]] += 1
                for head, value in breakdown["heads"].items():
                    metric_head = (
                        head.rsplit(":", 1)[0]
                        if head.startswith(("extensions:", "alterations:"))
                        else head
                    )
                    accumulator.head_log_probability[metric_head] += value
                for head in CATEGORICAL_HEADS:
                    accumulator.categorical_correct[head] += int(
                        prediction["categorical"][head] == truth_categorical[head]
                    )
                for head in ("extensions", "alterations"):
                    predicted = set(prediction["multilabel"][head])
                    truth = truth_multilabel[head]
                    accumulator.multilabel_true_positive[head] += len(predicted & truth)
                    accumulator.multilabel_false_positive[head] += len(predicted - truth)
                    accumulator.multilabel_false_negative[head] += len(truth - predicted)
            if state in candidate_set:
                target_score = bundle.score_candidate(history, sequence.style, state)
                scores = [
                    bundle.score_candidate(history, sequence.style, candidate)
                    for candidate in candidate_states
                ]
                greater = sum(score > target_score + 1e-12 for score in scores)
                tied = sum(abs(score - target_score) <= 1e-12 for score in scores)
                rank = 1 + greater + (tied - 1) / 2
                for accumulator in (
                    overall,
                    by_style[sequence.style],
                    by_source[sequence.source],
                ):
                    accumulator.rankable += 1
                    accumulator.reciprocal_rank += 1 / rank
                    accumulator.top1 += int(rank <= 1)
                    accumulator.top3 += int(rank <= 3)
            history.append(state)
    return {
        "overall": overall.result(),
        "by_style": {style: accumulator.result() for style, accumulator in sorted(by_style.items())},
        "by_source": {
            source: accumulator.result() for source, accumulator in sorted(by_source.items())
        },
    }


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _train_sequence_set(
    sequences: Sequence[CorpusSequence],
    candidate_manifest_path: Path,
    output_dir: Path,
    *,
    dataset_metadata: Mapping,
    input_sha256: Mapping[str, str],
    alpha: float,
    min_context_count: int,
    command: Optional[Sequence[str]],
) -> dict:
    candidates = load_candidate_manifest(candidate_manifest_path)
    candidate_manifest = json.loads(candidate_manifest_path.read_text(encoding="utf-8"))
    train_sequences = [sequence for sequence in sequences if sequence.split == "train"]
    styles = sorted({sequence.style for sequence in train_sequences})
    if not styles:
        raise ValueError("training split contains no complete sequences")
    bundles = {}
    for order in (0, 1, 2):
        models = {}
        for style in styles:
            style_sequences = [
                sequence.states for sequence in train_sequences if sequence.style == style
            ]
            models[style] = FactorizedMarkovModel(
                order,
                style,
                alpha=alpha,
                min_context_count=min_context_count,
            ).fit(style_sequences)
        bundles[order] = BaselineBundle(order, models)
    evaluation = {
        "schema_version": 1,
        "candidate_manifest": {
            "path": candidate_manifest_path.name,
            "version": candidate_manifest.get("version"),
            "source": candidate_manifest.get("source"),
        },
        "unique_harmony_candidates": len(candidates),
        "orders": {},
    }
    for order, bundle in bundles.items():
        evaluation["orders"][str(order)] = {
            split: evaluate_bundle(
                bundle,
                [sequence for sequence in sequences if sequence.split == split],
                candidates,
            )
            for split in ("validation", "test")
        }
    run_manifest = {
        "schema_version": 1,
        "model": "factorized unigram / first-order / second-order Markov",
        "dataset": dataset_metadata.get("dataset"),
        "dataset_version": dataset_metadata.get("dataset_version"),
        "adapter_version": dataset_metadata.get("adapter_version"),
        "alpha": alpha,
        "min_context_count": min_context_count,
        "split_seed": dataset_metadata.get("seed"),
        "styles": styles,
        "style_training": "independent conditional models; free is an explicit probability mixture",
        "training_sequences": len(train_sequences),
        "training_events": sum(len(sequence.states) for sequence in train_sequences),
        "training_by_style": {
            style: {
                "sequences": sum(sequence.style == style for sequence in train_sequences),
                "events": sum(
                    len(sequence.states) for sequence in train_sequences if sequence.style == style
                ),
            }
            for style in styles
        },
        "training_by_source": {
            source: {
                "sequences": sum(sequence.source == source for sequence in train_sequences),
                "events": sum(
                    len(sequence.states) for sequence in train_sequences if sequence.source == source
                ),
            }
            for source in sorted({sequence.source for sequence in train_sequences})
        },
        "input_sha256": {
            **dict(sorted(input_sha256.items())),
            "candidate_manifest": _sha256(candidate_manifest_path),
        },
        "command": list(command) if command is not None else None,
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    names = {0: "unigram", 1: "markov1", 2: "markov2"}
    for order, bundle in bundles.items():
        (output_dir / f"{names[order]}.json").write_text(
            json.dumps(bundle.to_dict(), ensure_ascii=False, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    (output_dir / "evaluation.json").write_text(
        json.dumps(evaluation, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    (output_dir / "run_manifest.json").write_text(
        json.dumps(run_manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return {"run": run_manifest, "evaluation": evaluation}


def train_baselines(
    songs_path: Path,
    split_manifest_path: Path,
    candidate_manifest_path: Path,
    output_dir: Path,
    *,
    alpha: float = 0.5,
    min_context_count: int = 1,
    command: Optional[Sequence[str]] = None,
) -> dict:
    sequences = load_sequences(songs_path, split_manifest_path)
    split_manifest = json.loads(split_manifest_path.read_text(encoding="utf-8"))
    return _train_sequence_set(
        sequences,
        candidate_manifest_path,
        output_dir,
        dataset_metadata=split_manifest,
        input_sha256={
            "songs_jsonl": _sha256(songs_path),
            "split_manifest": _sha256(split_manifest_path),
        },
        alpha=alpha,
        min_context_count=min_context_count,
        command=command,
    )


def train_integrated_baselines(
    corpus_manifest_path: Path,
    candidate_manifest_path: Path,
    output_dir: Path,
    *,
    alpha: float = 0.5,
    min_context_count: int = 1,
    command: Optional[Sequence[str]] = None,
) -> dict:
    corpus_manifest = json.loads(corpus_manifest_path.read_text(encoding="utf-8"))
    sequences = load_integrated_sequences(corpus_manifest_path)
    input_hashes = {"corpus_manifest": _sha256(corpus_manifest_path)}
    for source, source_info in sorted(corpus_manifest["sources"].items()):
        path = (corpus_manifest_path.parent / source_info["songs_path"]).resolve()
        actual = _sha256(path)
        expected = source_info.get("songs_sha256")
        if expected and actual != expected:
            raise ValueError(f"source JSONL checksum changed after integration: {source}")
        input_hashes[f"songs_jsonl:{source}"] = actual
    return _train_sequence_set(
        sequences,
        candidate_manifest_path,
        output_dir,
        dataset_metadata=corpus_manifest,
        input_sha256=input_hashes,
        alpha=alpha,
        min_context_count=min_context_count,
        command=command,
    )


def load_bundle(path: Path) -> BaselineBundle:
    return BaselineBundle.from_dict(json.loads(path.read_text(encoding="utf-8")))
