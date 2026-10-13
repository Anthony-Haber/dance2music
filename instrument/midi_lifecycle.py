"""Pure MIDI output lifecycle; no devices, imports with side effects or downloads.

Input notes are integer MIDI pitches [0,127]; gain is unitless [0,1].
The browser adapter supplies either the voiced chord or its root-only trigger.
"""

from collections.abc import Iterable
from math import floor, isfinite

Message = tuple[int, int, int]


class MidiNotes:
    """Hold common notes, release removed notes, and encode gain as expression CC11."""

    def __init__(self, channel: int = 1) -> None:
        if type(channel) is not int or not 1 <= channel <= 16:
            raise ValueError("MIDI channel must be an integer in [1,16]")
        self.channel = channel - 1
        self.active: set[int] = set()
        self.expression: int | None = None

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
        messages: list[Message] = [
            (0x80 + self.channel, note, 0) for note in sorted(self.active - wanted)
        ]
        if expression != self.expression:
            messages.append((0xB0 + self.channel, 11, expression))
            self.expression = expression
        messages.extend((0x90 + self.channel, note, 100) for note in sorted(wanted - self.active))
        self.active = wanted
        return messages

    def release(self, panic: bool = False) -> list[Message]:
        """Release owned notes; panic additionally clears sustain and all notes."""
        messages: list[Message] = [(0x80 + self.channel, note, 0) for note in sorted(self.active)]
        self.active.clear()
        if self.expression != 0:
            messages.append((0xB0 + self.channel, 11, 0))
        self.expression = 0
        if panic:
            messages.extend([(0xB0 + self.channel, 64, 0), (0xB0 + self.channel, 123, 0)])
        return messages
