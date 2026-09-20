"""Versioned, style-conditioned causal Transformer training on integrated chord sequences."""
from __future__ import annotations

from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import random
import sys
from typing import Mapping, Sequence

from .baseline import (
    CATEGORICAL_HEADS, DEFAULT_VOCABULARY, UNK, CorpusSequence,
    FactorState, _EvaluationAccumulator, _sha256, load_candidate_manifest,
    load_integrated_sequences,
)

try:
    import torch
    from torch import nn
    from torch.nn import functional as F
except ImportError as error:
    raise ImportError("Transformer training requires: python -m pip install '.[train]'") from error


MODEL_VERSION = "transformer-v1"
CHECKPOINT_SCHEMA = 1
MODEL_INDEX_PATH = Path(__file__).with_name("model_versions.json")
BOS = "__BOS__"
PAD = "__PAD__"
CAT_HEADS = CATEGORICAL_HEADS
MULTI_HEADS = ("extensions", "alterations")


@dataclass(frozen=True)
class Config:
    context: int = 32
    d_model: int = 128
    layers: int = 4
    heads: int = 4
    dropout: float = 0.1
    batch_size: int = 64
    epochs: int = 8
    learning_rate: float = 0.0003
    lr_schedule: str = "constant"
    lr_factor: float = 0.5
    lr_patience: int = 1
    lr_threshold: float = 0.0001
    min_learning_rate: float = 0.00001
    weight_decay: float = 0.01
    seed: int = 42
    patience: int = 3
    device: str = "auto"

    def validate(self) -> None:
        if (self.context < 2 or self.d_model < 8 or self.layers < 1 or self.heads < 1
                or self.d_model % self.heads or self.batch_size < 1 or self.epochs < 1
                or self.patience < 1 or not 0 <= self.dropout < 1
                or not math.isfinite(self.learning_rate) or self.learning_rate <= 0
                or self.lr_schedule not in {"constant", "plateau"}
                or not math.isfinite(self.lr_factor) or not 0 < self.lr_factor < 1
                or type(self.lr_patience) is not int or self.lr_patience < 0
                or not math.isfinite(self.lr_threshold) or self.lr_threshold < 0
                or not math.isfinite(self.min_learning_rate)
                or not 0 <= self.min_learning_rate <= self.learning_rate
                or not math.isfinite(self.weight_decay) or self.weight_decay < 0):
            raise ValueError("invalid Transformer configuration")


def _device(name: str) -> torch.device:
    if name == "auto":
        name = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
    if name == "cuda" and not torch.cuda.is_available():
        raise ValueError("CUDA is unavailable")
    if name == "mps" and not torch.backends.mps.is_available():
        raise ValueError("MPS is unavailable")
    if name not in {"cpu", "cuda", "mps"}:
        raise ValueError(f"unknown device: {name}")
    return torch.device(name)


def make_vocabulary(sequences: Sequence[CorpusSequence]) -> dict:
    train = [sequence for sequence in sequences if sequence.split == "train"]
    if not train:
        raise ValueError("training split contains no complete sequences")
    accidental_values = {str(state.accidental) for sequence in train for state in sequence.states}
    return {
        **{head: list(values) for head, values in DEFAULT_VOCABULARY.items()},
        "accidental": sorted(accidental_values, key=int) + [UNK],
        "styles": sorted({sequence.style for sequence in train}),
    }


class Codec:
    def __init__(self, vocabulary: Mapping):
        self.vocabulary = {key: list(values) for key, values in vocabulary.items()}
        self.output_ids = {
            head: {value: index for index, value in enumerate(self.vocabulary[head])}
            for head in CAT_HEADS
        }
        self.styles = {name: index for index, name in enumerate(self.vocabulary["styles"])}
        self.bits = {head: {value: i for i, value in enumerate(self.vocabulary[head])} for head in MULTI_HEADS}

    def state(self, state: FactorState) -> tuple[list[int], list[float], list[int], list[bool]]:
        values = [str(state.degree), str(state.accidental), state.quality, state.seventh]
        categorical = [self.output_ids[head].get(value, self.output_ids[head][UNK]) for head, value in zip(CAT_HEADS, values)]
        known = [value in self.output_ids[head] for head, value in zip(CAT_HEADS, values)]
        bits = [0.0] * sum(len(self.bits[head]) for head in MULTI_HEADS)
        for value in state.extensions:
            bits[self.bits["extensions"][str(value)]] = 1.0
        offset = len(self.bits["extensions"])
        for value in state.alterations:
            bits[offset + self.bits["alterations"][value]] = 1.0
        return categorical, bits, categorical, known

    @property
    def bit_count(self) -> int:
        return sum(len(self.bits[head]) for head in MULTI_HEADS)


