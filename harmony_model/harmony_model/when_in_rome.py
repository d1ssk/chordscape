"""When in Rome RomanText adapter for the allowlisted OpenScore Lieder analyses."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
from typing import Dict, List, Optional, Sequence, Tuple

from .conversion import Boundary, ConvertedSong, provenance, stable_id
from .normalize import normalize
from .parser import parse_pitch
from .schema import (
    LETTERS, MODES, NATURALS, ChordComponents, EventContext, Key, KeyAnnotation,
    ParseResult, Pitch, Song, SymbolicChord,
)


ADAPTER_VERSION = "when-in-rome-openscore-lieder-v1"
DEFAULT_SEED = "chordscape-when-in-rome-split-v1"
NOTATION = "romantext-v1"
SOURCE_NOTES = (
    "Only the 179 analysis files in the OpenScore Lieder allowlist are converted.",
    "RomanText source beat positions are retained; duration is unknown because beat units vary by meter.",
)
ROMAN_DEGREES = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7}


@dataclass(frozen=True)
class _Spec:
    beat: float
    roman: str
    key_text: Optional[str]
    source_line: int


def _parse_key_token(text: str) -> Key:
    match = re.fullmatch(r"([A-Ga-g])([#b-]*)", text)
    if not match:
        raise ValueError(f"Unsupported RomanText key: {text!r}")
    letter = match[1].upper()
    suffix = match[2].replace("-", "b")
    pitch = parse_pitch(letter + suffix)
    return Key(pitch, "major" if match[1].isupper() else "minor")


def _pitch_for_degree(key: Key, degree: int, accidental: int, *, quality_case: Optional[str] = None) -> Pitch:
    tonic_index = LETTERS.index(key.tonic.letter)
    target_index = (tonic_index + degree - 1) % 7
    octave = 12 if target_index < tonic_index else 0
    height = NATURALS[tonic_index] + key.tonic.accidental + MODES[key.mode][degree - 1]
    # RomanText's documented music21 "quality" policy raises lowercase vi/vii
    # in minor while uppercase VI/VII use the natural-minor degrees.
    if key.mode == "minor" and degree in {6, 7} and quality_case == "lower":
        height += 1
    height += accidental
    natural = NATURALS[target_index] + octave
    return Pitch(LETTERS[target_index], height - natural)


def _member(root: Pitch, steps: int, semitones: int) -> Pitch:
    root_index = LETTERS.index(root.letter)
    target_index = (root_index + steps) % 7
    natural_distance = NATURALS[target_index] - NATURALS[root_index]
    if target_index <= root_index:
        natural_distance += 12
    accidental = root.accidental + semitones - natural_distance
    return Pitch(LETTERS[target_index], accidental)


def _roman_degree(text: str):
    match = re.fullmatch(r"([#b]*)([ivIV]+)", text)
    if not match:
        return None
    numeral = match[2]
    degree = ROMAN_DEGREES.get(numeral.upper())
    if degree is None:
        return None
    accidental = match[1].count("#") - match[1].count("b")
    return degree, accidental, "upper" if numeral.isupper() else "lower"


def _temporary_key(local_key: Key, applied: Optional[str]) -> Key:
    if not applied:
        return local_key
    target = _roman_degree(applied)
    if target is None:
        raise ValueError(f"Unsupported applied-chord target: {applied}")
    degree, accidental, case = target
    return Key(
        _pitch_for_degree(local_key, degree, accidental, quality_case=case),
        "major" if case == "upper" else "minor",
    )


class RomanTextChordParser:
    def parse(self, raw: str, key: Optional[Key]) -> ParseResult:
        text = raw.strip().replace("/o", "ø").replace("4/3", "43").replace("6/5", "65")
        if text in {"", "N.C.", "NC"}:
            return ParseResult(raw, NOTATION, "no_chord", None)
        if key is None:
            return ParseResult(raw, NOTATION, "failure", None, ("Roman chord has no prevailing key",))
        brackets = re.findall(r"\[([^]]*)\]", text)
        core = re.sub(r"\[[^]]*\]", "", text)
        applied = None
        if "/" in core:
            core, applied = core.rsplit("/", 1)
        # Accept plus signs on either side of the inversion figure.
        core = re.sub(r"(\d)\+$", r"+\1", core)
        special = re.fullmatch(r"(Cad|Ger|Fr|It|N)(\d*)", core)
        unsupported = []
        if special:
            name, figure = special.groups()
            if name == "Cad":
                degree, accidental, case, quality = 1, 0, "upper", "major" if key.mode == "major" else "minor"
            else:
                degree, accidental, case = 2 if name == "N" else 6, -1, "upper"
                quality = "major" if name in {"N", "Ger", "It"} else "other"
                if name in {"It", "Fr"}:
                    unsupported.append(f"{name} augmented-sixth chord is only partially factorized")
            quality_mark = ""
        else:
            match = re.fullmatch(
                r"(?P<acc>[#b]*)(?P<num>[ivIV]+)(?P<quality>maj|[oø+]?)(?P<figure>[#b0-9-]*)",
                core,
            )
            if not match:
                return ParseResult(raw, NOTATION, "failure", None, ("Unsupported RomanText chord",))
            degree_info = _roman_degree(match["acc"] + match["num"])
            if degree_info is None:
                return ParseResult(raw, NOTATION, "failure", None, ("Invalid Roman numeral",))
            degree, accidental, case = degree_info
            quality_mark = match["quality"]
            figure = match["figure"]
            quality = "major" if case == "upper" else "minor"
            if quality_mark == "o":
                quality = "diminished"
            elif quality_mark == "ø":
                quality = "diminished"
            elif quality_mark == "+":
                quality = "augmented"
            elif quality_mark == "maj":
                quality = "major"
        try:
            harmonic_key = _temporary_key(key, applied)
        except ValueError as error:
            return ParseResult(raw, NOTATION, "failure", None, (str(error),))
        root = _pitch_for_degree(harmonic_key, degree, accidental, quality_case=case)
        is_seventh = (
            any(token in figure for token in ("7", "65", "43", "42"))
            or figure == "2" or quality_mark == "ø"
        )
        if is_seventh:
            if quality_mark == "o":
                seventh = "diminished7"
            elif quality_mark == "maj":
                seventh = "major7"
            elif quality_mark == "ø" or degree == 5:
                seventh = "minor7"
            elif quality == "major" and (
                (harmonic_key.mode == "major" and degree in {1, 4})
                or (harmonic_key.mode == "minor" and degree in {3, 6})
            ):
                seventh = "major7"
            else:
                seventh = "minor7"
        else:
            seventh = "none"
        extensions = set()
        alterations = set()
        if "9" in figure:
            extensions.add(9)
        for group in brackets:
            for token in re.findall(r"(?:add|no)?[#b]?\d+", group):
                if token.startswith("no"):
                    unsupported.append(token)
                    continue
                if token.startswith("add"):
                    value = token[3:]
                    if value in {"2", "9"}:
                        extensions.add(9)
                    elif value in {"4", "11"}:
                        extensions.add(11)
                    elif value in {"6", "13"}:
                        extensions.add(6 if value == "6" else 13)
                    else:
                        unsupported.append(token)
                    continue
                if token in {"b5", "#5", "b9", "#9", "#11", "b13"}:
                    alterations.add(token)
                    if token[1:] != "5":
                        extensions.add(int(token[1:]))
                else:
                    unsupported.append(token)
        # Suffix alterations such as Vb9 and IV6b5 occur in the allowlist.
        for token in re.findall(r"[b#](?:5|9|11|13)", figure):
            if token in {"b5", "#5", "b9", "#9", "#11", "b13"}:
                alterations.add(token)
                if token[1:] != "5":
                    extensions.add(int(token[1:]))
            figure = figure.replace(token, "")
        third = 3 if quality in {"minor", "diminished"} else 4
        fifth = 6 if quality == "diminished" else 8 if quality == "augmented" else 7
        bass = None
        digits = re.sub(r"[^0-9]", "", figure)
        if digits in {"6", "65", "63"}:
            bass = _member(root, 2, third)
        elif digits in {"64", "43"} or special and special[1] in {"64", "43"}:
            bass = _member(root, 4, fifth)
        elif digits in {"42", "2"}:
            seventh_interval = 9 if seventh == "diminished7" else 11 if seventh == "major7" else 10
            bass = _member(root, 6, seventh_interval)
        components = ChordComponents(quality, seventh, tuple(extensions), tuple(alterations))
        chord = SymbolicChord(root, components, bass)
        if unsupported:
            return ParseResult(raw, NOTATION, "partial", chord, tuple(unsupported))
        return ParseResult(raw, NOTATION, "ok", chord)


def _meter(text: str) -> Tuple[int, int]:
    normalized = text.strip().casefold()
    if normalized == "c":
        return 4, 4
    if normalized == "cut":
        return 2, 2
    normalized = re.sub(r"^(slow|fast)\s+", "", normalized)
    match = re.fullmatch(r"(\d+)/(\d+)", normalized)
    if not match:
        raise ValueError(f"Unsupported RomanText time signature: {text!r}")
    return int(match[1]), int(match[2])


def _specs(content: str, line_number: int) -> List[_Spec]:
    content = re.sub(r"([A-Ga-g][#b-]*)\s*:\s*", r"\1: ", content)
    tokens = content.replace("||", " || ").split()
    beat = 1.0
    pending_key = None
    pivot = False
    result = []
    for token in tokens:
        beat_match = re.fullmatch(r"b(\d+(?:\.\d+)?)(?:\.\d+)?", token)
        if beat_match:
            beat = float(beat_match[1])
            continue
        if token == "||":
            pivot = True
            continue
        if token.endswith(":"):
            pending_key = token[:-1]
            continue
        if token == ":" or token.startswith("var"):
            continue
        spec = _Spec(beat, token, pending_key, line_number)
        pending_key = None
        if pivot and result and result[-1].beat == beat:
            result[-1] = spec
        else:
            result.append(spec)
        pivot = False
    return result


def convert_file(path: Path, corpus_root: Path) -> ConvertedSong:
    lines = path.read_text(encoding="utf-8-sig").splitlines()
    headers = {}
    definitions: Dict[int, List[_Spec]] = {}
    meters: Dict[int, Tuple[int, int]] = {}
    sections: Dict[int, Optional[str]] = {}
    forms = []
    pedals = []
    current_meter = (4, 4)
    pending_meter = current_meter
    current_section = None
    for line_number, line in enumerate(lines, 1):
        stripped = line.strip()
        header = re.match(r"^(Composer|Title|Analyst):\s*(.*)$", stripped)
        if header:
            headers[header[1].casefold()] = header[2].strip()
            continue
        if stripped.casefold().startswith("time signature:"):
            pending_meter = _meter(stripped.split(":", 1)[1])
            continue
        if stripped.startswith("Form:"):
            current_section = stripped.split(":", 1)[1].strip() or None
            forms.append({"line": line_number, "value": current_section})
            continue
        if stripped.startswith("Pedal:"):
            pedals.append({"line": line_number, "value": stripped.split(":", 1)[1].strip()})
            continue
        measure = re.match(r"^m(\d+)(?:-(\d+))?\s+(.*)$", stripped)
        if not measure:
            continue
        start = int(measure[1])
        end = int(measure[2] or start)
        content = measure[3].strip()
        repeat = re.fullmatch(r"=\s*m?(\d+)(?:-(\d+))?(?:\s*\|\|)?", content)
        if repeat:
            source_start = int(repeat[1])
            source_end = int(repeat[2] or source_start)
            if end - start != source_end - source_start:
                raise ValueError(f"{path}:{line_number}: repeat range lengths differ")
            for offset, target in enumerate(range(start, end + 1)):
                source_measure = source_start + offset
                # Omitted source measures contain no chord change; RomanText
                # repeats may include them in a larger range.
                definitions[target] = list(definitions.get(source_measure, ()))
                meters[target] = pending_meter
                sections[target] = current_section
            current_meter = pending_meter
            continue
        if start != end:
            raise ValueError(f"{path}:{line_number}: ranged measures require repeat syntax")
        definitions[start] = _specs(content, line_number)
        meters[start] = pending_meter
        sections[start] = current_section
        current_meter = pending_meter

    all_specs = [spec for measure in sorted(definitions) for spec in definitions[measure]]
    first_key = None
    for spec in all_specs:
        if spec.key_text:
            try:
                first_key = _parse_key_token(spec.key_text)
                break
            except ValueError:
                pass
    global_annotation = KeyAnnotation(first_key, "annotated") if first_key else None
    current_key = first_key
    parser = RomanTextChordParser()
    events = []
    boundaries = []
    for measure in sorted(definitions):
        for spec_index, spec in enumerate(definitions[measure]):
            if spec.key_text:
                try:
                    current_key = _parse_key_token(spec.key_text)
                except ValueError:
                    current_key = None
            parsed = parser.parse(spec.roman, current_key)
            local_annotation = (
                KeyAnnotation(current_key, "annotated")
                if current_key and (not first_key or current_key != first_key)
                else None
            )
            reference = f"when-in-rome:{path.relative_to(corpus_root)}:line:{spec.source_line}:event:{spec_index}"
            events.append(normalize(
                parsed,
                global_key=global_annotation,
                local_key=local_annotation,
                style="classical",
                context=EventContext(
                    duration=None,
                    beat_position=max(0.0, spec.beat - 1),
                    bar_position=max(0, measure - 1),
                    meter=meters.get(measure, current_meter),
                    section=sections.get(measure),
                ),
                source_reference=reference,
            ))
            if parsed.status in {"failure", "no_chord"}:
                boundaries.append(Boundary(len(events) - 1, reference, parsed.status))
    relative = path.relative_to(corpus_root)
    parts = relative.parts
    creator = headers.get("composer", parts[-4].replace("_", " ") if len(parts) >= 4 else "")
    title = headers.get("title", parts[-2].replace("_", " "))
    work = stable_id("when-in-rome-work", creator, title, "/".join(parts[:-1]))
    song_id = stable_id("when-in-rome-analysis", str(relative))
    song = Song(song_id, work, provenance("when_in_rome", ADAPTER_VERSION), tuple(events))
    return ConvertedSong(
        song, title, creator, "OpenScore-LiederCorpus", tuple(boundaries),
        {
            "path": str(relative),
            "analyst": headers.get("analyst", ""),
            "license_allowlist": "openscore_lieder_new_analyses",
            "form_markers": forms,
            "pedal_markers": pedals,
            "romantext_measure_repeats_expanded": True,
            "duration_note": "RomanText beat units vary with meter; source beats are preserved and duration remains unknown",
        },
    )


def convert_dataset(raw_root: Path) -> List[ConvertedSong]:
    roots = [path for path in raw_root.rglob("Corpus/OpenScore-LiederCorpus") if path.is_dir()]
    if len(roots) != 1:
        raise ValueError(f"Expected exactly one allowlisted OpenScore-LiederCorpus below {raw_root}")
    corpus_root = roots[0]
    paths = sorted(corpus_root.rglob("analysis.txt"))
    if len(paths) != 179:
        raise ValueError(f"Allowlist expects 179 analyses, found {len(paths)}")
    return [convert_file(path, corpus_root) for path in paths]
