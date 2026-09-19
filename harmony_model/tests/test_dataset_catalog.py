import copy
import hashlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from harmony_model.dataset_catalog import (
    CatalogError,
    _extract_tar_gz,
    _extract_zip,
    fetch_dataset,
    load_catalog,
    validate_catalog,
    verify_acquisitions,
)


class DatasetCatalogTests(unittest.TestCase):
    def test_repository_catalog_is_valid_and_covers_required_candidates(self):
        catalog = load_catalog()
        ids = {dataset["id"] for dataset in catalog["datasets"]}
        self.assertTrue(
            {
                "choco",
                "mcgill_billboard",
                "pop909",
                "pop909_cl",
                "real_book_choco",
                "weimar_jazz_database",
                "when_in_rome",
                "dcml_corpora",
            }.issubset(ids)
        )

    def test_when_in_rome_allowlist_is_revision_locked_and_deny_by_default(self):
        catalog = load_catalog()
        dataset = next(d for d in catalog["datasets"] if d["id"] == "when_in_rome")
        allowlist_path = Path(__file__).resolve().parents[1] / dataset["acquisition"]["allowlist"]
        allowlist = json.loads(allowlist_path.read_text(encoding="utf-8"))
        self.assertEqual(allowlist["revision"], dataset["version"].split(" at ")[1].split(" ")[0])
        self.assertEqual(allowlist["default_policy"], "excluded_until_source_license_is_resolved")
        self.assertEqual(len(allowlist["subcorpora"]), 1)
        self.assertEqual(allowlist["subcorpora"][0]["expected_files"], 179)

    def test_collected_sources_have_locked_provenance(self):
        catalog = load_catalog()
        collected = [
            d
            for d in catalog["datasets"]
            if d["acquisition"]["status"] in {"collected", "collected_local_only"}
        ]
        self.assertGreaterEqual(len(collected), 4)
        for dataset in collected:
            self.assertRegex(dataset["acquisition"]["download_date"], r"^\d{4}-\d{2}-\d{2}$")
            self.assertTrue(dataset["conversion_notes"])
            for artifact in dataset["acquisition"]["artifacts"]:
                self.assertRegex(artifact["sha256"], r"^[0-9a-f]{64}$")

    def test_uncollected_source_cannot_claim_artifacts(self):
        catalog = load_catalog()
        changed = copy.deepcopy(catalog)
        dataset = next(d for d in changed["datasets"] if d["id"] == "dcml_corpora")
        dataset["acquisition"]["artifacts"] = [
            {
                "download_url": "https://example.test/data",
                "path": "pop909/data",
                "sha256": "0" * 64,
                "bytes": 1,
            }
        ]
        with self.assertRaisesRegex(CatalogError, "uncollected data"):
            validate_catalog(changed)

    def test_verify_reports_missing_and_checksum_mismatch(self):
        payload = b"locked data"
        digest = hashlib.sha256(payload).hexdigest()
        catalog = self._toy_catalog(digest, len(payload))
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.assertEqual(verify_acquisitions(catalog, root), ["toy: missing toy/data.bin"])
            path = root / "toy" / "data.bin"
            path.parent.mkdir(parents=True)
            path.write_bytes(b"wrong data!")
            self.assertIn("checksum mismatch", verify_acquisitions(catalog, root)[0])
            path.write_bytes(payload)
            self.assertEqual(verify_acquisitions(catalog, root), [])

    def test_fetch_refuses_unapproved_dataset(self):
        catalog = load_catalog()
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaisesRegex(CatalogError, "not approved"):
                fetch_dataset(catalog, "dcml_corpora", Path(temp))

    def test_local_only_collection_does_not_claim_release_rights(self):
        catalog = load_catalog()
        for dataset_id in ("pop909", "pop909_cl"):
            dataset = next(d for d in catalog["datasets"] if d["id"] == dataset_id)
            self.assertEqual(dataset["acquisition"]["status"], "collected_local_only")
            self.assertEqual(dataset["rights"]["raw_redistribution"], "unclear")
            self.assertEqual(dataset["rights"]["derived_artifacts"], "review_required")

    def test_fetch_writes_provenance_receipt(self):
        payload = b"locked data"
        digest = hashlib.sha256(payload).hexdigest()
        catalog = self._toy_catalog(digest, len(payload))
        response = io.BytesIO(payload)
        with tempfile.TemporaryDirectory() as temp, patch(
            "harmony_model.dataset_catalog.urlopen", return_value=response
        ):
            root = Path(temp)
            receipt = fetch_dataset(catalog, "toy", root)
            saved = json.loads((root / "toy" / "receipt.json").read_text(encoding="utf-8"))
            self.assertEqual(saved["source"], "Toy")
            self.assertEqual(saved["artifacts"][0]["sha256"], digest)
            self.assertEqual(saved["acquisition_status"], "collected")
            self.assertEqual(receipt["conversion_notes"], "No conversion.")

    def test_tar_extraction_rejects_path_traversal(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            archive = root / "bad.tar.gz"
            with tarfile.open(archive, "w:gz") as bundle:
                member = tarfile.TarInfo("../escape.txt")
                member.size = 1
                bundle.addfile(member, io.BytesIO(b"x"))
            with self.assertRaisesRegex(CatalogError, "unsafe archive member"):
                _extract_tar_gz(archive, root / "extract")

    def test_tar_extraction_can_select_globs(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            archive = root / "data.tar.gz"
            with tarfile.open(archive, "w:gz") as bundle:
                for name, contents in (
                    ("release/Corpus/Allowed/work/analysis.txt", b"I V I"),
                    ("release/Corpus/Allowed/work/score.mxl", b"score"),
                    ("release/Corpus/Blocked/work/analysis.txt", b"i V i"),
                ):
                    member = tarfile.TarInfo(name)
                    member.size = len(contents)
                    bundle.addfile(member, io.BytesIO(contents))
            _extract_tar_gz(
                archive,
                root / "extract",
                ["release/Corpus/Allowed/*/analysis.txt"],
            )
            self.assertTrue(
                (root / "extract/release/Corpus/Allowed/work/analysis.txt").is_file()
            )
            self.assertFalse((root / "extract/release/Corpus/Allowed/work/score.mxl").exists())
            self.assertFalse(
                (root / "extract/release/Corpus/Blocked/work/analysis.txt").exists()
            )

    def test_zip_extraction_can_select_prefixes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            archive = root / "data.zip"
            with zipfile.ZipFile(archive, "w") as bundle:
                bundle.writestr("release/jams/example.jams", "{}")
                bundle.writestr("release/knowledge-graph/example.ttl", "large")
            _extract_zip(archive, root / "extract", ["release/jams/"])
            self.assertTrue((root / "extract/release/jams/example.jams").is_file())
            self.assertFalse((root / "extract/release/knowledge-graph/example.ttl").exists())

    @staticmethod
    def _toy_catalog(digest, size):
        catalog = {
            "schema_version": 1,
            "researched_at": "2026-09-18",
            "notice": "Test only.",
            "datasets": [
                {
                    "id": "toy",
                    "source": "Toy",
                    "version": "1",
                    "url": "https://example.test",
                    "styles": ["pop"],
                    "license": {
                        "name": "CC0",
                        "url": "https://example.test/license",
                        "scope": "All data.",
                        "evidence_url": "https://example.test/evidence",
                    },
                    "rights": {
                        "download": "allowed",
                        "raw_redistribution": "allowed",
                        "normalized_redistribution": "allowed",
                        "derived_artifacts": "allowed",
                        "notes": "None.",
                    },
                    "acquisition": {
                        "status": "collected",
                        "download_date": "2026-09-18",
                        "method": "test",
                        "reason": "test",
                        "artifacts": [
                            {
                                "download_url": "https://example.test/data",
                                "path": "toy/data.bin",
                                "sha256": digest,
                                "bytes": size,
                            }
                        ],
                    },
                    "conversion_notes": "No conversion.",
                }
            ],
        }
        validate_catalog(catalog)
        return catalog


if __name__ == "__main__":
    unittest.main()
