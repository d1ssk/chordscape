"""Small, dependency-free Standard MIDI File reader for dataset annotations."""
from __future__ import annotations

from dataclasses import dataclass
import struct
from typing import List, Tuple


@dataclass(frozen=True)
class MidiNote:
    start: int
    end: int
    pitch: int
    channel: int


@dataclass(frozen=True)
class MidiTrack:
    name: str
    notes: Tuple[MidiNote, ...]


@dataclass(frozen=True)
class MidiFile:
    ticks_per_beat: int
    tracks: Tuple[MidiTrack, ...]
    key_signatures: Tuple[Tuple[int, int, int], ...]
    time_signatures: Tuple[Tuple[int, int, int], ...]


def _vlq(data: bytes, position: int) -> Tuple[int, int]:
    value = 0
    for _ in range(4):
        if position >= len(data):
            raise ValueError("truncated MIDI variable-length quantity")
        byte = data[position]
        position += 1
        value = (value << 7) | (byte & 0x7F)
        if not byte & 0x80:
            return value, position
    raise ValueError("MIDI variable-length quantity is too long")


def read_midi(data: bytes) -> MidiFile:
    if len(data) < 14 or data[:4] != b"MThd":
        raise ValueError("not a Standard MIDI File")
    header_length = struct.unpack(">I", data[4:8])[0]
    if header_length < 6:
        raise ValueError("invalid MIDI header")
    track_count, division = struct.unpack(">HH", data[10:14])
    if division & 0x8000:
        raise ValueError("SMPTE MIDI division is unsupported")
    position = 8 + header_length
    tracks = []
    key_signatures = []
    time_signatures = []
    for _ in range(track_count):
        if data[position:position + 4] != b"MTrk" or position + 8 > len(data):
            raise ValueError("missing MIDI track chunk")
        length = struct.unpack(">I", data[position + 4:position + 8])[0]
        track_data = data[position + 8:position + 8 + length]
        if len(track_data) != length:
            raise ValueError("truncated MIDI track")
        position += 8 + length
        track_position = 0
        tick = 0
        running_status = None
        name = ""
        active = {}
        notes: List[MidiNote] = []
        while track_position < len(track_data):
            delta, track_position = _vlq(track_data, track_position)
            tick += delta
            if track_position >= len(track_data):
                raise ValueError("truncated MIDI event")
            first = track_data[track_position]
            if first >= 0x80:
                status = first
                track_position += 1
                if status < 0xF0:
                    running_status = status
            elif running_status is not None:
                status = running_status
            else:
                raise ValueError("MIDI running status without prior channel status")
            if status == 0xFF:
                if track_position >= len(track_data):
                    raise ValueError("truncated MIDI meta event")
                kind = track_data[track_position]
                track_position += 1
                size, track_position = _vlq(track_data, track_position)
                payload = track_data[track_position:track_position + size]
                if len(payload) != size:
                    raise ValueError("truncated MIDI meta payload")
                track_position += size
                if kind == 0x03:
                    name = payload.decode("latin-1", errors="replace")
                elif kind == 0x59 and size == 2:
                    sharps = struct.unpack("b", payload[:1])[0]
                    key_signatures.append((tick, sharps, payload[1]))
                elif kind == 0x58 and size >= 2:
                    time_signatures.append((tick, payload[0], 2 ** payload[1]))
                if kind == 0x2F:
                    break
                continue
            if status in {0xF0, 0xF7}:
                size, track_position = _vlq(track_data, track_position)
                track_position += size
                continue
            kind = status & 0xF0
            channel = status & 0x0F
            size = 1 if kind in {0xC0, 0xD0} else 2
            payload = track_data[track_position:track_position + size]
            if len(payload) != size:
                raise ValueError("truncated MIDI channel event")
            track_position += size
            if kind not in {0x80, 0x90}:
                continue
            pitch = payload[0]
            is_on = kind == 0x90 and payload[1] > 0
            key = channel, pitch
            if is_on:
                active.setdefault(key, []).append(tick)
            elif active.get(key):
                start = active[key].pop(0)
                if tick > start:
                    notes.append(MidiNote(start, tick, pitch, channel))
        tracks.append(MidiTrack(name, tuple(sorted(notes, key=lambda n: (n.start, n.pitch, n.end)))))
    return MidiFile(
        division,
        tuple(tracks),
        tuple(sorted(set(key_signatures))),
        tuple(sorted(set(time_signatures))),
    )
