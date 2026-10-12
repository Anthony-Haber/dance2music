"""Persistent one-hand ownership, gesture arbitration and device-free replay."""

import json
from dataclasses import asdict, replace
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import pytest

from instrument.controller import Controller
from instrument.models import Config, Frame, Hand, Output
from instrument.replay import read_replay
from instrument.visuals import Particle, Renderer


def observation(
    time_s: float, left: str = "Open_Palm", right: str = "Open_Palm", gap: float = 100
) -> Frame:
    return Frame(
        time_s,
        (Hand("L", (320 - gap / 2, 240), left, 1), Hand("R", (320 + gap / 2, 240), right, 1)),
        (320, 240),
        100,
    )


def hold(controller: Controller, start: float, duration: float, **kwargs: Any) -> list[Output]:
    return [
        controller.update(observation(round(start + i * 0.01, 6), **kwargs))
        for i in range(round(duration * 100))
    ]


@pytest.mark.parametrize("owner", ["L", "R"])
def test_transfer_persists_and_needs_only_owning_wrist(owner: str) -> None:
    controller = Controller()
    original = hold(controller, 0, 0.4)[-1]
    signs = dict(left="Closed_Fist") if owner == "L" else dict(right="Closed_Fist")
    states = hold(controller, 0.4, 1.2, **signs)
    assert [e for s in states for e in s.events] == [f"transfer:{owner}"]
    assert any(s.pending_transfer == owner and not s.pending_lock for s in states)
    result = states[-1]
    assert result.ball_owner == result.balls[0].anchor == owner
    assert not result.split and not result.locked
    assert (result.notes, result.root, result.quality) == (
        original.notes,
        original.root,
        original.quality,
    )
    assert result.balls[0].radius == pytest.approx(original.balls[0].radius)
    assert result.gain == original.gain
    # A relaxed body wrist with no finger detections still owns the ball.
    one_hand = Frame(1.6, (Hand(owner, (540, 120)),), (320, 240), 150)
    result = controller.update(one_hand)
    assert result.balls[0].center == (540, 120)
    assert result.balls[0].radius == pytest.approx(original.balls[0].radius * 1.5)
    assert result.gain == original.gain
    # Moving the other wrist cannot resize the attached ball or change gain.
    result = controller.update(
        replace(
            one_hand,
            time_s=1.61,
            hands=one_hand.hands + (Hand("L" if owner == "R" else "R", (20, 460)),),
        )
    )
    assert result.balls[0].radius == pytest.approx(75)
    assert result.gain == original.gain
    other = "L" if owner == "R" else "R"
    for t, frame in (
        (1.62, Frame(1.62, (Hand(other, (30, 200)),), (320, 240), 100)),
        (1.63, replace(one_hand, time_s=1.63, torso_px=None)),
    ):
        lost = controller.update(frame)
        assert lost.time_s == t and lost.ball_owner == owner
        assert lost.balls == () and lost.gain == 0
    recovered = controller.update(replace(one_hand, time_s=2.5))
    assert recovered.ball_owner == owner and recovered.gain == original.gain
    assert recovered.events == ()


def test_transfer_back_preserves_lock_size_gain_and_m_clears_owner() -> None:
    controller = Controller()
    hold(controller, 0, 0.4)
    locked = hold(controller, 0.4, 0.8, left="Closed_Fist", right="Victory")[-1]
    assert locked.locked
    hold(controller, 1.2, 0.4)
    first = hold(controller, 1.6, 0.8, left="Closed_Fist")[-1]
    assert first.locked and first.ball_owner == "L"
    hold(controller, 2.4, 0.4)
    second_states = hold(controller, 2.8, 1, right="Closed_Fist", gap=20)
    second = second_states[-1]
    assert [e for s in second_states for e in s.events] == ["transfer:R"]
    assert second.ball_owner == "R" and second.locked
    assert second.notes == first.notes and second.gain == first.gain
    assert second.balls[0].radius == first.balls[0].radius
    controller.merge()
    result = hold(controller, 3.8, 0.5, right="Closed_Fist")[-1]
    assert result.ball_owner is None and result.balls[0].anchor == "middle"
    assert result.locked and result.events == ()  # Held pair cannot reattach after M.
    hold(controller, 4.3, 0.4)
    assert hold(controller, 4.7, 0.8, right="Closed_Fist")[-1].ball_owner == "R"
    controller.reset()
    assert controller.update(observation(5.5)).ball_owner is None


