"""Small, source-free checks for causal training and indexed checkpoints."""
import json
from dataclasses import replace
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from harmony_model.baseline import CorpusSequence, FactorState

try:
    import torch
    from harmony_model import transformer as t
except ImportError:
    torch = None


@unittest.skipIf(torch is None, "install the optional train dependency")
class TransformerTests(unittest.TestCase):
    def setUp(self):
        self.c = FactorState(1, 0, "major", "none")
        self.g = FactorState(5, 0, "major", "minor7")
        self.f = FactorState(4, 0, "major", "none")
        self.sequences = [
            CorpusSequence("train-pop", "work-pop", "train", "pop", (self.c, self.g, self.c, self.f)),
            CorpusSequence("train-jazz", "work-jazz", "train", "jazz", (self.g, self.c, self.f, self.g)),
            CorpusSequence("val", "work-val", "validation", "pop", (self.c, self.g)),
            CorpusSequence("test", "work-test", "test", "jazz", (self.g, self.c)),
        ]

    def fixture(self, root):
        source = root / "source.jsonl"
        source.write_text("fixture\n", encoding="utf-8")
        manifest = root / "corpus_manifest.json"
        manifest.write_text(json.dumps({
            "schema_version": 1, "dataset": "integrated_corpora", "dataset_version": "v1",
            "adapter_version": "fixture", "seed": "fixture-split",
            "sources": {"fixture": {"songs_path": "source.jsonl", "songs_sha256": t._sha256(source)}},
        }), encoding="utf-8")
        candidates = root / "candidates.json"
        candidates.write_text(json.dumps({"version": "fixture-v1", "nodes": [
            ["C", 1, 0, "major", "none", [], [], None],
            ["G7", 5, 0, "major", "minor7", [], [], None],
            ["F", 4, 0, "major", "none", [], [], None],
        ]}), encoding="utf-8")
        return manifest, candidates

    def test_windows_cover_targets_once_without_crossing_sequences(self):
        self.assertEqual(t.Config().context, 32)
        codec = t.Codec(t.make_vocabulary(self.sequences))
        windows = t.make_windows(self.sequences[:1], codec, 3)
        self.assertEqual(sum(sum(w["loss_mask"]) for w in windows), 4)
        self.assertEqual(windows[0]["categories"][0], [1, 1, 1, 1])
        self.assertEqual(len(windows[0]["states"]), 1)
        self.assertEqual(windows[-1]["states"][-1], self.f)

    def test_causal_mask_and_padding_ignore_future_targets(self):
        torch.manual_seed(11)
        codec = t.Codec(t.make_vocabulary(self.sequences))
        config = t.Config(context=4, d_model=16, layers=1, heads=4, dropout=0)
        model = t.HarmonyTransformer(config, codec.vocabulary).eval()
        left = t._batch(t.make_windows([self.sequences[0]], codec, 4)[-1:], codec, torch.device("cpu"))
        changed = CorpusSequence("changed", "work-pop", "train", "pop", (self.c, self.g, self.f, self.f))
        right = t._batch(t.make_windows([changed], codec, 4)[-1:], codec, torch.device("cpu"))
        with torch.no_grad():
            a = model(left["categories"], left["bits"], left["styles"], left["padding"])
            b = model(right["categories"], right["bits"], right["styles"], right["padding"])
        # Altering event 3 cannot affect predictions for events 1-3.
        for head in (*t.CAT_HEADS, "bits"):
            torch.testing.assert_close(a[head][0, :3], b[head][0, :3], atol=1e-6, rtol=0)

    def test_training_checkpoint_index_and_re_evaluation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest, candidates = self.fixture(root)
            config = t.Config(context=4, d_model=16, layers=1, heads=4, dropout=0,
                              batch_size=2, epochs=1, patience=1, device="cpu")
            with patch.object(t, "load_integrated_sequences", return_value=self.sequences):
                result = t.train(manifest, candidates, root / "runs", config)
                rerun = t.evaluate_run(Path(result["run_dir"]), manifest, candidates, device_name="cpu")
            index = json.loads((root / "runs/index.json").read_text())
            self.assertEqual(index["models"][t.MODEL_VERSION][0]["run_id"], result["run"]["run_id"])
            self.assertEqual(result["run"]["status"], "complete")
            self.assertEqual(rerun["results"]["test"]["overall"]["events"], 2)
            self.assertEqual(rerun["results"]["test"]["overall"]["nll"], result["evaluation"]["test"]["overall"]["nll"])
            scorer = t.TransformerScorer.from_checkpoint(Path(result["run_dir"]) / "best.pt", device_name="cpu")
            probabilities = scorer.normalize_candidates([self.c], "free", [self.c, self.g, self.f])
            self.assertAlmostEqual(sum(probabilities), 1.0)
            self.assertEqual(len(probabilities), 3)
            before = set((root / "runs" / t.MODEL_VERSION).iterdir())
            with patch.object(t, "load_integrated_sequences", return_value=self.sequences):
                with patch.object(t, "_epoch", side_effect=KeyboardInterrupt):
                    with self.assertRaises(KeyboardInterrupt):
                        t.train(manifest, candidates, root / "runs", config)
            interrupted_dir, = set((root / "runs" / t.MODEL_VERSION).iterdir()) - before
            interrupted = json.loads((interrupted_dir / "run_manifest.json").read_text())
            self.assertEqual(interrupted["status"], "interrupted")
            self.assertEqual(interrupted["completed_epochs"], 0)
            self.assertEqual(len(json.loads((root / "runs/index.json").read_text())["models"][t.MODEL_VERSION]), 1)
            before = set((root / "runs" / t.MODEL_VERSION).iterdir())
            with patch.object(t, "load_integrated_sequences", return_value=self.sequences):
                with patch.object(t, "_epoch", side_effect=[1.0, 1.0, KeyboardInterrupt]):
                    with self.assertRaises(KeyboardInterrupt):
                        t.train(manifest, candidates, root / "runs", replace(config, epochs=2))
                recoverable_dir, = set((root / "runs" / t.MODEL_VERSION).iterdir()) - before
                recovered = t.finalize_run(recoverable_dir, manifest, candidates, device_name="cpu")
            self.assertEqual(recovered["results"]["test"]["overall"]["events"], 2)
            recovered_manifest = json.loads((recoverable_dir / "run_manifest.json").read_text())
            self.assertEqual(recovered_manifest["status"], "complete")
            self.assertEqual(recovered_manifest["best_epoch"], 1)
            self.assertEqual(len(json.loads((root / "runs/index.json").read_text())["models"][t.MODEL_VERSION]), 2)

    def test_plateau_scheduler_steps_on_validation_nll(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest, candidates = self.fixture(root)
            config = t.Config(
                context=4, d_model=16, layers=1, heads=4, dropout=0,
                batch_size=2, epochs=3, patience=4, device="cpu",
                lr_schedule="plateau", lr_factor=0.5, lr_patience=0,
            )
            with patch.object(t, "load_integrated_sequences", return_value=self.sequences):
                with patch.object(t, "_epoch", side_effect=[2.0, 1.0, 1.9, 1.0, 1.8, 1.0]):
                    result = t.train(manifest, candidates, root / "runs", config)
            history = json.loads((Path(result["run_dir"]) / "history.json").read_text())["epochs"]
            self.assertEqual([entry["learning_rate"] for entry in history], [0.0003, 0.0003, 0.00015])
            self.assertEqual([entry["next_learning_rate"] for entry in history], [0.0003, 0.00015, 0.000075])
            self.assertEqual(result["run"]["lr_scheduler_metric"], "validation_nll")

    def test_local_preview_scores_indexed_checkpoint_and_groups_bass_variants(self):
        from harmony_model.preview_server import PreviewService

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest, candidates = self.fixture(root)
            value = json.loads(candidates.read_text(encoding="utf-8"))
            value["nodes"].append(["C/E", 1, 0, "major", "none", [], [], [3, 0]])
            candidates.write_text(json.dumps(value), encoding="utf-8")
            config = t.Config(context=4, d_model=16, layers=1, heads=4, dropout=0,
                              batch_size=2, epochs=1, patience=1, device="cpu")
            with patch.object(t, "load_integrated_sequences", return_value=self.sequences):
                result = t.train(manifest, candidates, root / "runs", config)
            service = PreviewService(root / "runs", candidates)
            run_id = result["run"]["run_id"]
            self.assertEqual(service.models()["runs"][0]["run_id"], run_id)
            prediction = service.predict({"run_id": run_id, "style": "pop", "history": ["C"]})
            self.assertEqual(len(prediction["candidates"]), 3)
            self.assertEqual(prediction["history_used"], 1)
            self.assertAlmostEqual(sum(item["probability"] for item in prediction["candidates"]), 1)
            self.assertIn(["C", "C/E"], [item["ids"] for item in prediction["candidates"]])
            with self.assertRaisesRegex(ValueError, "known Harmonic Space IDs"):
                service.predict({"run_id": run_id, "style": "pop", "history": ["missing"]})
            with patch.object(t, "load_integrated_sequences", return_value=self.sequences):
                newer = t.train(manifest, candidates, root / "runs", replace(config, context=5))
            newer_id = newer["run"]["run_id"]
            self.assertEqual(len(service.models()["runs"]), 2)
            long_history = ["F", "C", "G7", "F", "C", "G7"]
            request = {"run_id": newer_id, "style": "pop", "history": long_history}
            long_prediction = service.predict(request)
            short_prediction = service.predict({**request, "history": long_history[-5:]})
            self.assertEqual(long_prediction["context"], 5)
            self.assertEqual(long_prediction["history_used"], 5)
            self.assertEqual(long_prediction["candidates"], short_prediction["candidates"])

    def test_invalid_scheduler_settings_are_rejected(self):
        for config in (
            t.Config(lr_schedule="unknown"),
            t.Config(lr_factor=1.0),
            t.Config(lr_patience=-1),
            t.Config(min_learning_rate=0.001),
        ):
            with self.assertRaises(ValueError):
                config.validate()


if __name__ == "__main__":
    unittest.main()
