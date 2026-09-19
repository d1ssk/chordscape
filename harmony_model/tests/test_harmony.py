import json
from dataclasses import asdict, FrozenInstanceError
from pathlib import Path
import subprocess
import sys
import unittest

from harmony_model.normalize import normalize, relative_pitch
from harmony_model.parser import PlainChordParser, parse_key, parse_pitch
from harmony_model.schema import (
    ChordComponents, EventContext, Key, KeyAnnotation, ParseResult, Pitch,
    Provenance, RelativePitch, Song, LETTERS, MODES,
)


class ParserTests(unittest.TestCase):
    def test_representative_chords(self):
        examples = [
            ("C", "major", "none", (), ()),
            ("Cm", "minor", "none", (), ()),
            ("C7", "major", "minor7", (), ()),
            ("Cmaj7", "major", "major7", (), ()),
            ("Cm7", "minor", "minor7", (), ()),
            ("CmMaj7", "minor", "major7", (), ()),
            ("Cm(maj7)", "minor", "major7", (), ()),
            ("Cdim", "diminished", "none", (), ()),
            ("Cdim7", "diminished", "diminished7", (), ()),
            ("Cm7b5", "diminished", "minor7", (), ()),
            ("Caug", "augmented", "none", (), ()),
            ("Csus2", "sus2", "none", (), ()),
            ("Csus4", "sus4", "none", (), ()),
            ("C7sus4", "sus4", "minor7", (), ()),
            ("C5", "power", "none", (), ()),
            ("C6", "major", "none", (6,), ()),
            ("Cm6", "minor", "none", (6,), ()),
            ("C6/9", "major", "none", (6, 9), ()),
            ("Cm6/9", "minor", "none", (6, 9), ()),
            ("Cadd9", "major", "none", (9,), ()),
            ("Cm(add9)", "minor", "none", (9,), ()),
            ("C9", "major", "minor7", (9,), ()),
            ("C11", "major", "minor7", (11,), ()),
            ("C13", "major", "minor7", (13,), ()),
            ("Cmaj13", "major", "major7", (13,), ()),
            ("Cm11", "minor", "minor7", (11,), ()),
            ("Cm9", "minor", "minor7", (9,), ()),
            ("Cmaj9", "major", "major7", (9,), ()),
            ("C7b9", "major", "minor7", (9,), ("b9",)),
            ("C7#9", "major", "minor7", (9,), ("#9",)),
            ("C7#11", "major", "minor7", (11,), ("#11",)),
            ("C7b13", "major", "minor7", (13,), ("b13",)),
            ("C7#9b13", "major", "minor7", (9, 13), ("#9", "b13")),
            ("C7(b9,#5)", "major", "minor7", (9,), ("#5", "b9")),
            ("C7b5", "major", "minor7", (), ("b5",)),
            ("Cmaj7#5", "major", "major7", (), ("#5",)),
            ("Cmaj7(#11)", "major", "major7", (11,), ("#11",)),
        ]
        for raw, *components in examples:
            with self.subTest(raw=raw):
                result = PlainChordParser().parse(raw)
                self.assertEqual(result.status, "ok", result.diagnostics)
                self.assertEqual(result.chord.components, ChordComponents(*components))
                self.assertEqual(result.raw_chord, raw)

    def test_aliases_preserve_raw(self):
        for left, right in [("C♯M7", "C#maj7"), ("D♭°7", "Dbdim7"), ("Cm(M7)", "CmMaj7"), ("C𝄪", "C##"), ("B𝄫", "Bbb")]:
            with self.subTest(left=left):
                a, b = PlainChordParser().parse(left), PlainChordParser().parse(right)
                self.assertEqual(a.status, "ok")
                self.assertEqual(a.chord, b.chord)
                self.assertNotEqual(a.raw_chord, b.raw_chord)

    def test_slash_bass(self):
        for raw, bass in [("C/E", "E"), ("D/E", "E"), ("C/C", "C"), ("C6/9/E", "E"), ("G7b9/F#", "F#")]:
            with self.subTest(raw=raw):
                parsed = PlainChordParser().parse(raw)
                self.assertEqual(parsed.status, "ok")
                self.assertEqual(parsed.chord.bass, parse_pitch(bass))
        self.assertIsNone(PlainChordParser().parse("C").chord.bass)

    def test_unknown_factors_preserve_root_bass(self):
        for raw in ("  Dbmystery7/F  ", "Dbalt/F", "Db:7(b9)/F", "Db7no3/F"):
            with self.subTest(raw=raw):
                result = PlainChordParser().parse(raw)
                self.assertEqual(result.status, "partial")
                self.assertEqual(result.raw_chord, raw)
                self.assertEqual(result.chord.root, parse_pitch("Db"))
                self.assertEqual(result.chord.bass, parse_pitch("F"))
                self.assertEqual(result.chord.components, ChordComponents("other", None, None, None))
                self.assertTrue(result.diagnostics)

    def test_parse_failures(self):
        for raw in ("", "H7", "V/V", "C/E/G", "C/", "C7(b9", "C7)b9(", "C7((b9))", "C7()", "C7(b9,,#9)"):
            with self.subTest(raw=raw):
                result = PlainChordParser().parse(raw)
                self.assertEqual(result.status, "failure")
                self.assertIsNone(result.chord)
                self.assertEqual(result.raw_chord, raw)
                self.assertTrue(result.diagnostics)

    def test_no_chord_is_not_unknown(self):
        for raw in ("N", "NC", "N.C."):
            result = PlainChordParser().parse(raw)
            self.assertEqual(result.status, "no_chord")
            self.assertIsNone(normalize(result).factors)

    def test_modifier_order_duplicates_and_absence(self):
        a = PlainChordParser().parse("G7#9b13#9").chord.components
        b = PlainChordParser().parse("G7(b13,#9)").chord.components
        self.assertEqual(a, b)
        self.assertEqual(a.extensions, (9, 13))
        self.assertEqual(PlainChordParser().parse("G7").chord.components.extensions, ())
        self.assertIsNone(PlainChordParser().parse("Gunknown").chord.components.extensions)