def test_owned_ball_merges_to_midpoint_then_splits_and_split_can_transfer() -> None:
    controller = Controller()
    hold(controller, 0, 0.4)
    assert hold(controller, 0.4, 0.8, left="Closed_Fist")[-1].ball_owner == "L"
    hold(controller, 1.2, 0.4)
    states = hold(controller, 1.6, 0.8, left="Closed_Fist", right="Closed_Fist")
    merged = states[-1]
    assert [e for state in states for e in state.events] == ["merge"]
    assert not merged.split and merged.ball_owner is None and len(merged.balls) == 1
    assert merged.balls[0].anchor == "middle" and not merged.locked
    hold(controller, 2.4, 0.4)
    split = hold(controller, 2.8, 0.8, left="Closed_Fist", right="Closed_Fist")[-1]
    assert split.split and split.ball_owner is None and len(split.balls) == 2
    hold(controller, 3.6, 0.4)
    merged = hold(controller, 4, 0.8, left="Closed_Fist", right="Closed_Fist")[-1]
    assert not merged.split and merged.balls[0].anchor == "middle"
    hold(controller, 4.8, 0.4)
    split = hold(controller, 5.2, 0.8, left="Closed_Fist", right="Closed_Fist")[-1]
    hold(controller, 6, 0.4)
    attached = hold(controller, 6.4, 0.8, right="Closed_Fist")[-1]
    assert not attached.split and attached.ball_owner == "R"
    assert attached.balls[0].radius ** 2 == pytest.approx(sum(b.radius**2 for b in split.balls))
    assert attached.gain == split.gain


@pytest.mark.parametrize("receiver", ["L", "R"])
@pytest.mark.parametrize("gap", [60, 90, 180, 300])
def test_split_transfer_enlarges_receiver_once_and_returns_with_common_merge(
    receiver: str, gap: float
) -> None:
    controller = Controller()
    hold(controller, 0, 0.4)
    hold(controller, 0.4, 0.8, left="Closed_Fist", right="Closed_Fist", gap=90)
    split = hold(controller, 1.2, 0.4, gap=gap)[-1]
    assert split.split and len(split.balls) == 2
    initial_radius = max(ball.radius for ball in split.balls)
    signs = dict(left="Closed_Fist") if receiver == "L" else dict(right="Closed_Fist")
    states = hold(controller, 1.6, 2, gap=gap, **signs)
    attached = states[-1]
    assert [e for state in states for e in state.events] == [f"transfer:{receiver}"]
    assert not attached.split and attached.ball_owner == receiver
    assert len(attached.balls) == 1 and attached.balls[0].anchor == receiver
    assert attached.balls[0].radius > initial_radius
    assert attached.balls[0].radius ** 2 == pytest.approx(
        sum(ball.radius**2 for ball in split.balls)
    )
    assert attached.gain == split.gain and attached.notes == split.notes
    first_transfer = next(state for state in states if state.ball_owner == receiver)
    assert attached.balls[0].radius == first_transfer.balls[0].radius
    # The energy cannot repeatedly accumulate while the pair remains held.
    assert all(state.events == () for state in states if state.time_s > first_transfer.time_s)
    hold(controller, 3.6, 0.4, gap=gap)
    merged = hold(controller, 4, 0.8, left="Closed_Fist", right="Closed_Fist", gap=90)[-1]
    assert merged.ball_owner is None and not merged.split
    assert merged.balls[0].anchor == "middle"


def test_nearby_second_fist_preempts_pending_transfer() -> None:
    controller = Controller()
    hold(controller, 0, 0.4)
    pending = hold(controller, 0.4, 0.45, left="Closed_Fist")[-1]
    assert pending.pending_transfer == "L"
    states = hold(controller, 0.85, 1, left="Closed_Fist", right="Closed_Fist")
    assert [e for s in states for e in s.events] == ["split"]
    assert states[-1].split and not states[-1].locked
    assert states[-1].ball_owner is None


@pytest.mark.parametrize("gap", [90, 100, 101, 120])
def test_owned_merge_requires_two_reliable_nearby_fists_and_does_not_repeat(gap: float) -> None:
    controller = Controller()
    hold(controller, 0, 0.4)
    hold(controller, 0.4, 0.8, left="Closed_Fist")
    hold(controller, 1.2, 0.4)
    states = hold(controller, 1.6, 1, left="Closed_Fist", right="Closed_Fist", gap=gap)
    assert not states[-1].split
    assert states[-1].ball_owner == (None if gap <= 100 else "L")
    events = [e for s in states for e in s.events]
    assert events == (["merge"] if gap <= 100 else ["lock"])
    if gap > 100:
        states = hold(controller, 2.6, 0.5, left="Closed_Fist", right="Closed_Fist", gap=90)
        assert [e for s in states for e in s.events] == ["merge"]
        assert states[-1].ball_owner is None and states[-1].locked
    # Held fists remain one action after returning to midpoint.
    start = 2.6 if gap <= 100 else 3.1
    result = hold(controller, start, 0.5, left="Closed_Fist", right="Closed_Fist", gap=90)[-1]
    assert result.ball_owner is None and not result.split and result.events == ()


def test_lost_or_uncertain_fists_cannot_merge_owned_ball_without_rearming() -> None:
    controller = Controller()
    hold(controller, 0, 0.4)
    hold(controller, 0.4, 0.8, left="Closed_Fist")
    hold(controller, 1.2, 0.4)
    for i in range(100):
        frame = observation(1.6 + i * 0.01, left="Closed_Fist", right="Closed_Fist", gap=90)
        frame = replace(frame, hands=tuple(replace(h, confidence=0.1) for h in frame.hands))
        assert controller.update(frame).ball_owner == "L"
    assert (
        hold(controller, 2.6, 0.8, left="Closed_Fist", right="Closed_Fist", gap=90)[-1].ball_owner
        == "L"
    )
    hold(controller, 3.4, 0.4)
    assert (
        hold(controller, 3.8, 0.8, left="Closed_Fist", right="Closed_Fist", gap=90)[-1].ball_owner
        is None
    )


