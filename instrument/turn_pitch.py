"""Device-free reference: confirmed body quarter turns transpose the choir.

The transposition tonic walks the original D-major scale through octaves.
Every voice shifts by the same semitone offset, retaining the current chord's
intervals. Counter snapshots deduplicate events; missed turns are not replayed.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass


@dataclass(frozen=True)
class TurnPitchConfig:
    tonic_midi: int = 62  # D4: reference key, not the choir's bass register
    scale: tuple[int, ...] = (0, 2, 4, 5, 7, 9, 11)
    min_steps: int = -7  # one octave below the initial transposition
    max_steps: int = 14  # two octaves above; retain playable choir registers


@dataclass(frozen=True)
class TurnPitchState:
    steps: int
    semitones: int
    tonic_midi: int
    changed: bool
    enabled: bool
    limit: int  # -1 lower, +1 upper; turn back to leave the limit


class TurnPitch:
    """Latch one D-major step per fresh 90-degree turn in an enabled study.

    Positive direction is the dancer's own left, independent of display mirror.
    Disabled studies use the original pitch while preserving the stored offset.
    Reset turns/Start return to D; tracking loss alone does not reset pitch.
    """

    state: TurnPitchState

    def __init__(self, config: TurnPitchConfig | None = None) -> None:
        self.config = config or TurnPitchConfig()
        self.reset()

    def reset(self) -> None:
        self._steps = 0
        self._counts = (0, 0)
        self._enabled = True
        self.state = self._state(False)

    def _state(self, changed: bool) -> TurnPitchState:
        octave, degree = divmod(self._steps, len(self.config.scale))
        offset = 12 * octave + self.config.scale[degree] if self._enabled else 0
        limit = 0
        if self._enabled:
            limit = (
                1
                if self._steps == self.config.max_steps
                else -1
                if self._steps == self.config.min_steps
                else 0
            )
        return TurnPitchState(
            self._steps, offset, self.config.tonic_midi + offset, changed, self._enabled, limit
        )

    def update(self, spin: Mapping[str, object] | None, *, enabled: bool = True) -> TurnPitchState:
        old_offset = self.state.semitones
        self._enabled = enabled
        if spin is not None:
            left, right = spin.get("left_quarter_turns"), spin.get("right_quarter_turns")
            event, tracked = spin.get("quarter_event"), spin.get("tracked")
            if (
                type(left) is int
                and type(right) is int
                and left >= 0
                and right >= 0
                and type(event) is bool
                and type(tracked) is bool
            ):
                counts = (left, right)
                previous = self._counts
                if counts == (0, 0):
                    self._steps = 0
                    self._counts = counts
                elif left >= previous[0] and right >= previous[1]:
                    self._counts = counts
                    delta = (left - previous[0], right - previous[1])
                    if enabled and tracked and event and delta in ((1, 0), (0, 1)):
                        direction = 1 if delta[0] else -1
                        self._steps = max(
                            self.config.min_steps,
                            min(self.config.max_steps, self._steps + direction),
                        )
        new_state = self._state(False)
        self.state = self._state(new_state.semitones != old_offset)
        return self.state

    def apply(self, notes: Sequence[int]) -> tuple[int, ...]:
        """Shift already-valid MIDI notes together; fail rather than clip a chord."""
        shifted = tuple(note + self.state.semitones for note in notes)
        if any(type(note) is not int or not 0 <= note <= 127 for note in shifted):
            raise ValueError("Choir transposition would leave the MIDI note range 0..127")
        return shifted