class HarmonyTransformer(nn.Module):
    def __init__(self, config: Config, vocabulary: Mapping):
        super().__init__()
        self.config = config
        self.vocabulary = vocabulary
        self.embeddings = nn.ModuleDict({
            head: nn.Embedding(len(vocabulary[head]) + 2, config.d_model, padding_idx=0)
            for head in CAT_HEADS
        })
        self.bit_embedding = nn.Linear(sum(len(vocabulary[head]) for head in MULTI_HEADS), config.d_model, bias=False)
        self.style_embedding = nn.Embedding(len(vocabulary["styles"]), config.d_model)
        self.position_embedding = nn.Embedding(config.context, config.d_model)
        layer = nn.TransformerEncoderLayer(
            config.d_model, config.heads, config.d_model * 4, config.dropout,
            batch_first=True, norm_first=True, activation="gelu",
        )
        self.encoder = nn.TransformerEncoder(layer, config.layers, enable_nested_tensor=False)
        self.normalizer = nn.LayerNorm(config.d_model)
        self.outputs = nn.ModuleDict({head: nn.Linear(config.d_model, len(vocabulary[head])) for head in CAT_HEADS})
        self.bits_output = nn.Linear(config.d_model, sum(len(vocabulary[head]) for head in MULTI_HEADS))

    def forward(self, categories, bits, styles, padding):
        batch, length, _ = categories.shape
        positions = torch.arange(length, device=categories.device)
        hidden = self.style_embedding(styles)[:, None, :] + self.position_embedding(positions)[None, :, :]
        for index, head in enumerate(CAT_HEADS):
            hidden = hidden + self.embeddings[head](categories[:, :, index])
        hidden = hidden + self.bit_embedding(bits)
        causal = torch.ones(length, length, device=categories.device, dtype=torch.bool).triu(1)
        hidden = self.normalizer(self.encoder(hidden, mask=causal, src_key_padding_mask=padding))
        return {**{head: output(hidden) for head, output in self.outputs.items()}, "bits": self.bits_output(hidden)}