class NormalizationTests(unittest.TestCase):
    def event(self, chord, key="C:maj", local=None):
        return normalize(PlainChordParser().parse(chord),
                         global_key=KeyAnnotation(parse_key(key), "annotated"),
                         local_key=KeyAnnotation(parse_key(local), "annotated") if local else None)

    def test_degree_examples(self):
        for raw, key, degree, accidental in [
            ("G7", "C:maj", 5, 0), ("B7", "E:maj", 5, 0),
            ("Db7", "C:maj", 2, -1), ("A7", "G:maj", 2, 0),
            ("C#", "C:maj", 1, 1), ("Db", "C:maj", 2, -1),
            ("E#dim", "F#:maj", 7, 0), ("Cb", "Gb:maj", 4, 0),
            ("B#", "C#:maj", 7, 0), ("Bbb", "Cb:maj", 7, -1),
            ("C##", "C:maj", 1, 2), ("Dbb", "C:maj", 2, -2),
        ]:
            with self.subTest(raw=raw, key=key):
                self.assertEqual(self.event(raw, key).factors.root, RelativePitch(degree, accidental))

    def test_enharmonics(self):
        self.assertEqual(parse_pitch("C#").pitch_class, parse_pitch("Db").pitch_class)
        self.assertNotEqual(self.event("C#").factors.root, self.event("Db").factors.root)

    def test_natural_minor_reference(self):
        for pitch, expected in [("G", (7, 0)), ("G#", (7, 1)), ("C", (3, 0)), ("F#", (6, 1))]:
            self.assertEqual(self.event(pitch, "A:min").factors.root, RelativePitch(*expected))

    def test_local_key_and_origin(self):
        for raw, degree in [("G", 1), ("D7", 5), ("G", 1)]:
            event = self.event(raw, local="G:maj")
            self.assertEqual(event.key_basis, "local")
            self.assertEqual(event.factors.root, RelativePitch(degree, 0))
            self.assertEqual(event.global_key.key, parse_key("C:maj"))
        self.assertEqual(self.event("D7").factors.root, RelativePitch(2, 0))
        self.assertEqual(self.event("D7").key_basis, "global_fallback")
        estimated = KeyAnnotation(parse_key("G:maj"), "estimated", "toy-estimator@1")
        event = normalize(PlainChordParser().parse("D7"), local_key=estimated)
        self.assertEqual(event.local_key.origin, "estimated")
        self.assertEqual(event.factors.root, RelativePitch(5, 0))

    def test_missing_key(self):
        event = normalize(PlainChordParser().parse("Db7/F"))
        self.assertEqual(event.key_basis, "missing")
        self.assertIsNone(event.factors.root)
        self.assertIsNone(event.factors.bass)
        self.assertEqual(event.parsed.chord.root, parse_pitch("Db"))
        self.assertEqual(event.parsed.chord.bass, parse_pitch("F"))
        self.assertEqual(event.factors.components.seventh, "minor7")

    def test_relative_bass(self):
        self.assertEqual(self.event("C/E").factors.bass, RelativePitch(3, 0))
        self.assertEqual(self.event("D/E").factors.bass, RelativePitch(3, 0))
        self.assertEqual(self.event("D7/F#", local="G:maj").factors.bass, RelativePitch(7, 0))

    def test_spelled_key_grid(self):
        for mode, intervals in MODES.items():
            for tonic_letter in LETTERS:
                for tonic_accidental in range(-2, 3):
                    key = Key(Pitch(tonic_letter, tonic_accidental), mode)
                    for letter in LETTERS:
                        for accidental in range(-2, 3):
                            pitch = Pitch(letter, accidental)
                            relative = relative_pitch(pitch, key)
                            reconstructed = (key.tonic.pitch_class + intervals[relative.degree - 1] + relative.accidental) % 12
                            self.assertEqual(reconstructed, pitch.pitch_class)
                            self.assertEqual(relative.degree, (LETTERS.index(letter) - LETTERS.index(tonic_letter)) % 7 + 1)

    def test_partial_and_failure_preserve_context(self):
        context = EventContext(2.5, 1.5, 3, (6, 8), "phrase-a", "bridge")
        for raw in ("Dbmystery", "H7"):
            event = normalize(PlainChordParser().parse(raw), context=context, style="jazz", source_reference="toy:row:4")
            self.assertEqual(event.context, context)
            self.assertEqual(event.source_reference, "toy:row:4")
            self.assertEqual(event.style, "jazz")
            self.assertEqual(json.loads(json.dumps(asdict(event)))["parsed"]["raw_chord"], raw)


