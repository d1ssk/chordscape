"""Export the reviewed pop/jazz checkpoint as static browser inference weights."""

import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import torch

from harmony_model.baseline import load_candidate_manifest


REPO = ROOT.parent
RUN_ID = "20260920T093553350268Z-045b33e287"
RUN_DIR = ROOT / "runs" / "transformer-pop-jazz" / "transformer-v1" / RUN_ID
CORPUS = ROOT / "data" / "processed" / "integrated-public-pop-jazz-v1" / "corpus_manifest.json"
CANDIDATES = ROOT / "datasets" / "chordscape_candidates.v1.json"
OUTPUT = REPO / "public" / "model"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    run_path = RUN_DIR / "run_manifest.json"
    run = json.loads(run_path.read_text(encoding="utf-8"))
    checkpoint_path = RUN_DIR / "best.pt"
    if (run["status"] != "complete" or run["run_id"] != RUN_ID
            or run["dataset_version"] != "public-pop-jazz-v1"
            or run["config"]["context"] != 48
            or run["vocabulary"]["styles"] != ["jazz", "pop"]):
        raise ValueError("unexpected pop/jazz run")
    if (sha256(checkpoint_path) != run["checkpoint_sha256"]
            or sha256(CORPUS) != run["input_sha256"]["corpus_manifest"]
            or sha256(CANDIDATES) != run["input_sha256"]["candidate_manifest"]):
        raise ValueError("training input or checkpoint checksum changed")
    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
    if checkpoint["vocabulary"] != run["vocabulary"]:
        raise ValueError("checkpoint vocabulary differs from run manifest")

    tensors = {}
    weights = bytearray()
    for name, tensor in checkpoint["state_dict"].items():
        data = tensor.detach().to(dtype=torch.float32, device="cpu").contiguous().numpy().tobytes()
        tensors[name] = {"offset": len(weights), "shape": list(tensor.shape)}
        weights.extend(data)
    candidates = [
        {
            "ids": list(candidate.ids),
            "state": [
                candidate.state.degree, candidate.state.accidental,
                candidate.state.quality, candidate.state.seventh,
                list(candidate.state.extensions), list(candidate.state.alterations),
            ],
        }
        for candidate in load_candidate_manifest(CANDIDATES)
    ]
    OUTPUT.mkdir(parents=True, exist_ok=True)
    binary_path = OUTPUT / "pop-jazz-v1.bin"
    binary_path.write_bytes(weights)
    metadata = {
        "schema_version": 1,
        "model_version": run["model_version"],
        "run_id": RUN_ID,
        "dataset_version": run["dataset_version"],
        "checkpoint_sha256": run["checkpoint_sha256"],
        "corpus_manifest_sha256": run["input_sha256"]["corpus_manifest"],
        "candidate_manifest_sha256": run["input_sha256"]["candidate_manifest"],
        "candidate_version": json.loads(CANDIDATES.read_text(encoding="utf-8"))["version"],
        "config": {"context": run["config"]["context"], "d_model": run["config"]["d_model"],
                   "layers": run["config"]["layers"], "heads": run["config"]["heads"]},
        "vocabulary": run["vocabulary"],
        "candidates": candidates,
        "weights_file": binary_path.name,
        "weights_sha256": hashlib.sha256(weights).hexdigest(),
        "tensors": tensors,
        "notice": "TRAINING_DATA.md",
    }
    (OUTPUT / "pop-jazz-v1.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Exported {RUN_ID}: {len(weights)} bytes, {len(tensors)} tensors, {len(candidates)} candidates")


if __name__ == "__main__":
    main()
