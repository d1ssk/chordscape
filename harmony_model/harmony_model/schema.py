"""Versioned, immutable symbolic data. Unknown is distinct from absent."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from math import isfinite
from typing import Optional, Tuple

SCHEMA_VERSION = 1
LETTERS = "CDEFGAB"
NATURALS = (0, 2, 4, 5, 7, 9, 11)
MODES = {"major": (0, 2, 4, 5, 7, 9, 11), "minor": (0, 2, 3, 5, 7, 8, 10)}
QUALITIES = {"major", "minor", "diminished", "augmented", "sus2", "sus4", "power", "no3", "other"}
SEVENTHS = {"none", "minor7", "major7", "diminished7"}
EXTENSIONS = (6, 9, 11, 13)
ALTERATIONS = ("b5", "#5", "b9", "#9", "#11", "b13")
STYLES = {"pop", "jazz", "classical"}


def integer(value: int, name: str) -> None:
    if type(value) is not int:
        raise ValueError(f"{name} must be an integer")


@dataclass(frozen=True)
class Pitch:
    letter: str
    accidental: int = 0

    def __post_init__(self) -> None:
        if self.letter not in tuple(LETTERS):
            raise ValueError("Invalid pitch letter")
        integer(self.accidental, "accidental")

    @property
    def pitch_class(self) -> int:
        return (NATURALS[LETTERS.index(self.letter)] + self.accidental) % 12


@dataclass(frozen=True)
class Key:
    tonic: Pitch
    mode: str

    def __post_init__(self) -> None:
        if not isinstance(self.tonic, Pitch) or self.mode not in MODES:
            raise ValueError("Key requires a spelled tonic and major/minor mode")


@dataclass(frozen=True)
class KeyAnnotation:
    key: Key
    origin: str
    evidence: Optional[str] = None

    def __post_init__(self) -> None:
        if not isinstance(self.key, Key) or self.origin not in {"annotated", "estimated", "user"}:
            raise ValueError("Invalid key annotation")
        if self.origin == "estimated" and not self.evidence:
            raise ValueError("Estimated keys require estimator/version evidence")


@dataclass(frozen=True)
class RelativePitch:
    degree: int
    accidental: int

    def __post_init__(self) -> None:
        integer(self.degree, "degree")
        integer(self.accidental, "accidental")
        if not 1 <= self.degree <= 7:
            raise ValueError("degree must be 1..7")


@dataclass(frozen=True)
class ChordComponents:
    quality: str
    seventh: Optional[str]
    extensions: Optional[Tuple[int, ...]]
    alterations: Optional[Tuple[str, ...]]

    def __post_init__(self) -> None:
        if self.quality not in QUALITIES or (self.seventh is not None and self.seventh not in SEVENTHS):
            raise ValueError("Invalid chord quality/seventh")
        for name, vocabulary in (("extensions", EXTENSIONS), ("alterations", ALTERATIONS)):
            values = getattr(self, name)
            if values is not None:
                if not isinstance(values, tuple) or any(v not in vocabulary for v in values):
                    raise ValueError(f"Invalid {name}")
                object.__setattr__(self, name, tuple(v for v in vocabulary if v in values))
        if self.extensions is not None and self.alterations is not None:
            for alteration in self.alterations:
                number = int(alteration[1:])
                if number != 5 and number not in self.extensions:
                    raise ValueError("Altered extensions must also occur in extensions")


@dataclass(frozen=True)
class SymbolicChord:
    root: Pitch
    components: ChordComponents
    bass: Optional[Pitch] = None

    def __post_init__(self) -> None:
        if not isinstance(self.root, Pitch) or not isinstance(self.components, ChordComponents):
            raise ValueError("Invalid symbolic chord")
        if self.bass is not None and not isinstance(self.bass, Pitch):
            raise ValueError("Invalid spelled bass")


@dataclass(frozen=True)
class ParseResult:
    raw_chord: str
    source_notation: str
    status: str
    chord: Optional[SymbolicChord]
    diagnostics: Tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.status not in {"ok", "partial", "failure", "no_chord"}:
            raise ValueError("Invalid parse status")
        if (self.status in {"ok", "partial"}) != (self.chord is not None):
            raise ValueError("Parse status contradicts chord presence")
        if self.status in {"partial", "failure"} and not self.diagnostics:
            raise ValueError("Incomplete parsing requires a diagnostic")


@dataclass(frozen=True)
class ChordFactors:
    root: Optional[RelativePitch]
    components: ChordComponents
    bass: Optional[RelativePitch] = None


@dataclass(frozen=True)
class EventContext:
    # Quarter-note units; beat and bar positions are zero-based.
    duration: Optional[float] = None
    beat_position: Optional[float] = None
    bar_position: Optional[int] = None
    meter: Optional[Tuple[int, int]] = None
    phrase: Optional[str] = None
    section: Optional[str] = None

    def __post_init__(self) -> None:
        for name in ("duration", "beat_position"):
            value = getattr(self, name)
            if value is not None and (type(value) not in (float, int) or not isfinite(value) or value < 0):
                raise ValueError(f"Invalid {name}")
        if self.duration == 0:
            raise ValueError("duration must be positive when known")
        if self.bar_position is not None:
            integer(self.bar_position, "bar_position")
            if self.bar_position < 0:
                raise ValueError("bar_position must be nonnegative")
        if self.meter is not None and (
            not isinstance(self.meter, tuple) or len(self.meter) != 2
            or any(type(v) is not int or v <= 0 for v in self.meter)
        ):
            raise ValueError("meter must contain positive numerator/denominator")


@dataclass(frozen=True)
class ChordEvent:
    parsed: ParseResult
    factors: Optional[ChordFactors]
    global_key: Optional[KeyAnnotation]
    local_key: Optional[KeyAnnotation]
    key_basis: str
    style: Optional[str] = None
    context: EventContext = field(default_factory=EventContext)
    source_reference: Optional[str] = None
    schema_version: int = SCHEMA_VERSION

    def __post_init__(self) -> None:
        expected_basis = "local" if self.local_key else "global_fallback" if self.global_key else "missing"
        if self.key_basis != expected_basis or self.schema_version != SCHEMA_VERSION:
            raise ValueError("Invalid key basis/schema version")
        if self.style is not None and self.style not in STYLES:
            raise ValueError("Training style must be pop/jazz/classical or unknown")
        if (self.parsed.chord is None) != (self.factors is None):
            raise ValueError("Factors contradict parse result")


@dataclass(frozen=True)
class Provenance:
    source: str
    version: str
    url: str
    license: str
    download_date: str
    conversion_notes: str

    def __post_init__(self) -> None:
        if not all((self.source, self.version, self.url, self.license, self.conversion_notes)):
            raise ValueError("Provenance fields must be recorded explicitly")
        date.fromisoformat(self.download_date)


@dataclass(frozen=True)
class Song:
    song_id: str
    work_id: str
    provenance: Provenance
    events: Tuple[ChordEvent, ...]

    def __post_init__(self) -> None:
        if not self.song_id or not self.work_id:
            raise ValueError("Song and work grouping IDs are required")
        if not isinstance(self.events, tuple) or any(not isinstance(e, ChordEvent) for e in self.events):
            raise ValueError("events must be a tuple of ChordEvent")
