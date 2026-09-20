import json
from pathlib import Path
import tempfile
import unittest

from harmony_model.baseline import FactorState, load_integrated_sequences
from harmony_model.integration import _sha256, build_integrated_manifest


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

    def test_publication_review_links_duplicates_and_excludes_unreviewed_data(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "processed"
            root.mkdir()
            direct = row("direct", "one", [A, B], title="Song No. 1", creator="Writer")
            direct["source_partition"] = "OpenScore-LiederCorpus"
            direct["metadata"]["path"] = "Writer/_/Song_No_1/analysis.txt"
            write_source(root, "when_in_rome-v1", "when_in_rome", [direct])
            duplicate = row("choco", "mirror", [A, B], title="Song", creator="Writer")
            duplicate["source_partition"] = "when-in-rome"
            approved = row("choco", "tavern", [B, C], title="Variation", creator="Composer")
            approved["source_partition"] = "when-in-rome"
            approved["song"]["events"] = [event(B, "jazz"), event(C, "jazz")]
            unknown = row("choco", "unknown", [A, C], title="Unknown", creator="Composer")
            unknown["source_partition"] = "when-in-rome"
            nc = row("choco", "nc", [A, B], title="NC", creator="Composer")
            nc["source_partition"] = "jaah"
            write_source(root, "choco-v1", "choco", [duplicate, approved, unknown, nc])
            write_source(root, "pop909-v1", "pop909", [
                row("pop", "one", [A, B], title="Pop", creator="Writer", pop_id="001")
            ])
            path = root / "publication.json"
            path.write_text(json.dumps({
                "schema_version": 1,
                "profile": "chordscape-public-training-v1",
                "expected_songs_sha256": {
                    name: _sha256(root / f"{name}-v1" / "songs.jsonl")
                    for name in ("choco", "when_in_rome")
                },
                "excluded_sources": ["pop909", "pop909_cl"],
                "excluded_choco_partitions": ["jaah", "mozart-piano-sonatas"],
                "licenses": {"by_sa": {"name": "CC BY-SA 4.0"}},
                "reviewed_choco_when_in_rome": {
                    "choco:choco-mirror": {
                        "decision": "duplicate", "license_id": "by_sa",
                        "analysis_path": "Corpus/OpenScore-LiederCorpus/Writer/_/Song_No_1/analysis.txt",
                        "analysis_sha256": "a" * 64,
                        "reviewed_title": "Song", "reviewed_creator": "Writer",
                        "duplicate_of": "when_in_rome:direct-one",
                    },
                    "choco:choco-tavern": {
                        "decision": "include", "license_id": "by_sa",
                        "analysis_path": "Corpus/Variations_and_Grounds/Composer/_/Variation/analysis.txt",
                        "analysis_sha256": "b" * 64,
                        "reviewed_title": "Variation", "reviewed_creator": "Composer",
                    },
                    "choco:choco-unknown": {
                        "decision": "exclude", "reason": "source_license_unresolved",
                        "reviewed_title": "Unknown", "reviewed_creator": "Composer",
                    },
                },
            }), encoding="utf-8")
            output = root / "integrated-public-v1"
            manifest = build_integrated_manifest(root, output, publication_policy=path)
            songs = manifest["songs"]
            self.assertEqual(
                songs["choco:choco-mirror"]["canonical_work_id"],
                songs["when_in_rome:direct-one"]["canonical_work_id"],
            )
            self.assertEqual(songs["choco:choco-mirror"]["exclusion_reason"], "publication_upstream_duplicate")
            self.assertEqual(songs["choco:choco-unknown"]["exclusion_reason"], "publication_review_excluded")
            self.assertEqual(songs["choco:choco-nc"]["exclusion_reason"], "publication_nc_partition")
            self.assertEqual(songs["pop909:pop-one"]["exclusion_reason"], "publication_excluded_source")
            self.assertTrue(songs["choco:choco-tavern"]["selected"])
            self.assertEqual(manifest["dataset_version"], "public-v1")
            sequences = load_integrated_sequences(output / "corpus_manifest.json")
            self.assertEqual(len(sequences), 2)

            changed = json.loads(path.read_text(encoding="utf-8"))
            changed["expected_songs_sha256"]["choco"] = "0" * 64
            path.write_text(json.dumps(changed), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "source changed: choco"):
                build_integrated_manifest(root, output, publication_policy=path)

            changed["expected_songs_sha256"]["choco"] = _sha256(root / "choco-v1" / "songs.jsonl")
            del changed["reviewed_choco_when_in_rome"]["choco:choco-unknown"]
            path.write_text(json.dumps(changed), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "must cover every"):
                build_integrated_manifest(root, output, publication_policy=path)

            changed["reviewed_choco_when_in_rome"]["choco:choco-unknown"] = {
                "decision": "exclude", "reason": "source_license_unresolved",
                "reviewed_title": "Unknown", "reviewed_creator": "Composer",
            }
            path.write_text(json.dumps(changed), encoding="utf-8")
            classical = row("classic", "one", [A, B], title="Classical", creator="Composer")
            classical["song"]["events"] = [event(A, "classical"), event(B, "classical")]
            write_source(root, "classic-v1", "classic", [classical])
            pop_jazz = root / "integrated-public-pop-jazz-v1"
            subset = build_integrated_manifest(
                root, pop_jazz, publication_policy=path, pop_jazz_only=True
            )
            self.assertEqual(subset["dataset_version"], "public-pop-jazz-v1")
            self.assertEqual(subset["policy"]["allowed_styles"], ["jazz", "pop"])
            self.assertEqual(
                subset["songs"]["classic:classic-one"]["exclusion_reason"],
                "publication_non_pop_jazz_style",
            )
            self.assertEqual(
                {sequence.style for sequence in load_integrated_sequences(pop_jazz / "corpus_manifest.json")},
                {"pop", "jazz"},
            )
            with self.assertRaisesRegex(ValueError, "requires a publication corpus policy"):
                build_integrated_manifest(root, root / "invalid", pop_jazz_only=True)


if __name__ == "__main__":
    unittest.main()
