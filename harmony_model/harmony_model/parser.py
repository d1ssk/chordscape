"""Small, explicitly versioned chord dialect, not a universal corpus parser."""
from __future__ import annotations

import re
from typing import Protocol

from .schema import ChordComponents, Key, ParseResult, Pitch, SymbolicChord

NOTATION = "plain-v1"
PITCH_PATTERN = r"[A-G](?:#+|b+)?"
TRANSLATION = str.maketrans({"♭": "b", "♯": "#", "𝄫": "bb", "𝄪": "##"})


def parse_pitch(text: str) -> Pitch:
    text = text.translate(TRANSLATION)
    if not re.fullmatch(PITCH_PATTERN, text):
        raise ValueError(f"Unsupported pitch: {text!r}")
    return Pitch(text[0], text[1:].count("#") - text[1:].count("b"))


def parse_key(text: str) -> Key:
    match = re.fullmatch(r"(.+):(maj|major|min|minor)", text)
    if not match:
        raise ValueError("Key must use tonic:maj or tonic:min")
    return Key(parse_pitch(match[1]), "major" if match[2] in {"maj", "major"} else "minor")


class ChordParser(Protocol):
    def parse(self, raw: str) -> ParseResult:
        """Return raw notation and a diagnostic; never silently drop an event."""
        ...


def _base_components(base: str):
    special = {
        "": ("major", "none", ()),
        "maj": ("major", "none", ()),
        "M": ("major", "none", ()),
        "m": ("minor", "none", ()),
        "dim": ("diminished", "none", ()),
        "dim7": ("diminished", "diminished7", ()),
        "aug": ("augmented", "none", ()),
        "+": ("augmented", "none", ()),
        "sus2": ("sus2", "none", ()),
        "sus4": ("sus4", "none", ()),
        "7sus4": ("sus4", "minor7", ()),
        "5": ("power", "none", ()),
        "6/9": ("major", "none", (6, 9)),
        "m6/9": ("minor", "none", (6, 9)),
    }
    if base in special:
        return special[base]
    match = re.fullmatch(r"(mMaj|mmaj|mM|maj|Maj|M|m)?(6|7|9|11|13)", base)
    if not match:
        return None
    prefix, number = match[1] or "", int(match[2])
    if number == 6 and prefix not in {"", "m"}:
        return None
    quality = "minor" if prefix.startswith("m") and not prefix.startswith("maj") else "major"
    seventh = "none" if number == 6 else "major7" if prefix not in {"", "m"} else "minor7"
    return quality, seventh, () if number == 7 else (number,)


class PlainChordParser:
    def parse(self, raw: str) -> ParseResult:
        text = raw.strip().translate(TRANSLATION).replace("°", "dim")

        def failure(reason: str) -> ParseResult:
            return ParseResult(raw, NOTATION, "failure", None, (reason,))

        if text in {"N", "NC", "N.C."}:
            return ParseResult(raw, NOTATION, "no_chord", None)
        match = re.match(PITCH_PATTERN, text)
        if not match:
            return failure("Unrecognized spelled root")
        root = parse_pitch(match[0])
        suffix = text[match.end():]
        bass = None
        slash = re.search(r"/(" + PITCH_PATTERN + r")$", suffix)
        if slash:
            bass = parse_pitch(slash[1])
            suffix = suffix[:slash.start()]
        # Only the 6/9 extension may contain a remaining slash.
        if "/" in suffix and not re.match(r"^m?6/9(?:$|\(|add|[#b])", suffix):
            return failure("Malformed slash bass")
        # Parentheses may group modifiers or a minor-major seventh, but must balance.
        depth = 0
        for char in suffix:
            if char == "(":
                depth += 1
                if depth > 1:
                    return failure("Nested parentheses are unsupported")
            elif char == ")":
                depth -= 1
                if depth < 0:
                    return failure("Unbalanced parentheses")
        if depth:
            return failure("Unbalanced parentheses")
        if "()" in suffix or suffix.endswith(",") or ",," in suffix:
            return failure("Empty chord modifier")
        suffix = suffix.replace("(", "").replace(")", "")
        modifier = re.search(r"add|[b#]", suffix)
        base = suffix[:modifier.start()] if modifier else suffix
        tail = suffix[modifier.start():] if modifier else ""
        components = _base_components(base)
        tokens = []
        remaining = tail
        while remaining:
            token = re.match(r"(?:add(?:13|11|9|6)|b13|#11|b9|#9|b5|#5)", remaining)
            if not token:
                components = None
                break
            tokens.append(token[0])
            remaining = remaining[token.end():]
            if remaining.startswith(","):
                remaining = remaining[1:]
                if not remaining:
                    components = None
        if components is None:
            chord = SymbolicChord(root, ChordComponents("other", None, None, None), bass)
            return ParseResult(raw, NOTATION, "partial", chord, (f"Unsupported suffix: {suffix!r}; harmonic factors unknown",))
        quality, seventh, extensions = components
        extensions = set(extensions)
        alterations = set()
        for token in tokens:
            if token.startswith("add"):
                extensions.add(int(token[3:]))
            else:
                alterations.add(token)
                number = int(token[1:])
                if number != 5:
                    extensions.add(number)
        if base == "m7" and "b5" in alterations:
            quality = "diminished"
            alterations.remove("b5")
        chord = SymbolicChord(root, ChordComponents(quality, seventh, tuple(extensions), tuple(alterations)), bass)
        return ParseResult(raw, NOTATION, "ok", chord)
