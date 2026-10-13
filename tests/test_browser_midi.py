"""Local Stage 1 MIDI lifecycle validation, without a MIDI driver."""

import json
from pathlib import Path

import pytest

from instrument.midi_lifecycle import MidiNotes


def test_sustain_common_notes_and_expression() -> None:
    sender = MidiNotes()
    assert sender.update([48, 52, 55], 0.5) == [
        (176, 11, 64),
        (144, 48, 100),
        (144, 52, 100),
        (144, 55, 100),
    ]
    assert sender.update([55, 48, 52, 48], 0.5) == []
    assert sender.update([48, 53, 57], 1) == [
        (128, 52, 0),
        (128, 55, 0),
        (176, 11, 127),
        (144, 53, 100),
        (144, 57, 100),
    ]
    assert sender.update([48, 53, 57], 0.25) == [(176, 11, 32)]


def test_root_trigger_quality_changes_do_not_retrigger() -> None:
    sender = MidiNotes(16)
    assert sender.update([48], 1) == [(191, 11, 127), (159, 48, 100)]
    assert sender.update([48], 1) == []
    assert sender.update([50], 1) == [(143, 48, 0), (159, 50, 100)]
    assert sender.release(True) == [(143, 50, 0), (191, 11, 0), (191, 64, 0), (191, 123, 0)]


@pytest.mark.parametrize("gain", [0, float("nan"), float("inf"), -1, 1.01])
def test_loss_and_invalid_gain_release(gain: float) -> None:
    sender = MidiNotes()
    sender.update([60], 1)
    assert sender.update([60], gain) == [(128, 60, 0), (176, 11, 0)]
    assert sender.release() == []


@pytest.mark.parametrize("notes", [[-1], [128], [60.5], [True]])
def test_invalid_pitches_release(notes: list[int]) -> None:
    sender = MidiNotes()
    sender.update([60], 1)
    assert sender.update(notes, 1) == [(128, 60, 0), (176, 11, 0)]


@pytest.mark.parametrize("channel", [0, 17, 1.5, True])
def test_invalid_channel(channel: int) -> None:
    with pytest.raises(ValueError, match="channel"):
        MidiNotes(channel)


def test_browser_reference_is_native_generated() -> None:
    """Generate and compare a compact committed native contract fixture."""
    inputs = [
        ([48, 52, 55], 0.5),
        ([48, 52, 55], 0.5),
        ([48, 53, 57], 1),
        ([48, 53, 57], 0.25),
        ([48, 53, 57], 0),
        ([60], 1),
        ([], 0),
    ]
    sender = MidiNotes(3)
    actual = [
        {"notes": notes, "gain": gain, "messages": sender.update(notes, gain)}
        for notes, gain in inputs
    ]
    serialized = json.dumps(actual, indent=2) + "\n"
    fixture = Path("tests/web/midi-reference.json")
    assert json.loads(serialized) == json.loads(fixture.read_text(encoding="utf-8"))
