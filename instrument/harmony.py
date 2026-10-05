"""Explicit musical vocabulary and absolute, path-independent selections."""

import math
from dataclasses import dataclass
from itertools import permutations

from instrument.models import Frame

ROOT_NAMES = ("C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")
INTERVALS = {
    "major": (0, 4, 7),
    "minor": (0, 3, 7),
    "dominant7": (0, 4, 7, 10),
    "major7": (0, 4, 7, 11),
    "minor7": (0, 3, 7, 10),
    "minor_major7": (0, 3, 7, 11),
}
SUFFIXES = {
    "major": "",
    "minor": "m",
    "dominant7": "7",
    "major7": "maj7",
    "minor7": "m7",
    "minor_major7": "m(maj7)",
}
QUALITY_GESTURES = {
    "Open_Palm": "major",
    "Pointing_Up": "minor",
    "Victory": "dominant7",
    "Thumb_Up": "major7",
    "Thumb_Down": "minor7",
    "ILoveYou": "minor_major7",
}


@dataclass(frozen=True)
class Chord:
    root: int = 0
    quality: str = "major"

    def __post_init__(self) -> None:
        if not isinstance(self.root, int) or not 0 <= self.root < 12:
            raise ValueError("Root must be an integer pitch class in [0, 11]")
        if self.quality not in INTERVALS:
            raise ValueError(f"Unsupported chord quality: {self.quality}")

    @property
    def symbol(self) -> str:
        return ROOT_NAMES[self.root] + SUFFIXES[self.quality]

    @property
    def pitch_classes(self) -> tuple[int, ...]:
        return tuple((self.root + interval) % 12 for interval in INTERVALS[self.quality])


def root_region(frame: Frame, dead_zone_torsos: float) -> int | None:
    """12 chromatic sectors clockwise from screen right; centered hands hold root."""
    if len(frame.hands) != 2 or frame.torso_center is None or frame.torso_px is None:
        return None
    midpoint = tuple(sum(h.wrist[i] for h in frame.hands) / 2 for i in (0, 1))
    dx, dy = (midpoint[i] - frame.torso_center[i] for i in (0, 1))
    if math.hypot(dx, dy) <= dead_zone_torsos * frame.torso_px:
        return None
    angle = math.atan2(dy, dx) % math.tau
    return int(math.floor(angle / (math.pi / 6) + 0.5)) % 12


def voice_lead(previous: tuple[int, ...], chord: Chord) -> tuple[int, ...]:
    """Distinct chord pitches in MIDI [48,83], minimal movement with fixed voice count.

    A changed voice count uses root position to avoid silently adding or dropping
    chord tones. Same-count transitions search all pitch-class assignments.
    """
    if len(previous) != len(chord.pitch_classes):
        return tuple(48 + chord.root + interval for interval in INTERVALS[chord.quality])
    best: tuple[tuple[int, int, tuple[int, ...]], tuple[int, ...]] | None = None
    for order in permutations(chord.pitch_classes):
        notes = tuple(
            min((n for n in range(48, 84) if n % 12 == pc), key=lambda n: (abs(n - old), n))
            for pc, old in zip(order, previous, strict=True)
        )
        moves = tuple(abs(a - b) for a, b in zip(notes, previous, strict=True))
        cost = (sum(moves), max(moves), notes)
        if best is None or cost < best[0]:
            best = cost, notes
    assert best is not None
    return best[1]
