"""Local Stage 1 MIDI lifecycle validation, without a MIDI driver."""

import json
from pathlib import Path

import pytest

from instrument.controller import Controller
from instrument.midi_lifecycle import MidiNotes
from instrument.models import Frame, Hand


def test_same_note_velocity_changes_release_then_restart_at_current_size() -> None:
    sender = MidiNotes(2)
    sender.update([60], 0.25)
    assert sender.update([60], 0.5) == [(129, 60, 0), (177, 11, 64), (145, 60, 64)]
    assert sender.update([60], 0.5) == []
    assert sender.update([60], 0.1) == [(129, 60, 0), (177, 11, 13), (145, 60, 13)]
    assert sender.release(True) == [(129, 60, 0), (177, 11, 0), (177, 64, 0), (177, 123, 0)]


@pytest.mark.parametrize("gain,velocity", [(1e-9, 1), (0.25, 32), (0.5, 64), (1, 127)])
def test_ball_gain_updates_new_and_held_note_velocity(gain: float, velocity: int) -> None:
    sender = MidiNotes()
    messages = sender.update([48, 52, 55], gain)
    assert [message for message in messages if message[0] == 144] == [
        (144, note, velocity) for note in (48, 52, 55)
    ]
    resized = sender.update([48, 52, 55], 0.75)
    assert [message for message in resized if message[0] == 128] == [
        (128, note, 0) for note in (48, 52, 55)
    ]
    assert [message for message in resized if message[0] == 144] == [
        (144, note, 95) for note in (48, 52, 55)
    ]
    added = sender.update([48, 53, 57], gain)
    assert [message for message in added if message[0] == 144] == [
        (144, note, velocity) for note in (48, 53, 57)
    ]
    sender.update([48, 53, 57], 0)
    resumed = sender.update([48, 53, 57], gain)
    assert all(message[2] == velocity for message in resumed if message[0] == 144)


def test_same_quantized_velocity_holds_and_tiny_positive_gain_never_sends_note_off() -> None:
    sender = MidiNotes()
    sender.update([60], 0.5)
    assert sender.update([60], 0.5001) == []
    sender.release()
    assert sender.update([60], 1e-9) == [(144, 60, 1)]
    assert sender.update([60], 0.005) == [(176, 11, 1)]
    assert sender.update([60], 0) == [(128, 60, 0), (176, 11, 0)]


@pytest.mark.parametrize("radius,velocity", [(15, 11), (37.5, 45), (75, 127), (150, 127)])
@pytest.mark.parametrize("scale", [1, 2])
@pytest.mark.parametrize("split", [False, True])
def test_ball_geometry_drives_velocity_independent_of_camera_scale_and_split(
    radius: float, velocity: int, scale: int, split: bool
) -> None:
    controller = Controller()
    controller.split = split
    state = controller.update(
        Frame(
            0,
            tuple(
                Hand(side, ((320 + offset) * scale, 240 * scale))
                for side, offset in (("L", radius), ("R", -radius))
            ),
            (320 * scale, 240 * scale),
            100 * scale,
        )
    )
    assert len(state.balls) == (2 if split else 1)
    messages = MidiNotes().update(state.notes, state.gain)
    attacks = [message for message in messages if message[0] == 144]
    assert len(attacks) == len(state.notes)
    assert {message[2] for message in attacks} == {velocity}


def test_sustain_common_notes_and_expression() -> None:
    sender = MidiNotes()
    assert sender.update([48, 52, 55], 0.5) == [
        (176, 11, 64),
        (144, 48, 64),
        (144, 52, 64),
        (144, 55, 64),
    ]
    assert sender.update([55, 48, 52, 48], 0.5) == []
    assert sender.update([48, 53, 57], 1) == [
        (128, 48, 0),
        (128, 52, 0),
        (128, 55, 0),
        (176, 11, 127),
        (144, 48, 127),
        (144, 53, 127),
        (144, 57, 127),
    ]
    assert sender.update([48, 53, 57], 0.25) == [
        (128, 48, 0),
        (128, 53, 0),
        (128, 57, 0),
        (176, 11, 32),
        (144, 48, 32),
        (144, 53, 32),
        (144, 57, 32),
    ]