def make_windows(sequences: Sequence[CorpusSequence], codec: Codec, context: int) -> list[dict]:
    """Cover every target once; shifted inputs can hold context preceding chords."""
    windows = []
    for sequence in sequences:
        if sequence.style not in codec.styles:
            raise ValueError(f"untrained style in split: {sequence.style}")
        encoded = [codec.state(state) for state in sequence.states]
        stride = max(1, context // 2)
        for target_start in range(0, len(encoded), stride):
            target_end = min(target_start + stride, len(encoded))
            start = max(0, target_end - context)
            if start > target_start:
                start = target_start
            cats, bits, targets, known, loss_mask = [], [], [], [], []
            for index in range(start, target_end):
                if index == 0:
                    cats.append([1] * len(CAT_HEADS))
                    bits.append([0.0] * codec.bit_count)
                else:
                    previous = encoded[index - 1]
                    cats.append([value + 2 for value in previous[0]])
                    bits.append(previous[1])
                targets.append(encoded[index][2])
                known.append(encoded[index][3])
                loss_mask.append(index >= target_start)
            windows.append({
                "categories": cats, "bits": bits, "targets": targets,
                "target_bits": [entry[1] for entry in encoded[start:target_end]],
                "known": known, "loss_mask": loss_mask, "style": codec.styles[sequence.style],
                "source": sequence.source, "states": sequence.states[start:target_end],
            })
    return windows


def _batch(windows: Sequence[dict], codec: Codec, device: torch.device) -> dict:
    size = max(len(window["categories"]) for window in windows)
    categories, bits, targets, target_bits, known, active, padding, styles = [], [], [], [], [], [], [], []
    for window in windows:
        missing = size - len(window["categories"])
        categories.append(window["categories"] + [[0] * 4] * missing)
        bits.append(window["bits"] + [[0.0] * codec.bit_count] * missing)
        targets.append(window["targets"] + [[0] * 4] * missing)
        target_bits.append(window["target_bits"] + [[0.0] * codec.bit_count] * missing)
        known.append(window["known"] + [[False] * 4] * missing)
        active.append(window["loss_mask"] + [False] * missing)
        padding.append([False] * len(window["categories"]) + [True] * missing)
        styles.append(window["style"])
    return {
        "categories": torch.tensor(categories, dtype=torch.long, device=device),
        "bits": torch.tensor(bits, dtype=torch.float32, device=device),
        "targets": torch.tensor(targets, dtype=torch.long, device=device),
        "target_bits": torch.tensor(target_bits, dtype=torch.float32, device=device),
        "known": torch.tensor(known, dtype=torch.bool, device=device),
        "active": torch.tensor(active, dtype=torch.bool, device=device),
        "padding": torch.tensor(padding, dtype=torch.bool, device=device),
        "styles": torch.tensor(styles, dtype=torch.long, device=device),
    }


def _log_probabilities(output: Mapping, batch: Mapping, codec: Codec) -> tuple[torch.Tensor, dict]:
    components = {}
    for index, head in enumerate(CAT_HEADS):
        values = F.log_softmax(output[head], dim=-1)
        chosen = values.gather(-1, batch["targets"][:, :, index, None]).squeeze(-1)
        components[head] = chosen * batch["known"][:, :, index]
    all_bits = -F.binary_cross_entropy_with_logits(output["bits"], batch["target_bits"], reduction="none")
    offset = 0
    for head in MULTI_HEADS:
        count = len(codec.vocabulary[head])
        components[head] = all_bits[:, :, offset:offset + count].sum(-1)
        offset += count
    return sum(components.values()), components


def _epoch(model, windows, codec, config, device, optimizer=None, seed=0) -> float:
    model.train(optimizer is not None)
    order = list(range(len(windows)))
    if optimizer is not None:
        # Sample windows evenly by style; keep evaluation on the natural corpus mix.
        groups = defaultdict(list)
        for index, window in enumerate(windows):
            groups[window["style"]].append(index)
        rng = random.Random(seed)
        largest = max(len(group) for group in groups.values())
        order = [rng.choice(group) for group in groups.values() for _ in range(largest)]
        rng.shuffle(order)
    total, count = 0.0, 0
    for start in range(0, len(order), config.batch_size):
        sample = [windows[index] for index in order[start:start + config.batch_size]]
        batch = _batch(sample, codec, device)
        with torch.set_grad_enabled(optimizer is not None):
            output = model(batch["categories"], batch["bits"], batch["styles"], batch["padding"])
            logp, _ = _log_probabilities(output, batch, codec)
            active = batch["active"]
            loss = -logp[active].mean()
            if optimizer is not None:
                optimizer.zero_grad(set_to_none=True)
                loss.backward()
                nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                optimizer.step()
        n = int(active.sum().item())
        total += float(loss.detach()) * n
        count += n
    return total / count if count else math.nan


def _candidate_scores(output: Mapping, codec: Codec, candidates: Sequence[FactorState]) -> torch.Tensor:
    scores = None
    for index, head in enumerate(CAT_HEADS):
        ids = torch.tensor([codec.state(state)[2][index] for state in candidates], device=output[head].device)
        part = F.log_softmax(output[head], -1).index_select(-1, ids)
        scores = part if scores is None else scores + part
    target_bits = torch.tensor([codec.state(state)[1] for state in candidates], device=output["bits"].device)
    # log P(binary vector) = sum log P(0) + sum(active * logit).
    logits = output["bits"]
    return scores + F.logsigmoid(-logits).sum(-1, keepdim=True) + logits @ target_bits.T


@torch.no_grad()
def evaluate(model, windows, codec, candidates, config, device) -> dict:
    model.eval()
    accumulators = {"overall": _EvaluationAccumulator()}
    by_style, by_source = defaultdict(_EvaluationAccumulator), defaultdict(_EvaluationAccumulator)
    states = [candidate.state for candidate in candidates]
    candidate_lookup = {state: index for index, state in enumerate(states)}
    for start in range(0, len(windows), config.batch_size):
        sample = windows[start:start + config.batch_size]
        batch = _batch(sample, codec, device)
        # Transfer once per batch. Per-event scalar reads on MPS/CUDA otherwise
        # synchronize the accelerator thousands of times during diagnostics.
        output = {
            head: value.cpu()
            for head, value in model(batch["categories"], batch["bits"], batch["styles"], batch["padding"]).items()
        }
        batch = {
            name: batch[name].cpu()
            for name in ("targets", "target_bits", "known")
        }
        logp, components = _log_probabilities(output, batch, codec)
        rankings = _candidate_scores(output, codec, states)
        predictions = {head: output[head].argmax(-1) for head in CAT_HEADS}
        binary = output["bits"] >= 0
        for row, window in enumerate(sample):
            style = codec.vocabulary["styles"][window["style"]]
            for position, active in enumerate(window["loss_mask"]):
                if not active:
                    continue
                state = window["states"][position]
                target_index = candidate_lookup.get(state)
                rank = None
                if target_index is not None:
                    values = rankings[row, position]
                    target = values[target_index]
                    greater = int((values > target + 1e-6).sum())
                    tied = int((torch.abs(values - target) <= 1e-6).sum())
                    rank = 1 + greater + (tied - 1) / 2
                categorical_correct = {
                    head: int(predictions[head][row, position] == batch["targets"][row, position, index])
                    for index, head in enumerate(CAT_HEADS)
                    if bool(batch["known"][row, position, index])
                }
                multilabel_counts = {}
                offset = 0
                for head in MULTI_HEADS:
                    count = len(codec.vocabulary[head])
                    predicted = binary[row, position, offset:offset + count]
                    truth = batch["target_bits"][row, position, offset:offset + count] > 0
                    multilabel_counts[head] = (
                        int((predicted & truth).sum()),
                        int((predicted & ~truth).sum()),
                        int((~predicted & truth).sum()),
                    )
                    offset += count
                event_logp = float(logp[row, position])
                head_logp = {head: float(value[row, position]) for head, value in components.items()}
                for accumulator in (accumulators["overall"], by_style[style], by_source[window["source"]]):
                    accumulator.events += 1
                    accumulator.log_probability += event_logp
                    for head, value in head_logp.items():
                        accumulator.head_log_probability[head] += value
                    for head, correct in categorical_correct.items():
                        accumulator.categorical_correct[head] += correct
                    for head, (true_positive, false_positive, false_negative) in multilabel_counts.items():
                        accumulator.multilabel_true_positive[head] += true_positive
                        accumulator.multilabel_false_positive[head] += false_positive
                        accumulator.multilabel_false_negative[head] += false_negative
                    if rank is not None:
                        accumulator.rankable += 1
                        accumulator.reciprocal_rank += 1 / rank
                        accumulator.top1 += int(rank <= 1)
                        accumulator.top3 += int(rank <= 3)
    return {
        "overall": accumulators["overall"].result(),
        "by_style": {name: value.result() for name, value in sorted(by_style.items())},
        "by_source": {name: value.result() for name, value in sorted(by_source.items())},
    }


def _verify_sources(manifest_path: Path, manifest: Mapping) -> dict:
    hashes = {"corpus_manifest": _sha256(manifest_path)}
    for source, info in sorted(manifest["sources"].items()):
        path = (manifest_path.parent / info["songs_path"]).resolve()
        actual = _sha256(path)
        if actual != info["songs_sha256"]:
            raise ValueError(f"source JSONL checksum changed after integration: {source}")
        hashes[f"songs_jsonl:{source}"] = actual
    return hashes


def _write_json(path: Path, value: Mapping) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def _run_id(config: Config, hashes: Mapping) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    digest = hashlib.sha256(json.dumps({"config": asdict(config), "hashes": hashes}, sort_keys=True).encode()).hexdigest()[:10]
    return f"{stamp}-{digest}"


def _register_run(output_root: Path, run: Mapping) -> None:
    index_path = output_root / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {"schema_version": 1, "models": {}}
    if index.get("schema_version") != 1:
        raise ValueError("unsupported model index")
    entries = index["models"].setdefault(MODEL_VERSION, [])
    if any(entry["run_id"] == run["run_id"] for entry in entries):
        return
    entries.append({
        "run_id": run["run_id"],
        "path": f"{MODEL_VERSION}/{run['run_id']}",
        "checkpoint_sha256": run["checkpoint_sha256"],
        "best_epoch": run["best_epoch"],
        "validation_nll": run["best_validation_nll"],
        "created_utc": run["created_utc"],
    })
    _write_json(index_path, index)


def train(manifest_path: Path, candidate_path: Path, output_root: Path, config: Config, *, command=None) -> dict:
    config.validate()
    model_index = json.loads(MODEL_INDEX_PATH.read_text(encoding="utf-8"))
    if model_index.get("schema_version") != 1 or model_index["models"][MODEL_VERSION]["checkpoint_schema"] != CHECKPOINT_SCHEMA:
        raise ValueError("model version index mismatch")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schema_version") != 1 or manifest.get("dataset") != "integrated_corpora":
        raise ValueError("unsupported integrated corpus manifest")
    hashes = _verify_sources(manifest_path, manifest)
    hashes["candidate_manifest"] = _sha256(candidate_path)
    sequences = load_integrated_sequences(manifest_path)
    vocabulary = make_vocabulary(sequences)
    codec = Codec(vocabulary)
    candidates = load_candidate_manifest(candidate_path)
    by_split = {split: make_windows([s for s in sequences if s.split == split], codec, config.context) for split in ("train", "validation", "test")}
    if not by_split["validation"] or not by_split["test"]:
        raise ValueError("validation and test splits require complete sequences")
    torch.manual_seed(config.seed)
    random.seed(config.seed)
    device = _device(config.device)
    model = HarmonyTransformer(config, vocabulary).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=config.learning_rate, weight_decay=config.weight_decay)
    scheduler = (
        torch.optim.lr_scheduler.ReduceLROnPlateau(
            optimizer, mode="min", factor=config.lr_factor,
            patience=config.lr_patience, threshold=config.lr_threshold,
            threshold_mode="rel", min_lr=config.min_learning_rate,
        )
        if config.lr_schedule == "plateau" else None
    )
    version_root = output_root / MODEL_VERSION
    version_root.mkdir(parents=True, exist_ok=True)
    run_id = _run_id(config, hashes)
    run_dir = version_root / run_id
    run_dir.mkdir(exist_ok=False)
    run_manifest = {
        "schema_version": 1, "model_version": MODEL_VERSION, "checkpoint_schema": CHECKPOINT_SCHEMA,
        "run_id": run_id, "status": "running", "created_utc": datetime.now(timezone.utc).isoformat(),
        "config": asdict(config), "vocabulary": vocabulary, "input_sha256": hashes,
        "lr_scheduler_metric": "validation_nll" if scheduler is not None else None,
        "lr_scheduler_threshold_mode": "rel" if scheduler is not None else None,
        "model_index_sha256": _sha256(MODEL_INDEX_PATH),
        "dataset_version": manifest.get("dataset_version"), "adapter_version": manifest.get("adapter_version"),
        "split_seed": manifest.get("seed"), "candidate_version": json.loads(candidate_path.read_text(encoding="utf-8")).get("version"),
        "environment": {"python": sys.version.split()[0], "torch": torch.__version__, "platform": platform.platform(), "device": str(device)},
        "training_sequences": sum(s.split == "train" for s in sequences),
        "training_events": sum(len(s.states) for s in sequences if s.split == "train"),
        "command": list(command) if command else None,
    }
    _write_json(run_dir / "run_manifest.json", run_manifest)
    history = []
    best, stale = math.inf, 0
    try:
        for epoch in range(1, config.epochs + 1):
            learning_rate = optimizer.param_groups[0]["lr"]
            train_nll = _epoch(model, by_split["train"], codec, config, device, optimizer, config.seed + epoch)
            validation_nll = _epoch(model, by_split["validation"], codec, config, device)
            if scheduler is not None:
                scheduler.step(validation_nll)
            next_learning_rate = optimizer.param_groups[0]["lr"]
            history.append({
                "epoch": epoch, "train_nll": train_nll,
                "validation_nll": validation_nll,
                "learning_rate": learning_rate,
                "next_learning_rate": next_learning_rate,
            })
            _write_json(run_dir / "history.json", {"epochs": history})
            print(
                f"epoch {epoch}/{config.epochs}: train NLL {train_nll:.4f}, "
                f"validation NLL {validation_nll:.4f}, lr {learning_rate:.6g} -> {next_learning_rate:.6g}",
                flush=True,
            )
            if validation_nll < best:
                best, stale = validation_nll, 0
                checkpoint = {"checkpoint_schema": CHECKPOINT_SCHEMA, "model_version": MODEL_VERSION, "config": asdict(config), "vocabulary": vocabulary, "state_dict": model.state_dict(), "epoch": epoch}
                checkpoint_tmp = run_dir / "best.pt.tmp"
                torch.save(checkpoint, checkpoint_tmp)
                os.replace(checkpoint_tmp, run_dir / "best.pt")
            else:
                stale += 1
                if stale >= config.patience:
                    break
        model = load_model(run_dir / "best.pt", device)[0]
        evaluation = {split: evaluate(model, by_split[split], codec, candidates, config, device) for split in ("validation", "test")}
        _write_json(run_dir / "evaluation.json", {"schema_version": 1, "model_version": MODEL_VERSION, "results": evaluation})
    except KeyboardInterrupt:
        run_manifest.update({
            "status": "interrupted",
            "interrupted_utc": datetime.now(timezone.utc).isoformat(),
            "completed_epochs": len(history),
        })
        if (run_dir / "best.pt").is_file():
            run_manifest["checkpoint_sha256"] = _sha256(run_dir / "best.pt")
        _write_json(run_dir / "run_manifest.json", run_manifest)
        raise
    run_manifest.update({"status": "complete", "best_epoch": next(item["epoch"] for item in history if item["validation_nll"] == best), "best_validation_nll": best, "completed_utc": datetime.now(timezone.utc).isoformat(), "checkpoint_sha256": _sha256(run_dir / "best.pt")})
    _write_json(run_dir / "run_manifest.json", run_manifest)
    _register_run(output_root, run_manifest)
    return {"run_dir": str(run_dir), "run": run_manifest, "evaluation": evaluation}


