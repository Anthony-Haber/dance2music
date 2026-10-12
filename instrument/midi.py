"""Optional MIDI port boundary. Importing this module never opens a device."""

import math
from collections.abc import Callable
from typing import Any, Protocol

from instrument.harmony import MAX_VOICES
from instrument.models import Output

NOTES_PORT = "dance2music - Notes to Ableton"
CHORDS_PORT = "dance2music - Chords to Ableton"
CLIENT_NAME = "dance2music Instrument"


def _backend() -> Any:
    try:
        import rtmidi
    except ImportError as error:
        raise RuntimeError(
            "MIDI requires python-rtmidi. Install with "
            "python -m pip install -r requirements/midi.txt"
        ) from error
    return rtmidi


def output_ports() -> list[str]:
    """List external destinations (IAC/loopMIDI/hardware), then release the client."""
    midi = _backend().MidiOut(name=CLIENT_NAME)
    try:
        return list(midi.get_ports())
    finally:
        midi.delete()


class MidiPort:
    """Explicit named virtual source, or an exact/unique external destination.

    RtMidi virtual outputs appear as inputs in Ableton. Deleting the native object
    is required to remove virtual endpoints; close_port alone leaves them alive.
    """

    def __init__(self, destination: str | None = None, *, virtual_name: str = NOTES_PORT) -> None:
        if destination is not None and not destination.strip():
            raise ValueError("MIDI destination name must not be empty")
        if not virtual_name.strip():
            raise ValueError("MIDI virtual source name must not be empty")
        self.name = virtual_name
        self.native: Any = _backend().MidiOut(name=CLIENT_NAME)
        try:
            if destination is None:
                self.native.open_virtual_port(virtual_name)
            else:
                ports = list(self.native.get_ports())
                matches = [i for i, name in enumerate(ports) if name == destination]
                if not matches:
                    matches = [
                        i
                        for i, name in enumerate(ports)
                        if destination.casefold() in name.casefold()
                    ]
                if len(matches) != 1:
                    reason = "not found" if not matches else "ambiguous"
                    raise ValueError(
                        f"MIDI destination {destination!r} is {reason}. "
                        f"Use --list-midi-ports and select an exact name. Available: {ports}"
                    )
                self.name = ports[matches[0]]
                self.native.open_port(matches[0], virtual_name)
        except Exception as error:
            self.native.delete()
            self.native = None
            raise RuntimeError(
                f"Cannot open MIDI port: {error}. On Windows use an existing loopMIDI "
                "destination with --midi-port; on macOS enable IAC if using that route."
            ) from error

    def send(self, message: list[int]) -> None:
        """Send one MIDI message; errors identify the selected cable."""
        if self.native is None:
            raise RuntimeError("MIDI port is closed")
        try:
            self.native.send_message(message)
        except Exception as error:
            raise RuntimeError(f"Cannot send MIDI to {self.name!r}: {error}") from error

    def close(self) -> None:
        """Idempotently release the native port/client, including virtual endpoints."""
        if self.native is not None:
            self.native.delete()
            self.native = None


class Sender(Protocol):
    name: str

    def send(self, message: list[int]) -> None: ...

    def close(self) -> None: ...


class MidiNotes:
    """One held controller root; no chord tones, volume CCs or frame retriggering."""

    mode = "held_root"

    def __init__(
        self,
        port: Sender,
        channel: int = 1,
        velocity: int = 96,
        record: Callable[[float, list[int]], None] | None = None,
    ) -> None:
        if (
            not isinstance(channel, int)
            or not isinstance(velocity, int)
            or not 1 <= channel <= 16
            or not 1 <= velocity <= 127
        ):
            raise ValueError("MIDI channel must be in [1,16] and velocity in [1,127]")
        self.port, self.channel, self.velocity = port, channel, velocity
        self.record = record
        self.notes: tuple[int, ...] = ()
        self.paused = False
        self.closed = False
        self.time_s = 0.0
        self.messages = 0

    def _send(self, message: list[int]) -> None:
        self.port.send(message)
        self.messages += 1
        if self.record is not None:
            self.record(self.time_s, message)

    def _release(self) -> None:
        """Attempt every held/partially sent note even if an earlier release fails."""
        error: Exception | None = None
        for note in self.notes:
            try:
                self._send([0x80 | (self.channel - 1), note, 0])
                self.notes = tuple(held for held in self.notes if held != note)
            except Exception as release_error:
                if error is None:
                    error = release_error
        if error is not None:
            raise error

    def _target(self, state: Output) -> tuple[int, ...]:
        active = bool(state.balls) and math.isfinite(state.gain) and state.gain > 0
        if not active or self.paused:
            return ()
        if not isinstance(state.root_midi, int) or not 0 <= state.root_midi <= 127:
            raise ValueError("MIDI root note must be an integer in [0,127]")
        return (state.root_midi,)

    def update(self, state: Output) -> None:
        """Apply an observation immediately; no new note without valid audible geometry."""
        if self.closed:
            raise RuntimeError("MIDI notes are closed")
        self.time_s = state.time_s
        target = self._target(state)
        if target != self.notes:
            self._release()
            for note in target:
                # Track the attempted note before sending, so failure cleanup can release it.
                self.notes += (note,)
                self._send([0x90 | (self.channel - 1), note, self.velocity])

    def set_paused(self, paused: bool) -> None:
        """P pause is persistent; resuming starts the next valid observation."""
        if self.closed:
            raise RuntimeError("MIDI notes are closed")
        self.paused = paused
        if paused:
            self._release()
            self._send([0xB0 | (self.channel - 1), 123, 0])

    @property
    def status(self) -> str:
        state = (
            "PAUSED" if self.paused else "WAITING" if not self.notes else f"NOTE {self.notes[0]}"
        )
        return f"MIDI: {self.port.name} | CH {self.channel} | {state} | P: pause/resume"

    def close(self) -> None:
        """Try both release messages even if one fails; always delete the endpoint."""
        if self.closed:
            return
        error: Exception | None = None
        try:
            try:
                self._release()
            except Exception as release_error:
                error = release_error
            try:
                self._send([0xB0 | (self.channel - 1), 123, 0])
            except Exception as panic_error:
                if error is None:
                    error = panic_error
        finally:
            self.closed = True
            self.notes = ()
            self.port.close()
        if error is not None:
            raise error


class MidiChords(MidiNotes):
    """Hold the controller's full voicing for an ordinary polyphonic MIDI synth.

    Changed pitch sets release the entire previous chord before starting the new
    chord, extending the root adapter's replacement contract. Identical sets hold
    without retriggering, including harmless oscillator-order changes.
    """

    mode = "held_chord"
    symbol = ""

    def _target(self, state: Output) -> tuple[int, ...]:
        self.symbol = state.symbol
        active = bool(state.balls) and math.isfinite(state.gain) and state.gain > 0
        if not active or self.paused:
            return ()
        notes = state.notes
        if (
            not 1 <= len(notes) <= MAX_VOICES
            or any(type(note) is not int or not 0 <= note <= 127 for note in notes)
            or len(set(notes)) != len(notes)
        ):
            raise ValueError(
                f"MIDI chord must contain 1-{MAX_VOICES} distinct integer notes in [0,127]"
            )
        return tuple(sorted(notes))

    @property
    def status(self) -> str:
        state = (
            "PAUSED"
            if self.paused
            else "WAITING"
            if not self.notes
            else f"CHORD {self.symbol} | NOTES {','.join(str(note) for note in self.notes)}"
        )
        return f"MIDI: {self.port.name} | CH {self.channel} | {state} | P: pause/resume"
