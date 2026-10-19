"""Pure MIDI output lifecycle; no devices, imports with side effects or downloads.

Input notes are integer MIDI pitches [0,127]; gain is unitless [0,1].
The browser adapter supplies either the voiced chord or its root-only trigger.
"""

from collections.abc import Iterable, Sequence
from math import dist, floor, isfinite

Message = tuple[int, int, int]


def hand_span_gain(landmarks: Sequence[tuple[float, ...] | None]) -> float:
    """Linear wrist-span fraction from 33 pose points in consistent 2D/3D units.

    Full reach is the shoulder width plus both upper arms and forearms, measured
    from the current pose, without a calibration recording. A quarter shoulder
    width is the hands-together dead zone (wrists are apart when palms touch).
    Prefer world coordinates to retain limb lengths when arms point at camera.
    Missing, mixed-dimension or degenerate arm geometry returns silent zero.
    """
    if len(landmarks) != 33:
        return 0.0
    chain = [landmarks[index] for index in (15, 13, 11, 12, 14, 16)]
    if any(point is None for point in chain):
        return 0.0
    points = [point for point in chain if point is not None]
    dimensions = len(points[0])
    if dimensions not in (2, 3) or any(
        len(point) != dimensions or not all(isfinite(value) for value in point) for point in points
    ):
        return 0.0
    lengths = [dist(a, b) for a, b in zip(points, points[1:], strict=False)]
    if min(lengths) <= 0:
        return 0.0
    together = lengths[2] * 0.25
    maximum = sum(lengths)
    return min(1.0, max(0.0, (dist(points[0], points[-1]) - together) / (maximum - together)))


class MidiSpan:
    """Keep captured energy when a two-hand ball transfers to one hand."""

    def __init__(self) -> None:
        self.gain = 0.0
        self.owner: str | None = None

    def update(
        self,
        landmarks: Sequence[tuple[float, ...] | None],
        owner: str | None = None,
        active: bool = True,
    ) -> float:
        if owner is None or self.owner is None:
            self.gain = hand_span_gain(landmarks)
        self.owner = owner
        return self.gain if active else 0.0


class MidiNotes:
    """Refresh held-note velocity as ball gain changes; also send expression CC11."""

    def __init__(self, channel: int = 1) -> None:
        if type(channel) is not int or not 1 <= channel <= 16:
            raise ValueError("MIDI channel must be an integer in [1,16]")
        self.channel = channel - 1
        self.active: set[int] = set()
        self.expression: int | None = None
        self.velocity: int | None = None

    def update(self, notes: Iterable[int], gain: float) -> list[Message]:
        """Return immediate ordered messages; invalid observations safely release."""
        pitches = tuple(notes)
        if (
            not isfinite(gain)
            or not 0 <= gain <= 1
            or any(type(note) is not int or not 0 <= note <= 127 for note in pitches)
        ):
            return self.release()
        wanted = set(pitches) if gain > 0 else set()
        expression = floor(gain * 127 + 0.5) if wanted else 0
        velocity = max(1, expression) if wanted else None
        # MIDI 1.0 velocity is an attack property: release before restarting
        # common notes at the new level. Equal quantized levels keep sustaining.
        refreshed = self.active & wanted if velocity != self.velocity else set()
        messages: list[Message] = [
            (0x80 + self.channel, note, 0) for note in sorted((self.active - wanted) | refreshed)
        ]
        if expression != self.expression:
            messages.append((0xB0 + self.channel, 11, expression))
            self.expression = expression
        messages.extend(
            (0x90 + self.channel, note, max(1, expression))
            for note in sorted((wanted - self.active) | refreshed)
        )
        self.active = wanted
        self.velocity = velocity
        return messages

    def release(self, panic: bool = False) -> list[Message]:
        """Release owned notes; panic additionally clears sustain and all notes."""
        messages: list[Message] = [(0x80 + self.channel, note, 0) for note in sorted(self.active)]
        self.active.clear()
        if self.expression != 0:
            messages.append((0xB0 + self.channel, 11, 0))
        self.expression = 0
        self.velocity = None
        if panic:
            messages.extend([(0xB0 + self.channel, 64, 0), (0xB0 + self.channel, 123, 0)])
        return messages