def load_model(checkpoint_path: Path, device: torch.device):
    checkpoint = torch.load(checkpoint_path, map_location=device, weights_only=True)
    if checkpoint.get("checkpoint_schema") != CHECKPOINT_SCHEMA or checkpoint.get("model_version") != MODEL_VERSION:
        raise ValueError("unsupported Transformer checkpoint")
    config = Config(**checkpoint["config"])
    model = HarmonyTransformer(config, checkpoint["vocabulary"]).to(device)
    model.load_state_dict(checkpoint["state_dict"])
    model.eval()
    return model, Codec(checkpoint["vocabulary"]), config


class TransformerScorer:
    """Score complete candidate harmonies from a versioned local checkpoint."""

    def __init__(self, model: HarmonyTransformer, codec: Codec, config: Config, device: torch.device):
        self.model, self.codec, self.config, self.device = model, codec, config, device

    @classmethod
    def from_checkpoint(cls, checkpoint_path: Path, *, device_name: str = "auto") -> "TransformerScorer":
        device = _device(device_name)
        model, codec, config = load_model(checkpoint_path, device)
        return cls(model, codec, config, device)

    @torch.no_grad()
    def score_candidates(self, history: Sequence[FactorState], style: str, candidates: Sequence[FactorState]) -> list[float]:
        if not candidates:
            raise ValueError("candidate set must not be empty")
        if style != "free" and style not in self.codec.styles:
            raise ValueError(f"untrained style: {style}")
        if any(not all(self.codec.state(candidate)[3]) for candidate in candidates):
            raise ValueError("candidate has a categorical factor outside the model vocabulary")
        length = min(len(history) + 1, self.config.context)
        start = len(history) + 1 - length
        categories, bits = [], []
        for position in range(start, len(history) + 1):
            if position == 0:
                categories.append([1] * len(CAT_HEADS))
                bits.append([0.0] * self.codec.bit_count)
            else:
                encoded = self.codec.state(history[position - 1])
                categories.append([value + 2 for value in encoded[0]])
                bits.append(encoded[1])
        cats = torch.tensor([categories], dtype=torch.long, device=self.device)
        bit_tensor = torch.tensor([bits], dtype=torch.float32, device=self.device)
        padding = torch.zeros((1, length), dtype=torch.bool, device=self.device)
        styles = list(self.codec.styles) if style == "free" else [style]
        scores = []
        for name in styles:
            output = self.model(cats, bit_tensor, torch.tensor([self.codec.styles[name]], device=self.device), padding)
            scores.append(_candidate_scores(output, self.codec, candidates)[0, -1])
        combined = torch.logsumexp(torch.stack(scores), dim=0) - math.log(len(scores)) if len(scores) > 1 else scores[0]
        return combined.tolist()

    def score_candidate(self, history: Sequence[FactorState], style: str, candidate: FactorState) -> float:
        return self.score_candidates(history, style, [candidate])[0]

    def normalize_candidates(self, history: Sequence[FactorState], style: str, candidates: Sequence[FactorState]) -> list[float]:
        scores = self.score_candidates(history, style, candidates)
        normalizer = torch.logsumexp(torch.tensor(scores, dtype=torch.float64), dim=0).item()
        return [math.exp(score - normalizer) for score in scores]