def test_crossed_and_reordered_hands_transfer_to_body_identity() -> None:
    controller = Controller()
    hold(controller, 0, 0.4)
    for i in range(80):
        frame = Frame(
            0.4 + i * 0.01,
            (
                Hand("R", (100, 240), "Open_Palm", 1),
                Hand("L", (500, 240), "Closed_Fist", 1),
            ),
            (320, 240),
            100,
        )
        result = controller.update(frame)
    assert result.ball_owner == "L" and result.balls[0].center == (500, 240)


@pytest.mark.parametrize("interruption", ["changed", "missing", "uncertain", "gap", "reopened"])
def test_transfer_cancels_on_pair_loss_or_change(interruption: str) -> None:
    controller = Controller()
    hold(controller, 0, 0.4)
    assert hold(controller, 0.4, 0.4, left="Closed_Fist")[-1].pending_transfer == "L"
    frame = observation(0.8, left="Closed_Fist")
    if interruption == "changed":
        frame = replace(frame, hands=(frame.hands[0], replace(frame.hands[1], gesture="Victory")))
    elif interruption == "missing":
        frame = replace(frame, hands=(frame.hands[0],))
    elif interruption == "uncertain":
        frame = replace(frame, hands=(frame.hands[0], replace(frame.hands[1], confidence=0.1)))
    elif interruption == "reopened":
        frame = observation(0.8)
    else:
        frame = replace(frame, time_s=1.1)
    cancelled = controller.update(frame)
    assert cancelled.pending_transfer is None and cancelled.ball_owner is None
    states = hold(controller, frame.time_s + 0.01, 0.8, left="Closed_Fist")
    assert all(s.ball_owner is None and not s.locked for s in states)
    start = round(states[-1].time_s + 0.01, 6)
    hold(controller, start, 0.4)
    assert hold(controller, start + 0.4, 0.8, left="Closed_Fist")[-1].ball_owner == "L"


def test_startup_and_short_fist_cannot_transfer() -> None:
    controller = Controller()
    assert hold(controller, 0, 1, left="Closed_Fist")[-1].ball_owner is None
    hold(controller, 1, 0.4)
    assert hold(controller, 1.4, 0.3, left="Closed_Fist")[-1].ball_owner is None
    assert hold(controller, 1.7, 0.4)[-1].ball_owner is None


@pytest.mark.parametrize("root_mode", ["interval", "midpoint"])
def test_transfer_exports_and_replays_exactly(tmp_path: Path, root_mode: str) -> None:
    frames = [
        observation(i * 0.02, left="Closed_Fist" if 0.4 <= i * 0.02 < 1.6 else "Open_Palm")
        for i in range(100)
    ]
    frames = [replace(frame, root_mode=root_mode) for frame in frames]
    controller = Controller(Config(root_mode=root_mode))
    states = [asdict(controller.update(frame)) for frame in frames]
    path = tmp_path / "frames.jsonl"
    path.write_text("".join(json.dumps(asdict(frame)) + "\n" for frame in frames))
    replay = Controller(Config(root_mode=root_mode))
    assert [asdict(replay.update(frame)) for frame in read_replay(path)] == states
    assert states[-1]["ball_owner"] == "L"


def test_renderer_reports_owner_pending_transfer_and_loss_and_clears_trails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    controller, renderer = Controller(), Renderer()
    source = np.zeros((480, 640, 3), dtype=np.uint8)
    labels = []
    original = cv2.putText

    def write(image, text, *args, **kwargs):
        labels.append(text)
        return original(image, text, *args, **kwargs)

    monkeypatch.setattr(cv2, "putText", write)
    state = hold(controller, 0, 0.4)[-1]
    renderer.draw(source, observation(0.39), state)
    pending = hold(controller, 0.4, 0.4, left="Closed_Fist")[-1]
    renderer.draw(source, observation(0.79, left="Closed_Fist"), pending)
    assert "TRANSFERRING TO LEFT HAND..." in labels
    labels.clear()
    attached = hold(controller, 0.8, 0.4, left="Closed_Fist")[-1]
    old_particle = Particle(5, 5, 0, 0, 10)
    renderer.particles.append(old_particle)
    renderer.draw(source, observation(1.19, left="Closed_Fist"), attached)
    assert old_particle not in renderer.particles
    assert any("ONE BALL: LEFT HAND" in text for text in labels)
    assert renderer.previous_owner == "L"
    labels.clear()
    lost = Frame(1.2, (Hand("R", (300, 240)),), (320, 240), 100)
    renderer.draw(source, lost, controller.update(lost))
    assert "LEFT HAND / BODY NOT SEEN" in labels
    assert renderer.particles == []
