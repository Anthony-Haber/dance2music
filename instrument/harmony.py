"""Explicit musical vocabulary and absolute, path-independent selections."""

import math
from dataclasses import dataclass

from instrument.models import Frame

ROOT_NAMES = ("C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")
INTERVALS = {
    "major": (0, 4, 7),
    "minor": (0, 3, 7),
    "dominant7": (0, 4, 7, 10),
    "major7": (0, 4, 7, 11),
    "minor7": (0, 3, 7, 10),
    "minor_major7": (0, 3, 7, 11),
    "half_diminished7": (0, 3, 6, 10),
    "diminished7": (0, 3, 6, 9),
    "major6": (0, 4, 7, 9),
    "minor6": (0, 3, 7, 9),
    "major69": (0, 4, 7, 9, 14),
    "minor69": (0, 3, 7, 9, 14),
    "major9": (0, 4, 7, 11, 14),
    "minor9": (0, 3, 7, 10, 14),
    "dominant9": (0, 4, 7, 10, 14),
    # Fuller 13ths include 9 and 13, omitting the natural 11th.
    "major13": (0, 4, 7, 11, 14, 21),
    "minor13": (0, 3, 7, 10, 14, 21),
    "dominant13": (0, 4, 7, 10, 14, 21),
    "minor11": (0, 3, 7, 10, 14, 17),
    "sus4": (0, 5, 7),
    "dominant7sus4": (0, 5, 7, 10),
    "augmented": (0, 4, 8),
    "dominant7b9": (0, 4, 7, 10, 13),
    "dominant7sharp9": (0, 4, 7, 10, 15),
    "major7sharp11": (0, 4, 7, 11, 18),
}
SUFFIXES = {
    "major": "",
    "minor": "m",
    "dominant7": "7",
    "major7": "maj7",
    "minor7": "m7",
    "minor_major7": "m(maj7)",
    "half_diminished7": "m7b5",
    "diminished7": "dim7",
    "major6": "6",
    "minor6": "m6",
    "major69": "6/9",
    "minor69": "m6/9",
    "major9": "maj9",
    "minor9": "m9",
    "dominant9": "9",
    "major13": "maj13",
    "minor13": "m13",
    "dominant13": "13",
    "minor11": "m11",
    "sus4": "sus4",
    "dominant7sus4": "7sus4",
    "augmented": "aug",
    "dominant7b9": "7b9",
    "dominant7sharp9": "7#9",
    "major7sharp11": "maj7#11",
}
MAX_VOICES = max(len(intervals) for intervals in INTERVALS.values())
CHORD_SIGNS = ("Open_Palm", "Pointing_Up", "Victory", "Thumb_Up", "Thumb_Down")
# Rows are RIGHT body hand, columns LEFT; pair keys remain (left, right).
QUALITY_ROWS = (
    ("major", "minor6", "half_diminished7", "major6", "major69"),
    ("minor", "minor11", "minor9", "minor13", "minor69"),
    ("diminished7", "dominant7b9", "augmented", "dominant7sharp9", "dominant7sus4"),
    ("major7", "major9", "major7sharp11", "major13", "minor_major7"),
    ("minor7", "dominant9", "sus4", "dominant7", "dominant13"),
)
QUALITY_PAIRS = {
    (left, right): quality
    for right, row in zip(CHORD_SIGNS, QUALITY_ROWS, strict=True)
    for left, quality in zip(CHORD_SIGNS, row, strict=True)
}


def gesture_quality(left: str | None, right: str | None) -> str | None:
    """Only complete ordered pairs select a quality; uncertain/fist signs hold it."""
    return QUALITY_PAIRS.get((left, right)) if left is not None and right is not None else None


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


def _assignment_costs(moves: tuple[tuple[int, ...], ...], maximum: int) -> list[int]:
    """Minimum remaining total movement for each assigned-pitch bit mask.

    A mask's bit count identifies the next oscillator. Child masks are larger,
    so descending masks compute every suffix before its parent in O(n * 2**n).
    The movement limit lets reconstruction preserve maximum-movement tie breaks.
    """
    count = len(moves)
    full = (1 << count) - 1
    costs = [10000] * (full + 1)
    costs[full] = 0
    for mask in range(full - 1, -1, -1):
        row = moves[mask.bit_count()]
        remaining = full ^ mask
        while remaining:
            bit = remaining & -remaining
            column = bit.bit_length() - 1
            if row[column] <= maximum:
                costs[mask] = min(costs[mask], row[column] + costs[mask | bit])
            remaining ^= bit
    return costs


def voice_lead(previous: tuple[int, ...], chord: Chord, register_shift: int = 0) -> tuple[int, ...]:
    """Distinct chord pitches in shifted MIDI [48,83], clipped to MIDI [0,127].

    A changed voice count uses root position to avoid silently adding or dropping
    chord tones. Same-count transitions minimize total movement, then largest
    individual movement, then the oscillator note tuple, without factorial search.
    register_shift must be whole octaves; zero preserves the original voicings.
    """
    if not isinstance(register_shift, int) or register_shift % 12:
        raise ValueError("Register shift must be an integer number of semitones in whole octaves")
    root_position = tuple(48 + register_shift + chord.root + i for i in INTERVALS[chord.quality])
    if any(not 0 <= note <= 127 for note in root_position):
        raise ValueError("Chord register exceeds MIDI range")
    if len(previous) != len(chord.pitch_classes):
        return root_position
    low, high = max(0, 48 + register_shift), min(127, 83 + register_shift)
    candidates = tuple(
        tuple(
            min(range(low + (pc - low) % 12, high + 1, 12), key=lambda n: (abs(n - old), n))
            for pc in chord.pitch_classes
        )
        for old in previous
    )
    moves = tuple(
        tuple(abs(note - old) for note in row)
        for old, row in zip(previous, candidates, strict=True)
    )
    lower, upper = 0, max(max(row) for row in moves)
    optimum = _assignment_costs(moves, upper)[0]
    while lower < upper:
        middle = (lower + upper) // 2
        if _assignment_costs(moves, middle)[0] == optimum:
            upper = middle
        else:
            lower = middle + 1
    costs = _assignment_costs(moves, lower)
    mask = 0
    notes = []
    for row, choices in enumerate(candidates):
        eligible = (
            column
            for column in range(len(previous))
            if not mask & (1 << column)
            and moves[row][column] <= lower
            and moves[row][column] + costs[mask | (1 << column)] == costs[mask]
        )
        column = min(eligible, key=lambda column: choices[column])
        notes.append(choices[column])
        mask |= 1 << column
    return tuple(notes)
