import json
from math import isfinite
from pathlib import Path
import tempfile
import unittest

from harmony_model.baseline import (
    BaselineBundle,
    FactorState,
    FactorizedMarkovModel,
    load_bundle,
    load_sequences,
    mixture_log_probability,
    train_baselines,
)


A = FactorState(1, 0, "major", "none")
B = FactorState(5, 0, "major", "minor7")
C = FactorState(6, 0, "minor", "none")
ADD9 = FactorState(1, 0, "major", "none", (9,))
UNKNOWN_CONTEXT = FactorState(7, 2, "diminished", "diminished7")


def event(state, style="pop"):
    return {
        "parsed": {"status": "ok"},
        "factors": {
            "root": {"degree": state.degree, "accidental": state.accidental},
            "components": {
                "quality": state.quality,
                "seventh": state.seventh,
                "extensions": list(state.extensions),
                "alterations": list(state.alterations),
            },
        },
        "style": style,
    }


class FactorizedMarkovTests(unittest.TestCase):
    def model(self, order=2):
        sequences = [[A, B]] * 20 + [[C, A]] * 20 + [[A, ADD9]]
        return FactorizedMarkovModel(order, "pop", alpha=0.5).fit(sequences)

    def test_finite_scores_and_unknown_context_backoff(self):
        model = self.model(2)
        result = model.score_breakdown([UNKNOWN_CONTEXT, UNKNOWN_CONTEXT], B)
        self.assertTrue(isfinite(result["log_probability"]))
        self.assertEqual(result["context_order"], 0)

    def test_categorical_probability_sums_and_candidate_normalization(self):
        model = self.model(1)
        for head in ("degree", "accidental", "quality", "seventh"):
            self.assertAlmostEqual(sum(model.categorical_distribution([A], head).values()), 1)
        bundle = BaselineBundle(1, {"pop": model})
        probabilities = bundle.normalize_candidates([A], "pop", [A, B, C])
        self.assertAlmostEqual(sum(probabilities), 1)
        self.assertTrue(all(0 < value < 1 for value in probabilities))

    def test_negative_multilabel_terms_are_scored(self):
        model = FactorizedMarkovModel(0, "pop", alpha=0.5).fit([[A] * 9 + [ADD9]])
        absent = model.score_breakdown([], A)
        present = model.score_breakdown([], ADD9)
        self.assertIn("extensions:9:absent", absent["heads"])
        self.assertIn("extensions:9:present", present["heads"])
        self.assertGreater(absent["log_probability"], present["log_probability"])

    def test_history_changes_ranking(self):
        model = self.model(1)
        self.assertGreater(
            model.score_candidate([A], "pop", B),
            model.score_candidate([C], "pop", B),
        )
        prediction = model.predict([A])
        self.assertEqual(prediction["context_order"], 1)
        self.assertEqual(prediction["categorical"]["degree"], "5")

    def test_candidate_set_changes_only_conditional_normalization(self):
        model = self.model(1)
        bundle = BaselineBundle(1, {"pop": model})
        raw = bundle.score_candidate([A], "pop", A)
        two = bundle.normalize_candidates([A], "pop", [A, B])[0]
        three = bundle.normalize_candidates([A], "pop", [A, B, C])[0]
        self.assertEqual(raw, bundle.score_candidate([A], "pop", A))
        self.assertNotEqual(two, three)

    def test_free_mixture_is_independent_of_mapping_order(self):
        left = mixture_log_probability(
            {"pop": -1.0, "jazz": -2.0}, {"pop": 2.0, "jazz": 1.0}
        )
        right = mixture_log_probability(
            {"jazz": -2.0, "pop": -1.0}, {"jazz": 1.0, "pop": 2.0}
        )
        self.assertAlmostEqual(left, right)

    def test_round_trip_preserves_scores(self):
        bundle = BaselineBundle(2, {"pop": self.model(2)})
        restored = BaselineBundle.from_dict(bundle.to_dict())
        self.assertAlmostEqual(
            bundle.score_candidate([A, B], "pop", C),
            restored.score_candidate([A, B], "pop", C),
        )


class BaselinePipelineTests(unittest.TestCase):
    def make_inputs(self, directory):
        root = Path(directory)
        songs_path = root / "songs.jsonl"
        split_path = root / "split.json"
        candidate_path = root / "candidates.json"
        records = []
        works = {}
        for index, split in enumerate(("train", "validation", "test"), 1):
            song_id = f"song-{index}"
            work_id = f"work-{index}"
            records.append({
                "song": {
                    "song_id": song_id,
                    "work_id": work_id,
                    "events": [event(A), event(B), event(C)],
                },
                "split": split,
                "boundaries": [],
            })
            works[work_id] = {"split": split, "song_ids": [song_id]}
        songs_path.write_text(
            "".join(json.dumps(record) + "\n" for record in records), encoding="utf-8"
        )
        split_path.write_text(
            json.dumps({"seed": "fixed-seed", "works": works}), encoding="utf-8"
        )
        candidate_path.write_text(json.dumps({
            "nodes": [
                ["a", 1, 0, "major", "none", [], [], None],
                ["b", 5, 0, "major", "minor7", [], [], None],
                ["c", 6, 0, "minor", "none", [], [], None],
            ]
        }), encoding="utf-8")
        return songs_path, split_path, candidate_path

    def test_boundaries_split_sequences_before_training(self):
        with tempfile.TemporaryDirectory() as directory:
            songs, split, _ = self.make_inputs(directory)
            records = [json.loads(line) for line in songs.read_text().splitlines()]
            records[0]["boundaries"] = [{"event_index": 1, "reason": "silence"}]
            songs.write_text(
                "".join(json.dumps(record) + "\n" for record in records), encoding="utf-8"
            )
            sequences = [item for item in load_sequences(songs, split) if item.split == "train"]
        self.assertEqual([sequence.states for sequence in sequences], [(A,), (B, C)])

    def test_end_to_end_training_evaluation_and_artifact_reload(self):
        with tempfile.TemporaryDirectory() as directory:
            songs, split, candidates = self.make_inputs(directory)
            output = Path(directory) / "run"
            report = train_baselines(
                songs, split, candidates, output, command=["test-baselines"]
            )
            model = load_bundle(output / "markov2.json")
            evaluation = json.loads((output / "evaluation.json").read_text())
            run = json.loads((output / "run_manifest.json").read_text())
            self.assertEqual(model.order, 2)
            self.assertTrue(isfinite(model.score_candidate([A, B], "pop", C)))
            self.assertEqual(run["split_seed"], "fixed-seed")
            self.assertEqual(run["command"], ["test-baselines"])
            self.assertEqual(evaluation["orders"]["2"]["test"]["overall"]["events"], 3)
            self.assertIn(
                "degree",
                evaluation["orders"]["2"]["test"]["overall"]["categorical_accuracy"],
            )
            self.assertIn(
                "precision",
                evaluation["orders"]["2"]["test"]["overall"]["multilabel"]["extensions"],
            )
            self.assertEqual(report["evaluation"], evaluation)
            self.assertTrue((output / "unigram.json").is_file())
            self.assertTrue((output / "markov1.json").is_file())


if __name__ == "__main__":
    unittest.main()