def evaluate_run(run_dir: Path, manifest_path: Path, candidate_path: Path, *, device_name: str = "auto") -> dict:
    run = json.loads((run_dir / "run_manifest.json").read_text(encoding="utf-8"))
    if run.get("model_index_sha256") != _sha256(MODEL_INDEX_PATH):
        raise ValueError("model version index differs from the training run")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    hashes = _verify_sources(manifest_path, manifest)
    hashes["candidate_manifest"] = _sha256(candidate_path)
    if hashes != run["input_sha256"]:
        raise ValueError("evaluation input differs from the training run")
    if run.get("checkpoint_sha256") and _sha256(run_dir / "best.pt") != run["checkpoint_sha256"]:
        raise ValueError("evaluation input or checkpoint differs from the indexed run")
    device = _device(device_name)
    model, codec, config = load_model(run_dir / "best.pt", device)
    sequences = load_integrated_sequences(manifest_path)
    candidates = load_candidate_manifest(candidate_path)
    results = {split: evaluate(model, make_windows([s for s in sequences if s.split == split], codec, config.context), codec, candidates, config, device) for split in ("validation", "test")}
    return {"schema_version": 1, "model_version": MODEL_VERSION, "results": results}


def finalize_run(run_dir: Path, manifest_path: Path, candidate_path: Path, *, device_name: str = "cpu") -> dict:
    """Finish evaluation and indexing after a training process was interrupted."""
    run_path = run_dir / "run_manifest.json"
    run = json.loads(run_path.read_text(encoding="utf-8"))
    if run_dir.parent.name != MODEL_VERSION or run_dir.name != run.get("run_id"):
        raise ValueError("run directory does not match its model version and run ID")
    if run.get("status") == "complete":
        result = json.loads((run_dir / "evaluation.json").read_text(encoding="utf-8"))
        _register_run(run_dir.parent.parent, run)
        return result
    if run.get("status") not in {"running", "interrupted"} or not (run_dir / "best.pt").is_file():
        raise ValueError("run has no recoverable best checkpoint")
    checkpoint = torch.load(run_dir / "best.pt", map_location="cpu", weights_only=True)
    if checkpoint.get("model_version") != MODEL_VERSION or checkpoint.get("checkpoint_schema") != CHECKPOINT_SCHEMA:
        raise ValueError("unsupported best checkpoint")
    best_epoch = checkpoint["epoch"]
    history = json.loads((run_dir / "history.json").read_text(encoding="utf-8"))["epochs"]
    matching = [item for item in history if item["epoch"] == best_epoch]
    if len(matching) != 1 or checkpoint["config"] != run["config"]:
        raise ValueError("checkpoint does not match recorded training history")
    result = evaluate_run(run_dir, manifest_path, candidate_path, device_name=device_name)
    _write_json(run_dir / "evaluation.json", result)
    run.update({
        "status": "complete",
        "best_epoch": best_epoch,
        "best_validation_nll": matching[0]["validation_nll"],
        "completed_utc": datetime.now(timezone.utc).isoformat(),
        "checkpoint_sha256": _sha256(run_dir / "best.pt"),
        "recovered_after_interruption": True,
    })
    _write_json(run_path, run)
    _register_run(run_dir.parent.parent, run)
    return result
