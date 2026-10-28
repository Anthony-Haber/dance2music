"""Turn-to-choir pitch contracts, without cameras, audio or MIDI devices."""

from dataclasses import asdict

import pytest

from instrument.turn_pitch import TurnPitch, TurnPitchConfig


def counter(left: int = 0, right: int = 0, *, event: bool = True, tracked: bool = True) -> dict:
    return {
        "left_quarter_turns": left,
        "right_quarter_turns": right,
        "quarter_event": event,
        "tracked": tracked,
    }


def test_left_turns_walk_the_d_major_scale_through_octaves() -> None:
    pitch = TurnPitch()
    tonics = [pitch.state.tonic_midi]
    for i in range(1, 10):
        tonics.append(pitch.update(counter(i)).tonic_midi)
    assert tonics == [62, 64, 66, 67, 69, 71, 73, 74, 76, 78]


def test_right_turns_descend_and_reversing_restores_the_exact_pitch() -> None:
    pitch = TurnPitch()
    assert pitch.update(counter(0, 1)).tonic_midi == 61  # C sharp below D
    assert pitch.update(counter(0, 2)).tonic_midi == 59
    assert pitch.update(counter(1, 2)).tonic_midi == 61
    assert pitch.update(counter(2, 2)).tonic_midi == 62


def test_repeated_frame_and_half_turn_event_do_not_add_another_note_change() -> None:
    pitch = TurnPitch()
    assert pitch.update(counter(1)).semitones == 2
    assert not pitch.update(counter(1)).changed
    half = {**counter(2), "event": True, "half_turns": 1}
    assert pitch.update(half).semitones == 4
    for _ in range(100):
        assert not pitch.update(half).changed
    assert pitch.state.steps == 2


def test_loss_uncounted_turns_and_skipped_events_do_not_replay() -> None:
    pitch = TurnPitch()
    pitch.update(counter(1))
    for frame in (None, counter(2, event=False), counter(3, tracked=False), counter(5)):
        assert pitch.update(frame).semitones == 2
    assert pitch.update(counter(5)).semitones == 2  # duplicate, not a delayed event
    assert pitch.update(counter(6)).semitones == 4


def test_other_studies_keep_original_pitch_and_do_not_accumulate_unheard_turns() -> None:
    pitch = TurnPitch()
    pitch.update(counter(1))
    assert pitch.update(counter(2), enabled=False).semitones == 0
    assert pitch.update(counter(2, event=False), enabled=True).semitones == 2
    assert pitch.update(counter(3)).semitones == 4


def test_resetting_the_turn_counter_or_starting_over_returns_to_d() -> None:
    pitch = TurnPitch()
    pitch.update(counter(3))  # a skipped event must not be invented
    pitch.update(counter(4))
    assert pitch.state.semitones == 2
    assert pitch.update(counter(0, event=False)).tonic_midi == 62
    pitch.update(counter(1))
    pitch.reset()
    assert pitch.state.steps == 0 and pitch.state.tonic_midi == 62


@pytest.mark.parametrize(
    "field,value",
    [
        ("left_quarter_turns", -1),
        ("right_quarter_turns", 1.5),
        ("left_quarter_turns", True),
        ("quarter_event", "yes"),
    ],
)
def test_invalid_counter_fields_cannot_change_pitch(field: str, value: object) -> None:
    pitch = TurnPitch()
    assert not pitch.update({**counter(1), field: value}).changed
    assert pitch.state.semitones == 0


def test_playable_limits_hold_and_turning_back_recovers_immediately() -> None:
    pitch = TurnPitch()
    for i in range(1, 30):
        state = pitch.update(counter(i))
    assert state.steps == TurnPitchConfig().max_steps and state.limit == 1
    assert pitch.update(counter(29, 1)).steps == state.steps - 1
    for i in range(2, 50):
        state = pitch.update(counter(29, i))
    assert state.steps == TurnPitchConfig().min_steps and state.limit == -1
    assert pitch.update(counter(30, 49)).steps == state.steps + 1


def test_every_voice_moves_by_the_same_interval_without_changing_the_base_voicing() -> None:
    pitch = TurnPitch()
    voices = (50, 57, 62, 66)
    pitch.update(counter(1))
    assert pitch.apply(voices) == (52, 59, 64, 68)
    assert voices == (50, 57, 62, 66)
    pitch.update(counter(2))
    assert pitch.apply(voices) == (54, 61, 66, 70)


def reference_cases() -> list[dict]:
    cases = []
    for name, inputs in {
        "up-down": [(counter(i), True) for i in range(21)]
        + [(counter(20, i), True) for i in range(31)],
        "duplicate": [(counter(1), True)] * 20 + [(counter(2), True)] * 20,
        "loss-skip-reset": [
            (counter(1), True),
            (None, True),
            (counter(2, event=False), True),
            (counter(3, tracked=False), True),
            (counter(5), True),
            (counter(6), True),
            (counter(0, event=False), True),
            (counter(1), True),
        ],
        "study-switch": [
            (counter(1), True),
            (counter(2), False),
            (counter(3), False),
            (counter(3, event=False), True),
            (counter(4), True),
        ],
    }.items():
        pitch, frames = TurnPitch(), []
        for spin, enabled in inputs:
            frames.append(
                {
                    "spin": spin,
                    "enabled": enabled,
                    "expected": asdict(pitch.update(spin, enabled=enabled)),
                    "notes": pitch.apply((50, 57, 62, 66)),
                }
            )
        cases.append({"name": name, "frames": frames})
    return cases


if __name__ == "__main__":
    import json

    print(json.dumps({"config": asdict(TurnPitchConfig()), "cases": reference_cases()}))
