"""Synthetic camera-free contracts for Anthony's half-turn experiment."""

import math
from collections.abc import Callable
from time import perf_counter

import pytest

from instrument.body_spin import BodySpin, Landmarks


def pose(angle: float, *, face: bool = True, scale: float = 1) -> tuple[Landmarks, Landmarks]:
    """Upright body rotated about world Y; positive yaw turns to its own left."""
    base = {
        0: (0, -0.7, -0.1),
        2: (0.03, -0.72, -0.09),
        5: (-0.03, -0.72, -0.09),
        7: (0.07, -0.7, 0),
        8: (-0.07, -0.7, 0),
        11: (0.18, -0.5, 0),
        12: (-0.18, -0.5, 0),
        13: (0.3, -0.3, 0),
        14: (-0.3, -0.3, 0),
        15: (0.4, -0.1, 0),
        16: (-0.4, -0.1, 0),
        23: (0.1, 0, 0),
        24: (-0.1, 0, 0),
        25: (0.12, 0.4, 0),
        26: (-0.12, 0.4, 0),
        27: (0.13, 0.8, 0),
        28: (-0.13, 0.8, 0),
    }
    a = math.radians(angle)
    image: Landmarks = [None] * 33
    world: Landmarks = [None] * 33
    for i, (x, y, z) in base.items():
        x, z = (
            scale * (x * math.cos(a) - z * math.sin(a)),
            scale * (x * math.sin(a) + z * math.cos(a)),
        )
        world[i] = {"x": x, "y": y * scale, "z": z}
        image[i] = {
            "x": 0.5 + x * 0.4,
            "y": 0.4 + y * scale * 0.4,
            "visibility": 0 if i < 11 and not face else 1,
        }
    return image, world


def turn(
    tracker: BodySpin,
    end: float,
    *,
    start: float = 0,
    t0: float = 0,
    fps: int = 30,
    speed: float = 120,
    alter: Callable[[Landmarks, Landmarks, float], None] | None = None,
) -> list[dict]:
    steps = math.ceil(abs(end - start) / speed * fps)
    results = []
    for i in range(steps + 1):
        angle = start + (end - start) * i / max(1, steps)
        image, world = pose(angle, face=math.cos(math.radians(angle)) > 0)
        if alter:
            alter(image, world, angle)
        results.append(tracker.update(image, world, t0 + i / fps))
    return results


@pytest.mark.parametrize(
    "angle,count", [(90, 0), (179, 0), (180, 1), (360, 2), (-180, 1), (-720, 4)]
)
def test_counts_half_turns_in_both_directions(angle: float, count: int) -> None:
    frames = turn(BodySpin(), angle)
    assert frames[-1]["half_turns"] == count
    assert sum(f["event"] for f in frames) == count
    assert frames[-1]["left_half_turns"] == (count if angle > 0 else 0)
    assert frames[-1]["right_half_turns"] == (count if angle < 0 else 0)


def test_back_view_does_not_require_face_visibility() -> None:
    frames = turn(BodySpin(), 360)
    back = frames[len(frames) // 2]
    assert not back["face_visible"]
    assert back["tracked"] and back["half_turns"] == 1
    assert frames[-1]["half_turns"] == 2


def test_crossing_hands_or_legs_and_face_loss_alone_are_not_body_turns() -> None:
    tracker = BodySpin()
    for i in range(120):
        image, world = pose(0, face=i < 10)
        if 20 <= i < 80:
            for a, b in ((15, 16), (25, 26), (27, 28)):
                image[a], image[b] = image[b], image[a]
                world[a], world[b] = world[b], world[a]
        out = tracker.update(image, world, i / 30)
        assert out["half_turns"] == 0 and not out["active"]


def test_one_usable_limb_group_can_confirm_a_turn() -> None:
    def hide_hands(image: Landmarks, world: Landmarks, angle: float) -> None:
        image[15] = image[16] = None

    frames = turn(BodySpin(), 180, alter=hide_hands)
    assert frames[-1]["half_turns"] == 1
    assert frames[-1]["legs_swapped"] and not frames[-1]["hands_swapped"]


def test_torso_rotation_without_limb_confirmation_stays_uncounted() -> None:
    def hide_limbs(image: Landmarks, world: Landmarks, angle: float) -> None:
        for i in (15, 16, 25, 26, 27, 28):
            image[i] = None

    frames = turn(BodySpin(), 360, alter=hide_limbs)
    assert all(f["half_turns"] == 0 for f in frames)
    assert any(f["status"] == "unconfirmed" for f in frames)


def test_a_partial_turn_then_reverse_does_not_combine_into_a_false_half_turn() -> None:
    tracker = BodySpin()
    assert turn(tracker, 100)[-1]["half_turns"] == 0
    frames = turn(tracker, 0, start=100, t0=1, speed=120)
    assert frames[-1]["half_turns"] == 0


def test_a_180_degree_label_flip_is_rejected() -> None:
    tracker = BodySpin()
    for i in range(30):
        tracker.update(*pose(0), i / 30)
    for i, angle in enumerate((180, 0, 180, 180, 180), 30):
        out = tracker.update(*pose(angle), i / 30)
        assert out["half_turns"] == 0 and not out["event"]


def test_shoulders_rotating_without_hips_is_uncertain() -> None:
    def stationary_hips(image: Landmarks, world: Landmarks, angle: float) -> None:
        front_image, front_world = pose(0)
        for i in (23, 24, 25, 26, 27, 28):
            image[i], world[i] = front_image[i], front_world[i]

    frames = turn(BodySpin(), 180, alter=stationary_hips)
    assert frames[-1]["half_turns"] == 0
    assert any(f["status"] == "torso disagreement" for f in frames)


def test_pose_loss_resets_partial_progress_without_resetting_the_count() -> None:
    tracker = BodySpin()
    assert turn(tracker, 270)[-1]["half_turns"] == 1
    lost = tracker.update(None, None, 3)
    assert not lost["active"] and not lost["tracked"]
    resumed = turn(tracker, 360, start=270, t0=4)[-1]
    assert resumed["half_turns"] == 1 and resumed["progress_degrees"] < 100


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), -1, 0])
def test_bad_or_non_increasing_time_cannot_generate_turns(bad: float) -> None:
    tracker = BodySpin()
    tracker.update(*pose(0), 0)
    out = tracker.update(*pose(180), bad)
    assert not out["tracked"] and out["half_turns"] == 0


