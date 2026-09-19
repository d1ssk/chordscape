import json
from pathlib import Path
import tempfile
import unittest

from harmony_model.baseline import FactorState, load_integrated_sequences
from harmony_model.integration import build_integrated_manifest


A = FactorState(1, 0, "major", "none")
B = FactorState(5, 0, "major", "minor7")
C = FactorState(6, 0, "minor", "none")


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


def unusable_event():
    return {"parsed": {"status": "partial"}, "factors": None, "style": "pop"}


def write_source(root, directory, dataset, rows):
    output = root / directory
    output.mkdir()
    (output / "songs.jsonl").write_text(
        "".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8"
    )
    works = {
        row["song"]["work_id"]: {
            "split": "train",
            "song_ids": [row["song"]["song_id"]],
        }
        for row in rows
    }
    (output / "split_manifest.json").write_text(
        json.dumps({
            "dataset": dataset,
            "dataset_version": "test",
            "adapter_version": "test-v1",
            "works": works,
        }),
        encoding="utf-8",
    )


def row(dataset, identifier, states, *, title, creator, pop_id=None):
    metadata = {"pop909_id": pop_id} if pop_id else {}
    return {
        "song": {
            "song_id": f"{dataset}-{identifier}",
            "work_id": f"pop909-work-{identifier}" if pop_id else f"{dataset}-work-{identifier}",
            "events": [event(state) if isinstance(state, FactorState) else unusable_event() for state in states],
        },
        "boundaries": [],
        "split": "train",
        "title": title,
        "creator": creator,
        "source_partition": dataset,
        "metadata": metadata,
    }


class CorpusIntegrationTests(unittest.TestCase):
    def test_corrected_pop_priority_family_split_and_exact_deduplication(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "processed"
            root.mkdir()
            write_source(root, "pop909-v1", "pop909", [
                row("pop", "001", [A, B], title="001", creator="", pop_id="001"),
                row("pop", "002", [C, A], title="002", creator="", pop_id="002"),
            ])
            write_source(root, "pop909_cl-v1", "pop909_cl", [
                row("cl", "001", [A, C], title="001", creator="", pop_id="001"),
                row("cl", "002", [None], title="002", creator="", pop_id="002"),
            ])
            identical = row(
                "copy-a", "song", [A, B], title="Shared Song", creator="Same Writer"
            )
            duplicate = row(
                "copy-b", "song", [A, B], title="Shared Song", creator="Same Writer"
            )
            write_source(root, "copy-a-v1", "copy_a", [identical])
            write_source(root, "copy-b-v1", "copy_b", [duplicate])
            output = root / "integrated-v1"
            manifest = build_integrated_manifest(root, output, seed="test-seed")

            selected = {
                (entry["source"], entry["song_id"])
                for entry in manifest["songs"].values()
                if entry["selected"]
            }
            self.assertIn(("pop909_cl", "cl-001"), selected)
            self.assertIn(("pop909", "pop-002"), selected)
            self.assertNotIn(("pop909", "pop-001"), selected)
            self.assertNotIn(("pop909_cl", "cl-002"), selected)
            self.assertEqual(
                manifest["songs"]["pop909:pop-001"]["canonical_work_id"],
                manifest["songs"]["pop909_cl:cl-001"]["canonical_work_id"],
            )
            shared = [
                entry for entry in manifest["songs"].values()
                if entry["title"] == "Shared Song"
            ]
            self.assertEqual(len({entry["canonical_work_id"] for entry in shared}), 1)
            self.assertEqual(sum(entry["selected"] for entry in shared), 1)
            self.assertIn(
                "exact_sequence_duplicate",
                {entry["exclusion_reason"] for entry in shared},
            )

            sequences = load_integrated_sequences(output / "corpus_manifest.json")
            self.assertEqual({sequence.work_id for sequence in sequences if "001" in sequence.song_id}, {
                manifest["songs"]["pop909_cl:cl-001"]["canonical_work_id"]
            })
            self.assertEqual(sum(len(sequence.states) for sequence in sequences), 6)


if __name__ == "__main__":
    unittest.main()