def test_root_trigger_quality_changes_do_not_retrigger() -> None:
    sender = MidiNotes(16)
    assert sender.update([48], 1) == [(191, 11, 127), (159, 48, 127)]
    assert sender.update([48], 1) == []
    assert sender.update([50], 1) == [(143, 48, 0), (159, 50, 127)]
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


def span_pose(fraction: float, scale: float = 1) -> tuple[tuple[float, ...] | None, ...]:
    """Two 80-unit arms and 40-unit shoulders; wrists close at 10 units."""
    from math import sqrt

    span = 10 + 190 * fraction
    elbow_height = sqrt(max(0, 40**2 - ((span / 2 - 20) / 2) ** 2))
    points: list[tuple[float, ...] | None] = [None] * 33
    for index, x, y in (
        (11, -20, 0),
        (12, 20, 0),
        (13, (-20 - span / 2) / 2, elbow_height),
        (14, (20 + span / 2) / 2, elbow_height),
        (15, -span / 2, 0),
        (16, span / 2, 0),
    ):
        points[index] = (x * scale, y * scale)
    return tuple(points)


@pytest.mark.parametrize("fraction,velocity", [(0, 0), (0.25, 32), (0.5, 64), (0.75, 95), (1, 127)])
@pytest.mark.parametrize("scale", [0.5, 1, 2])
def test_linear_span_reaches_max_only_at_full_extension(
    fraction: float, velocity: int, scale: float
) -> None:
    from instrument.midi_lifecycle import hand_span_gain

    gain = hand_span_gain(span_pose(fraction, scale))
    assert gain == pytest.approx(fraction)
    sender = MidiNotes()
    sender.update([60], 1)
    messages = sender.update([60], gain)
    assert sender.expression == velocity
    assert sender.active == ({60} if velocity else set())
    if velocity:
        assert (144, 60, velocity) in messages or velocity == 127
    else:
        assert messages == [(128, 60, 0), (176, 11, 0)]


def test_span_does_not_saturate_at_old_ball_limit_and_is_3d_rotation_invariant() -> None:
    from instrument.midi_lifecycle import hand_span_gain

    pose = span_pose((150 - 10) / 190)
    assert hand_span_gain(pose) == pytest.approx(140 / 190)
    # Turn 90 degrees: x moves into depth, preserving full anatomical lengths.
    rotated = tuple((0.0, p[1], p[0]) if p else None for p in pose)
    assert hand_span_gain(rotated) == pytest.approx(140 / 190)


def test_missing_invalid_or_degenerate_arm_geometry_mutes_span() -> None:
    from instrument.midi_lifecycle import hand_span_gain

    pose = list(span_pose(0.5))
    for invalid in [None, (float("nan"), 0), (0.0,), (0.0, 0.0, 0.0)]:
        pose[13] = invalid
        assert hand_span_gain(pose) == 0
    assert hand_span_gain([]) == 0
    assert hand_span_gain([(0.0, 0.0)] * 33) == 0


def test_transferred_ball_keeps_linear_energy_without_the_other_wrist() -> None:
    from instrument.midi_lifecycle import MidiSpan

    span = MidiSpan()
    assert span.update(span_pose(0.25)) == pytest.approx(0.25)
    assert span.update(span_pose(0.5), owner="L") == pytest.approx(0.5)
    assert span.update([], owner="L") == pytest.approx(0.5)
    assert span.update([], owner="L", active=False) == 0
    assert span.update([], owner="L") == pytest.approx(0.5)
    assert span.update([], owner="R") == pytest.approx(0.5)
    assert span.update(span_pose(0)) == 0
    assert span.update([]) == 0
