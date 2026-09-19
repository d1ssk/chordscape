import json
from pathlib import Path
import tempfile
import unittest

from harmony_model.mcgill_billboard import (
    McGillChordParser,
    assign_splits,
    build_diagnostics,
    build_split_manifest,
    convert_chart,
    parse_meter,
)
from harmony_model.schema import ChordComponents, RelativePitch


FIXTURE = """# title: A Fixture Song
# artist: Test Artist
# metre: 4/4
# tonic: C

0.0\tsilence
0.1\tA, intro, | C:maj . . G:7/3 | x2
8.1\tB, verse, | (2/4) A:min D:7 | * | N |
# tonic: G
14.1\tC, bridge, | G:maj | D:7 |
18.1\tZ
19.1\tend
"""


class McGillChordParserTests(unittest.TestCase):
    def test_representative_harte_chords(self):
        examples = [
            ("C:maj", ChordComponents("major", "none", (), ())),
            ("A:min7", ChordComponents("minor", "minor7", (), ())),
            ("B:hdim7", ChordComponents("diminished", "minor7", (), ())),
            ("C:sus4(b7,9)", ChordComponents("sus4", "minor7", (9,), ())),
            ("F#:7(b9,#11)", ChordComponents("major", "minor7", (9, 11), ("b9", "#11"))),
            ("D:1", ChordComponents("no3", "none", (), ())),
        ]
        parser = McGillChordParser()
        for raw, expected in examples:
            with self.subTest(raw=raw):
                parsed = parser.parse(raw)
                self.assertEqual(parsed.status, "ok", parsed.diagnostics)
                self.assertEqual(parsed.chord.components, expected)

    def test_numeric_bass_is_spelled_from_the_root(self):
        parser = McGillChordParser()
        examples = {"C:maj/3": "E", "Db:maj/3": "F", "F#:min/b3": "A", "Cb:maj/#11": "F"}
        for raw, expected in examples.items():
            with self.subTest(raw=raw):
                parsed = parser.parse(raw)
                self.assertEqual(parsed.status, "ok")
                self.assertEqual(parsed.chord.bass.letter, expected[0])
                accidental = expected.count("#") - expected.count("b")
                self.assertEqual(parsed.chord.bass.accidental, accidental)

    def test_unknown_information_is_not_silently_coerced(self):
        parser = McGillChordParser()
        self.assertEqual(parser.parse("C:mystery").status, "partial")
        self.assertEqual(parser.parse("C:1(b3,b7)").status, "partial")
        self.assertEqual(parser.parse("C:maj7(b7)").status, "partial")
        self.assertEqual(parser.parse("*").status, "failure")
        self.assertEqual(parser.parse("N").status, "no_chord")
        self.assertEqual(parser.parse("&pause").status, "no_chord")

    def test_meter_validation(self):
        self.assertEqual(parse_meter("12/8"), (12, 8))
        for invalid in ("four-four", "4", "0/4"):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                parse_meter(invalid)


class McGillConversionTests(unittest.TestCase):
    def convert_fixture(self):
        temporary = tempfile.TemporaryDirectory()
        path = Path(temporary.name) / "0001" / "salami_chords.txt"
        path.parent.mkdir()
        path.write_text(FIXTURE, encoding="utf-8")
        return temporary, convert_chart(path)

    def test_chart_structure_repeat_duration_keys_and_boundaries(self):
        temporary, converted = self.convert_fixture()
        self.addCleanup(temporary.cleanup)
        events = converted.song.events
        self.assertEqual(converted.song.song_id, "mcgill-0001")
        self.assertEqual(len(events), 10)
        self.assertEqual(events[0].context.duration, 3)
        self.assertEqual(events[1].context.beat_position, 3)
        self.assertEqual(events[2].context.bar_position, 1)
        self.assertEqual(events[4].context.meter, (2, 4))
        self.assertEqual(events[4].context.duration, 1)
        self.assertEqual(events[0].global_key.origin, "estimated")
        self.assertEqual(events[0].factors.root, RelativePitch(1, 0))
        self.assertEqual(events[-2].key_basis, "local")
        self.assertEqual(events[-2].local_key.key.mode, "major")
        self.assertEqual(events[-2].factors.root, RelativePitch(1, 0))
        reasons = {boundary.reason for boundary in converted.boundaries}
        self.assertTrue({"silence", "failure", "no_chord", "non_musical", "end"}.issubset(reasons))
        self.assertEqual(next(b.event_index for b in converted.boundaries if b.reason == "silence"), 0)
        self.assertEqual(next(b.event_index for b in converted.boundaries if b.reason == "end"), 10)

    def test_split_is_deterministic_and_never_separates_a_work(self):
        temporary, converted = self.convert_fixture()
        self.addCleanup(temporary.cleanup)
        assignments = assign_splits([converted, converted], "seed")
        self.assertEqual(len(assignments), 1)
        manifest = build_split_manifest([converted, converted], "seed")
        work = next(iter(manifest["works"].values()))
        self.assertEqual(len(set([work["split"], assignments[converted.song.work_id]])), 1)
        self.assertEqual(len(work["song_ids"]), 2)

    def test_diagnostics_distinguish_full_and_bass_agnostic_coverage(self):
        temporary, converted = self.convert_fixture()
        self.addCleanup(temporary.cleanup)
        with tempfile.TemporaryDirectory() as directory:
            manifest = Path(directory) / "candidates.json"
            manifest.write_text(json.dumps({
                "version": 1,
                "nodes": [["tonic", 1, 0, "major", "none", [], [], None]],
            }), encoding="utf-8")
            report = build_diagnostics([converted], manifest)
        self.assertEqual(report["songs"], 1)
        self.assertEqual(report["status"]["failure"], 1)
        self.assertGreater(report["ui_coverage"]["harmony_matches"], 0)
        self.assertGreaterEqual(
            report["ui_coverage"]["harmony_matches"],
            report["ui_coverage"]["full_matches"],
        )


if __name__ == "__main__":
    unittest.main()
