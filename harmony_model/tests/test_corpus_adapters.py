import struct
from pathlib import Path
import tempfile
import unittest

from harmony_model.choco import ChocoChordParser
from harmony_model.midi import MidiNote, read_midi
from harmony_model.parser import parse_key
from harmony_model.pop909 import Pop909ChordParser, _beat_position
from harmony_model.pop909_cl import _parse_pitch_set
from harmony_model.schema import KeyAnnotation
from harmony_model.weimar_jazz import WeimarChordParser
from harmony_model.when_in_rome import RomanTextChordParser, convert_file


def vlq(value):
    parts = [value & 0x7F]
    value >>= 7
    while value:
        parts.append(0x80 | (value & 0x7F))
        value >>= 7
    return bytes(reversed(parts))


def midi_fixture():
    meta = (
        b"\x00\xff\x59\x02\x00\x00"
        b"\x00\xff\x58\x04\x04\x02\x18\x08"
        b"\x00\xff\x2f\x00"
    )
    notes = (
        b"\x00\xff\x03\x06chords"
        b"\x00\x91\x3c\x5a"
        b"\x00\x91\x40\x5a"
        b"\x00\x91\x43\x5a"
        + vlq(480) + b"\x81\x3c\x00"
        + b"\x00\x81\x40\x00"
        + b"\x00\x81\x43\x00"
        + b"\x00\xff\x2f\x00"
    )
    header = b"MThd" + struct.pack(">IHHH", 6, 1, 2, 480)
    return header + b"MTrk" + struct.pack(">I", len(meta)) + meta + b"MTrk" + struct.pack(">I", len(notes)) + notes


class WeimarAdapterTests(unittest.TestCase):
    def test_compact_jazz_symbols(self):
        parser = WeimarChordParser()
        examples = {
            "C-7": ("minor", "minor7", (), ()),
            "Ebj7911#": ("major", "major7", (9, 11), ("#11",)),
            "F79b13": ("major", "minor7", (9, 13), ("b9",)),
            "F79b13b": ("major", "minor7", (9, 13), ("b9", "b13")),
            "Gbsus7913": ("sus4", "minor7", (9, 13), ()),
        }
        for raw, expected in examples.items():
            with self.subTest(raw=raw):
                parsed = parser.parse(raw)
                self.assertEqual(parsed.status, "ok", parsed.diagnostics)
                value = parsed.chord.components
                self.assertEqual((value.quality, value.seventh, value.extensions, value.alterations), expected)
        self.assertEqual(parser.parse("C7alt").status, "partial")


class ChocoAdapterTests(unittest.TestCase):
    def test_explicit_harte_interval_lists(self):
        parser = ChocoChordParser()
        examples = {
            "G:(3,5,b7)": ("major", "minor7", (), ()),
            "E:(b3,b5,b7)": ("diminished", "minor7", (), ()),
            "C:(3,#5,b7,#9)": ("major", "minor7", (9,), ("#5", "#9")),
            "F:(4,5,b7,9)": ("sus4", "minor7", (9,), ()),
        }
        for raw, expected in examples.items():
            with self.subTest(raw=raw):
                parsed = parser.parse(raw)
                self.assertEqual(parsed.status, "ok", parsed.diagnostics)
                value = parsed.chord.components
                self.assertEqual((value.quality, value.seventh, value.extensions, value.alterations), expected)
        self.assertEqual(parser.parse("C:(*3,*5)").status, "partial")
        self.assertEqual(parser.parse("A").status, "ok")
        self.assertEqual(parser.parse("F/3").chord.bass.letter, "A")


class PopAdaptersTests(unittest.TestCase):
    def test_pop909_harte_and_time_to_beat(self):
        parsed = Pop909ChordParser().parse("F#:maj7/5")
        self.assertEqual(parsed.status, "ok")
        self.assertEqual(parsed.source_notation, "pop909-harte-v1")
        self.assertAlmostEqual(_beat_position(1.5, [0.0, 1.0, 2.0]), 1.5)

    def test_dependency_free_midi_and_pitch_set(self):
        midi = read_midi(midi_fixture())
        self.assertEqual(midi.ticks_per_beat, 480)
        self.assertEqual(midi.key_signatures, ((0, 0, 0),))
        self.assertEqual(midi.time_signatures, ((0, 4, 4),))
        self.assertEqual(midi.tracks[1].name, "chords")
        self.assertEqual(len(midi.tracks[1].notes), 3)
        parsed = _parse_pitch_set(midi.tracks[1].notes, KeyAnnotation(parse_key("C:maj"), "annotated"))
        self.assertEqual(parsed.status, "ok")
        self.assertEqual(parsed.chord.components.quality, "major")


class RomanTextAdapterTests(unittest.TestCase):
    def test_roman_applied_chords_inversions_and_omissions(self):
        parser = RomanTextChordParser()
        key = parse_key("C:maj")
        dominant = parser.parse("V7/V", key)
        self.assertEqual(dominant.status, "ok")
        self.assertEqual((dominant.chord.root.letter, dominant.chord.root.accidental), ("D", 0))
        self.assertEqual(dominant.chord.components.seventh, "minor7")
        inversion = parser.parse("iiø65", key)
        self.assertEqual(inversion.status, "ok")
        self.assertEqual(inversion.chord.bass.letter, "F")
        self.assertEqual(parser.parse("V7[no5]", key).status, "partial")

    def test_measure_repeat_and_pivot_choose_one_sounding_event(self):
        fixture = """Composer: Test Person
Title: Test Work
Analyst: Test Analyst
Time Signature: 4/4
Form: Verse
m1 C: I b3 V7/V
Pedal: C m1 b1 m2 b1
m2 = m1
m3 I || G: IV b3 V7
"""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "Composer" / "Collection" / "Work" / "analysis.txt"
            path.parent.mkdir(parents=True)
            path.write_text(fixture, encoding="utf-8")
            converted = convert_file(path, root)
        self.assertEqual(len(converted.song.events), 6)
        self.assertEqual(converted.song.events[0].context.meter, (4, 4))
        self.assertEqual(converted.song.events[0].context.section, "Verse")
        self.assertEqual(converted.song.events[-2].key_basis, "local")
        self.assertEqual(converted.metadata["analyst"], "Test Analyst")
        self.assertEqual(converted.metadata["pedal_markers"][0]["value"], "C m1 b1 m2 b1")


if __name__ == "__main__":
    unittest.main()
