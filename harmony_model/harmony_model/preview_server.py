"""Loopback-only checkpoint inference for the local Harmonic Space test page."""
from __future__ import annotations

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from threading import Lock
from typing import Sequence
from urllib.parse import urlsplit

from .baseline import _sha256, load_candidate_manifest
from .transformer import MODEL_VERSION, TransformerScorer


class PreviewService:
    def __init__(
        self, output_root: Path, candidate_path: Path, *, device: str = "cpu",
        additional_roots: Sequence[Path] = (),
    ):
        self.output_roots = tuple(root.resolve() for root in (output_root, *additional_roots))
        self.candidate_path = candidate_path.resolve()
        candidate_manifest = json.loads(candidate_path.read_text(encoding="utf-8"))
        self.candidate_version = candidate_manifest["version"]
        self.candidate_sha256 = _sha256(candidate_path)
        self.candidates = load_candidate_manifest(candidate_path)
        self.by_id = {
            identifier: candidate.state
            for candidate in self.candidates for identifier in candidate.ids
        }
        self.device = device
        self._lock = Lock()
        self._scorers: dict[str, TransformerScorer] = {}
        self.runs = {}
        self._refresh_runs()
        if not self.runs:
            raise ValueError("no completed indexed Transformer runs match the candidate manifest")

    def _refresh_runs(self) -> None:
        runs = {}
        for output_root in self.output_roots:
            index_path = output_root / "index.json"
            if not index_path.is_file():
                continue
            index = json.loads(index_path.read_text(encoding="utf-8"))
            for entry in index["models"].get(MODEL_VERSION, []):
                run_dir = (output_root / entry["path"]).resolve()
                if not run_dir.is_relative_to(output_root / MODEL_VERSION):
                    continue
                manifest_path = run_dir / "run_manifest.json"
                checkpoint_path = run_dir / "best.pt"
                if not manifest_path.is_file() or not checkpoint_path.is_file():
                    continue
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                if (manifest.get("status") != "complete"
                        or manifest.get("run_id") != entry["run_id"]
                        or manifest.get("model_version") != MODEL_VERSION
                        or manifest.get("input_sha256", {}).get("candidate_manifest") != self.candidate_sha256):
                    continue
                styles = manifest.get("vocabulary", {}).get("styles")
                if not isinstance(styles, list) or not styles or any(
                    style not in {"pop", "jazz", "classical"} for style in styles
                ):
                    continue
                if entry["run_id"] in runs:
                    raise ValueError(f"duplicate indexed run ID: {entry['run_id']}")
                runs[entry["run_id"]] = {
                    "checkpoint": checkpoint_path,
                    "checkpoint_sha256": manifest["checkpoint_sha256"],
                    "dataset_version": manifest["dataset_version"],
                    "trained_styles": styles,
                    "config": manifest["config"],
                    "validation_nll": manifest["best_validation_nll"],
                    "best_epoch": manifest["best_epoch"],
                    "created_utc": manifest["created_utc"],
                }
        with self._lock:
            previous = self.runs
            self._scorers = {
                run_id: scorer for run_id, scorer in self._scorers.items()
                if run_id in runs and previous[run_id]["checkpoint_sha256"] == runs[run_id]["checkpoint_sha256"]
            }
            self.runs = runs

    def models(self) -> dict:
        self._refresh_runs()
        runs = [
            {
                "run_id": run_id,
                "dataset_version": value["dataset_version"],
                "trained_styles": value["trained_styles"],
                "validation_nll": value["validation_nll"],
                "best_epoch": value["best_epoch"],
                "created_utc": value["created_utc"],
                "config": value["config"],
            }
            for run_id, value in self.runs.items()
        ]
        runs.sort(key=lambda run: (run["validation_nll"], run["run_id"]))
        return {
            "model_version": MODEL_VERSION,
            "candidate_version": self.candidate_version,
            "candidate_ids": sorted(self.by_id),
            "runs": runs,
        }

    def predict(self, request: dict) -> dict:
        if not isinstance(request, dict):
            raise ValueError("request must be an object")
        run_id, style, history = (request.get(name) for name in ("run_id", "style", "history"))
        if not isinstance(run_id, str) or run_id not in self.runs:
            raise ValueError("unknown indexed run ID")
        if style not in ("free", "pop", "jazz", "classical"):
            raise ValueError("unknown style")
        if style != "free" and style not in self.runs[run_id]["trained_styles"]:
            raise ValueError(f"untrained style: {style}")
        max_history = max(256, int(self.runs[run_id]["config"]["context"]))
        if not isinstance(history, list) or len(history) > max_history or any(
            not isinstance(identifier, str) or identifier not in self.by_id
            for identifier in history
        ):
            raise ValueError(f"history must contain at most {max_history} known Harmonic Space IDs")
        with self._lock:
            if run_id not in self._scorers:
                run = self.runs[run_id]
                if _sha256(run["checkpoint"]) != run["checkpoint_sha256"]:
                    raise ValueError("checkpoint checksum differs from its run manifest")
                self._scorers[run_id] = TransformerScorer.from_checkpoint(
                    run["checkpoint"], device_name=self.device
                )
            scorer = self._scorers[run_id]
            states = [self.by_id[identifier] for identifier in history]
            probabilities = scorer.normalize_candidates(
                states, style, [candidate.state for candidate in self.candidates]
            )
        ranked = sorted(
            zip(self.candidates, probabilities),
            key=lambda item: (-item[1], item[0].ids[0]),
        )
        return {
            "run_id": run_id,
            "model_version": MODEL_VERSION,
            "candidate_version": self.candidate_version,
            "context": scorer.config.context,
            "history_used": min(len(history), scorer.config.context),
            "style": style,
            "candidates": [
                {"ids": list(candidate.ids), "rank": rank, "probability": probability}
                for rank, (candidate, probability) in enumerate(ranked, 1)
            ],
        }


def make_handler(service: PreviewService):
    class Handler(BaseHTTPRequestHandler):
        def _reply(self, status: int, payload: dict) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                # React StrictMode and navigation can cancel an in-flight fetch.
                pass

        def do_GET(self) -> None:
            if urlsplit(self.path).path != "/model-api/models":
                self._reply(404, {"error": "unknown endpoint"})
                return
            self._reply(200, service.models())

        def do_POST(self) -> None:
            if urlsplit(self.path).path != "/model-api/predict":
                self._reply(404, {"error": "unknown endpoint"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 32768:
                    raise ValueError("request body must be 1–32768 bytes")
                request = json.loads(self.rfile.read(length))
                result = service.predict(request)
            except (ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
                self._reply(400, {"error": str(error)})
                return
            self._reply(200, result)

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(description="Local Transformer preview API for model-test.html")
    parser.add_argument("--output-root", type=Path, default=Path("runs/transformer"))
    parser.add_argument(
        "--additional-output-root", type=Path, action="append",
        default=[Path("runs/transformer-pop-jazz")],
    )
    parser.add_argument("--candidate-manifest", type=Path, default=Path("datasets/chordscape_candidates.v1.json"))
    parser.add_argument("--device", choices=("cpu", "mps", "cuda", "auto"), default="cpu")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    service = PreviewService(
        args.output_root, args.candidate_manifest,
        device=args.device, additional_roots=args.additional_output_root,
    )
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(service))
    print(f"Model preview API: http://127.0.0.1:{args.port}/model-api/models", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