def test_low_confidence_stale_or_nonfinite_joints_cannot_be_used() -> None:
    tracker = BodySpin()
    tracker.update(*pose(0), 0)
    for i in range(1, 30):
        image, world = pose(i * 6)
        image[11] = {"x": 0.5, "y": 0.4, "visibility": 0.1}
        out = tracker.update(image, world, i / 30)
        assert not out["tracked"] and not out["active"]
    image, world = pose(0)
    world[23] = {"x": float("nan"), "y": 0, "z": 0}
    assert not tracker.update(image, world, 1)["tracked"]


@pytest.mark.parametrize("fps", [15, 30, 60])
@pytest.mark.parametrize("scale", [0.5, 1, 2])
def test_size_and_frame_rate_do_not_change_count(fps: int, scale: float) -> None:
    tracker = BodySpin()
    for i in range(3 * fps + 1):
        out = tracker.update(*pose(120 * i / fps, scale=scale), i / fps)
    assert out["half_turns"] == 2
    assert out["rate"] == pytest.approx(120, abs=1)


def test_reset_starts_a_new_performance() -> None:
    tracker = BodySpin()
    turn(tracker, 180)
    tracker.reset()
    out = tracker.update(*pose(0), 0)
    assert out["half_turns"] == 0 and out["progress_degrees"] == 0


def test_short_occlusion_does_not_invent_motion_or_discard_a_valid_turn() -> None:
    def occlude(image: Landmarks, world: Landmarks, angle: float) -> None:
        if 70 <= angle <= 78:
            image[11] = None

    frames = turn(BodySpin(), 180, alter=occlude)
    assert frames[-1]["half_turns"] == 1
    assert all(not f["active"] and f["rate"] == 0 for f in frames if not f["tracked"])


def test_tiny_pose_jitter_and_torso_twists_do_not_accumulate_half_turns() -> None:
    tracker = BodySpin()
    for i in range(600):
        out = tracker.update(*pose(2 * math.sin(i)), i / 30)
    assert out["half_turns"] == 0 and out["progress_degrees"] < 5


def test_only_low_confidence_limbs_or_ankles_instead_of_knees() -> None:
    def ankles(image: Landmarks, world: Landmarks, angle: float) -> None:
        for i in (15, 16, 25, 26):
            image[i] = None

    assert turn(BodySpin(), 180, alter=ankles)[-1]["half_turns"] == 1


def test_processing_p95_stays_below_five_milliseconds() -> None:
    tracker, timings = BodySpin(), []
    for i in range(1000):
        image, world = pose(i * 4)
        start = perf_counter()
        tracker.update(image, world, i / 30)
        timings.append(1000 * (perf_counter() - start))
    p95 = sorted(timings)[950]
    assert p95 < 5, f"body spin p95 {p95:.3f} ms (budget 5 ms)"


def reference_sequences() -> list[dict]:
    """Live Python oracle for the browser parity test; no generated data committed."""
    cases = []
    for name in (
        "left",
        "right",
        "partial",
        "crossed",
        "no limbs",
        "gap",
        "jump",
        "twist",
        "reverse",
    ):
        tracker, frames = BodySpin(), []
        for i in range(121):
            angle = i * 3 if name != "right" else -i * 3
            if name == "partial":
                angle /= 3
            if name == "reverse":
                angle = min(i, 60) * 2 - max(0, i - 60) * 2
            if name == "crossed":
                angle = 0
            if name == "jump":
                angle = 180 if 30 <= i < 60 else 0
            image, world = pose(angle, face=math.cos(math.radians(angle)) > 0.2)
            if name == "crossed" and 30 < i < 90:
                for a, b in ((15, 16), (25, 26), (27, 28)):
                    image[a], image[b] = image[b], image[a]
                    world[a], world[b] = world[b], world[a]
            if name == "no limbs":
                for j in (15, 16, 25, 26, 27, 28):
                    image[j] = None
            if name == "twist":
                front_image, front_world = pose(0)
                for j in (23, 24, 25, 26, 27, 28):
                    image[j], world[j] = front_image[j], front_world[j]
            if name == "gap" and 40 < i < 60:
                image, world = None, None
            t = i / 30
            expected = dict(tracker.update(image, world, t))
            frames.append({"image": image, "world": world, "t": t, "expected": expected})
        cases.append({"name": name, "frames": frames})
    return cases


if __name__ == "__main__":
    import json
    from dataclasses import asdict

    from instrument.body_spin import SpinConfig

    print(json.dumps({"config": asdict(SpinConfig()), "cases": reference_sequences()}))