class SchemaTests(unittest.TestCase):
    def test_invalid_values(self):
        constructors = [
            lambda: Pitch("H"), lambda: Pitch("", 0), lambda: Pitch("C", True),
            lambda: RelativePitch(0, 0), lambda: RelativePitch(8, 0),
            lambda: RelativePitch(1, 0.5), lambda: Key(Pitch("C"), "dorian"),
            lambda: KeyAnnotation(parse_key("C:maj"), "estimated"),
            lambda: KeyAnnotation(parse_key("C:maj"), "guess"),
            lambda: ChordComponents("dominant7", "none", (), ()),
            lambda: ChordComponents("major", "other", (), ()),
            lambda: ChordComponents("major", "none", (8,), ()),
            lambda: ChordComponents("major", "minor7", (), ("b9",)),
            lambda: EventContext(duration=0), lambda: EventContext(duration=-1),
            lambda: EventContext(duration=float("nan")), lambda: EventContext(beat_position=float("inf")),
            lambda: EventContext(bar_position=-1), lambda: EventContext(meter=(4, 0)),
            lambda: ParseResult("C", "toy", "ok", None),
            lambda: ParseResult("bad", "toy", "failure", None),
            lambda: normalize(PlainChordParser().parse("C"), style="free"),
        ]
        for index, constructor in enumerate(constructors):
            with self.subTest(index=index), self.assertRaises(ValueError):
                constructor()

    def test_independent_unknown_quality(self):
        self.assertEqual(ChordComponents("other", "minor7", None, None).seventh, "minor7")

    def test_immutable_values_and_provenance(self):
        pitch = Pitch("C")
        with self.assertRaises(FrozenInstanceError):
            pitch.accidental = 1
        provenance = Provenance("handwritten fixture", "1", "local:tests", "repository license", "2026-09-18", "No external music data")
        event = normalize(PlainChordParser().parse("C"))
        song = Song("example-1", "work-1", provenance, (event,))
        self.assertEqual(asdict(song)["provenance"]["version"], "1")
        with self.assertRaises(ValueError):
            Song("example-1", "", provenance, (event,))

    def test_invalid_key_text(self):
        for text in ("C", "H:maj", "C:dorian", "C:maj:minor", "C#b:maj"):
            with self.subTest(text=text), self.assertRaises(ValueError):
                parse_key(text)


class CLITests(unittest.TestCase):
    def run_cli(self, *args):
        return subprocess.run([sys.executable, "-m", "harmony_model", *args],
                              cwd=Path(__file__).resolve().parents[1], capture_output=True, text=True)

    def test_inspect(self):
        process = self.run_cli("inspect-chord", "G7b9", "--key", "C:maj")
        self.assertEqual(process.returncode, 0, process.stderr)
        result = json.loads(process.stdout)
        self.assertEqual(result["factors"]["root"], {"degree": 5, "accidental": 0})
        self.assertEqual(result["factors"]["components"]["alterations"], ["b9"])
        self.assertEqual(result["global_key"]["origin"], "user")

    def test_local_key(self):
        process = self.run_cli("inspect-chord", "D7", "--key", "C:maj", "--local-key", "G:maj")
        self.assertEqual(process.returncode, 0)
        self.assertEqual(json.loads(process.stdout)["factors"]["root"]["degree"], 5)

    def test_errors_are_machine_readable(self):
        for text, status in [("Cmystery", "partial"), ("bad", "failure")]:
            process = self.run_cli("inspect-chord", text)
            self.assertEqual(process.returncode, 1)
            self.assertEqual(json.loads(process.stdout)["parsed"]["status"], status)

    def test_invalid_arguments(self):
        process = self.run_cli("inspect-chord", "C", "--key", "invalid")
        self.assertEqual(process.returncode, 2)
        self.assertNotIn("Traceback", process.stderr)
        self.assertEqual(self.run_cli("train").returncode, 2)


if __name__ == "__main__":
    unittest.main()
