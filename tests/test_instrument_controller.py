"""Observable event contracts, runnable by pytest without devices."""

import math
import unittest

from instrument.controller import Controller
from instrument.models import Config, Frame, Hand


def sample(
    t: float,
    left: str = "Open_Palm",
    right: str = "Open_Palm",
    root: int = 7,
    near: bool = False,
    score: float = 1,
) -> Frame:
    angle = root * math.pi / 6
    center = (320 + 120 * math.cos(angle), 240 + 120 * math.sin(angle))
    gap = 30 if near else 180
    return Frame(
        t,
        (
            Hand("L", (center[0] - gap / 2, center[1]), left, score),
            Hand("R", (center[0] + gap / 2, center[1]), right, score),
        ),
        (320, 240),
        100,
    )


class ControllerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.controller = Controller()
        self.t = 0.0

    def hold(self, seconds: float, **kwargs: object):
        result = None
        for _ in range(round(seconds * 100)):
            self.t += 0.01
            result = self.controller.update(sample(self.t, **kwargs))
        return result

    def test_lock_quality_unlock_and_fresh_dwell(self) -> None:
        self.assertEqual(self.hold(0.5).root, 7)
        locked = self.hold(0.8, left="Closed_Fist")
        self.assertTrue(locked.locked)
        self.assertTrue(self.hold(1, left="Closed_Fist").locked)
        moved = self.hold(0.6, root=2, right="Pointing_Up")
        self.assertEqual((moved.root, moved.quality, moved.locked), (7, "minor", True))
        unlocked = self.hold(0.65, root=2, left="Closed_Fist", right="Pointing_Up")
        self.assertFalse(unlocked.locked)
        self.assertEqual(unlocked.root, 7)
        self.assertEqual(self.hold(0.5, root=2, right="Pointing_Up").root, 2)

    def test_startup_fist_and_loss_cannot_create_closure(self) -> None:
        self.assertFalse(self.hold(1, left="Closed_Fist").locked)
        self.hold(0.4)
        self.assertTrue(self.hold(0.8, left="Closed_Fist").locked)
        self.t += 0.01
        missing = self.controller.update(Frame(self.t))
        self.assertEqual(missing.gain, 0)
        self.assertTrue(self.hold(1, left="Closed_Fist").locked)
        self.hold(0.4)
        self.assertFalse(self.hold(0.8, left="Closed_Fist").locked)

    def test_flicker_and_unknown_do_not_toggle_or_rearm(self) -> None:
        self.hold(0.5)
        self.hold(0.2, left="Closed_Fist")
        self.assertFalse(self.hold(0.3).locked)
        self.assertTrue(self.hold(0.8, left="Closed_Fist").locked)
        self.hold(0.4, left="None")
        self.assertTrue(self.hold(0.8, left="Closed_Fist").locked)

    def test_far_two_fists_coalesce(self) -> None:
        self.hold(0.5)
        result = self.hold(1, left="Closed_Fist", right="Closed_Fist")
        self.assertTrue(result.locked)
        self.assertFalse(result.split)

    def test_staggered_near_pair_suppresses_lock(self) -> None:
        self.hold(0.5, near=True)
        self.hold(0.45, left="Closed_Fist", near=True)
        result = self.hold(0.6, left="Closed_Fist", right="Closed_Fist", near=True)
        self.assertTrue(result.split)
        self.assertFalse(result.locked)
        self.assertTrue(self.hold(0.5, near=True).split)
        self.controller.merge()
        self.assertFalse(self.hold(0.1, near=True).split)

    def test_near_split_preserves_existing_lock(self) -> None:
        self.hold(0.5)
        self.hold(0.8, left="Closed_Fist")
        self.hold(0.5, near=True)
        output = self.hold(0.8, left="Closed_Fist", right="Closed_Fist", near=True)
        self.assertTrue(output.locked)
        self.assertTrue(output.split)

    def test_low_score_gap_reset_and_invalid_timing(self) -> None:
        self.hold(0.5)
        self.assertFalse(self.hold(0.8, left="Closed_Fist", score=0.1).locked)
        self.hold(0.4)
        self.hold(0.4, left="Closed_Fist")
        self.t += 2
        self.assertFalse(self.controller.update(sample(self.t, left="Closed_Fist")).locked)
        with self.assertRaises(ValueError):
            self.controller.update(sample(self.t))
        self.controller.reset()
        output = self.controller.update(sample(self.t + 0.01))
        self.assertEqual(
            (output.root, output.quality, output.locked, output.split), (0, "major", False, False)
        )
        for config in (dict(close_s=0), dict(confidence_min=float("nan"))):
            with self.assertRaises(ValueError):
                Config(**config)
        with self.assertRaises(ValueError):
            Frame(float("nan"))

    def test_pending_closure_is_cancelled_by_low_confidence(self) -> None:
        self.hold(0.5)
        pending = self.hold(0.4, left="Closed_Fist")
        self.assertTrue(pending.pending_lock)
        lost = self.hold(0.3, left="Closed_Fist", score=0.1)
        self.assertFalse(lost.locked)
        self.assertFalse(lost.pending_lock)
        self.assertFalse(self.hold(0.8, left="Closed_Fist").locked)

    def test_right_quality_wins_conflict_and_missing_pose_is_silent(self) -> None:
        output = self.hold(0.5, left="Pointing_Up", right="Victory")
        self.assertEqual(output.quality, "dominant7")
        self.t += 0.01
        frame = sample(self.t)
        output = self.controller.update(Frame(self.t, frame.hands))
        self.assertEqual(output.gain, 0)
        self.assertEqual(output.balls, ())

    def test_split_does_not_retrigger_after_merge_while_fists_held(self) -> None:
        self.hold(0.5, near=True)
        self.assertTrue(self.hold(0.7, near=True, left="Closed_Fist", right="Closed_Fist").split)
        self.controller.merge()
        self.assertFalse(self.hold(0.7, near=True, left="Closed_Fist", right="Closed_Fist").split)
