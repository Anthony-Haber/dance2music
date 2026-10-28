"""Observable event contracts, runnable by pytest without devices."""

import math
import unittest
from dataclasses import replace

from instrument.controller import Controller
from instrument.harmony import QUALITY_PAIRS, Chord
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
    def test_wider_nearby_fists_split_and_merge_once_without_locking(self) -> None:
        for gap in (90, 100, 120):
            with self.subTest(gap=gap):
                controller = Controller()
                events = []
                for index in range(120):
                    t = index * 0.02
                    closed = 0.4 <= t < 1.2 or t >= 1.6
                    frame = sample(
                        t,
                        left="Closed_Fist" if closed else "Open_Palm",
                        right="Closed_Fist" if closed else "Open_Palm",
                    )
                    frame = replace(
                        frame,
                        hands=tuple(
                            replace(h, wrist=(320 + sign * gap / 2, 240))
                            for h, sign in zip(frame.hands, (-1, 1), strict=True)
                        ),
                    )
                    output = controller.update(frame)
                    events.extend(output.events)
                    if index == 55:
                        self.assertEqual(output.split, gap <= 100)
                        self.assertEqual(output.locked, gap > 100)
                self.assertFalse(output.split)
                self.assertFalse(output.locked)
                self.assertEqual(events.count("split"), int(gap <= 100))
                self.assertEqual(events.count("merge"), int(gap <= 100))

    def setUp(self) -> None:
        self.controller = Controller(Config(root_mode="midpoint"))
        self.t = 0.0

    def hold(self, seconds: float, **kwargs: object):
        result = None
        for _ in range(round(seconds * 100)):
            self.t += 0.01
            result = self.controller.update(sample(self.t, **kwargs))
        return result

    def test_lock_quality_unlock_and_fresh_dwell(self) -> None:
        self.assertEqual(self.hold(0.5).root, 7)
        locked = self.hold(0.8, left="Closed_Fist", right="Pointing_Up")
        self.assertTrue(locked.locked)
        self.assertTrue(self.hold(1, left="Closed_Fist", right="Pointing_Up").locked)
        moved = self.hold(0.6, root=2, right="Pointing_Up")
        self.assertEqual((moved.root, moved.quality, moved.locked), (7, "minor", True))
        unlocked = self.hold(0.65, root=2, left="Closed_Fist", right="Pointing_Up")
        self.assertFalse(unlocked.locked)
        self.assertEqual(unlocked.root, 7)
        self.assertEqual(self.hold(0.5, root=2, right="Pointing_Up").root, 2)

    def test_ordered_palm_pairs_persist_until_deliberate_change(self) -> None:
        self.assertEqual(self.hold(0.5, left="Pointing_Up").quality, "minor6")
        self.assertEqual(self.hold(1.4).quality, "minor6")
        self.assertEqual(self.hold(0.5, right="None").quality, "minor6")
        self.assertEqual(self.hold(0.5, right="Victory").quality, "diminished7")
        self.assertEqual(self.hold(0.5, left="None", right="Open_Palm").quality, "diminished7")
        self.assertEqual(self.hold(1.4).quality, "diminished7")
        self.assertEqual(self.hold(0.2).quality, "major")

    def test_major_requires_uninterrupted_reliable_two_palm_hold(self) -> None:
        self.hold(0.5, right="Thumb_Up")
        self.hold(1.4)
        self.hold(0.1, score=0.1)
        self.assertEqual(self.hold(1.4).quality, "major7")
        self.t += 1.0
        self.controller.update(sample(self.t))
        self.assertEqual(self.hold(1.4).quality, "major7")
        self.assertEqual(self.hold(0.2).quality, "major")

    def test_ordered_thumb_pairs_select_distinct_sevenths_while_root_locked(self) -> None:
        self.hold(0.5)
        self.hold(0.8, left="Closed_Fist", right="Pointing_Up")
        self.assertTrue(self.controller.locked)
        for left, right, quality, symbol, pitch_classes in (
            ("Thumb_Down", "Thumb_Up", "minor_major7", "Gm(maj7)", {7, 10, 2, 6}),
            ("Thumb_Up", "Thumb_Down", "dominant7", "G7", {7, 11, 2, 5}),
        ):
            with self.subTest(left=left, right=right):
                early = self.hold(0.3, left=left, right=right, root=2)
                self.assertNotEqual(early.quality, quality)
                selected = self.hold(0.1, left=left, right=right, root=2)
                self.assertEqual(
                    (selected.root, selected.quality, selected.symbol), (7, quality, symbol)
                )
                self.assertEqual({note % 12 for note in selected.notes}, pitch_classes)
                self.assertTrue(selected.locked)
                self.assertFalse(selected.split)
                self.assertEqual(self.hold(0.4, left="None", right="None").quality, quality)

    def test_thumb_pair_uses_body_identity_and_rejects_unreliable_gestures(self) -> None:
        self.hold(0.5, right="Pointing_Up")
        for _ in range(50):
            self.t += 0.01
            output = self.controller.update(
                Frame(
                    self.t,
                    (Hand("R", (230, 240), "Thumb_Up", 1), Hand("L", (410, 240), "Thumb_Down", 1)),
                    (320, 240),
                    100,
                )
            )
        self.assertEqual(output.quality, "minor_major7")
        self.hold(0.5, right="Pointing_Up")
        for _ in range(50):
            self.t += 0.01
            output = self.controller.update(
                Frame(
                    self.t,
                    (
                        Hand("L", (230, 240), "Thumb_Down", 0.1),
                        Hand("R", (410, 240), "Thumb_Up", 1),
                    ),
                    (320, 240),
                    100,
                )
            )
        self.assertEqual(output.quality, "minor")

    def test_victory_handedness_selects_diminished_and_half_diminished(self) -> None:
        for left, right, quality, symbol, pitch_classes in (
            ("Open_Palm", "Victory", "diminished7", "Gdim7", {7, 10, 1, 4}),
            ("Victory", "Open_Palm", "half_diminished7", "Gm7b5", {7, 10, 1, 5}),
        ):
            with self.subTest(left=left, right=right):
                result = self.hold(0.5, left=left, right=right)
                self.assertEqual((result.quality, result.symbol), (quality, symbol))
                self.assertEqual({note % 12 for note in result.notes}, pitch_classes)
        self.assertEqual(self.hold(0.5, left="Victory", right="Victory").quality, "augmented")

    def test_love_gesture_cannot_select_quality_or_rearm_fists(self) -> None:
        self.hold(0.5, right="Pointing_Up")
        unchanged = self.hold(1, left="ILoveYou", right="ILoveYou")
        self.assertEqual(unchanged.quality, "minor")
        self.assertFalse(unchanged.locked)
        self.assertFalse(unchanged.split)
        self.hold(1, left="None", right="None")
        self.hold(1, left="ILoveYou", right="ILoveYou")
        closed = self.hold(1, left="Closed_Fist", right="Closed_Fist", near=True)
        self.assertFalse(closed.locked)
        self.assertFalse(closed.split)

    def test_body_wrist_fallback_keeps_ball_sound_and_quality_without_gesture_actions(self) -> None:
        self.hold(0.5, right="Victory")
        self.hold(0.8, left="Closed_Fist", right="Victory")
        fallback = Frame(
            self.t + 0.01,
            (Hand("L", (150, 240)), Hand("R", (490, 240))),
            (320, 240),
            100,
        )
        result = self.controller.update(fallback)
        self.assertTrue(result.locked)
        self.assertEqual(result.quality, "diminished7")
        self.assertEqual(len(result.balls), 1)
        self.assertGreater(result.gain, 0)
        self.assertEqual(result.events, ())

    def test_startup_fist_and_loss_cannot_create_closure(self) -> None:
        self.assertFalse(self.hold(1, left="Closed_Fist", right="Pointing_Up").locked)
        self.hold(0.4)
        self.assertTrue(self.hold(0.8, left="Closed_Fist", right="Pointing_Up").locked)
        self.t += 0.01
        missing = self.controller.update(Frame(self.t))
        self.assertEqual(missing.gain, 0)
        self.assertTrue(self.hold(1, left="Closed_Fist", right="Pointing_Up").locked)
        self.hold(0.4)
        self.assertFalse(self.hold(0.8, left="Closed_Fist", right="Pointing_Up").locked)

    def test_flicker_and_unknown_do_not_toggle_or_rearm(self) -> None:
        self.hold(0.5)
        self.hold(0.2, left="Closed_Fist", right="Pointing_Up")
        self.assertFalse(self.hold(0.3).locked)
        self.assertTrue(self.hold(0.8, left="Closed_Fist", right="Pointing_Up").locked)
        self.hold(0.4, left="None")
        self.assertTrue(self.hold(0.8, left="Closed_Fist", right="Pointing_Up").locked)

    def test_far_two_fists_coalesce(self) -> None:
        self.hold(0.5)
        result = self.hold(1, left="Closed_Fist", right="Closed_Fist")
        self.assertTrue(result.locked)
        self.assertFalse(result.split)

    def test_held_fists_split_when_brought_together_after_lock(self) -> None:
        self.hold(0.5)
        locked = self.hold(1, left="Closed_Fist", right="Closed_Fist")
        self.assertTrue(locked.locked)
        output = self.hold(0.1, left="Closed_Fist", right="Closed_Fist", near=True)
        self.assertTrue(output.split)
        self.assertTrue(output.locked)
        self.assertEqual(len(output.balls), 2)
        self.assertTrue(self.hold(0.5).split)

    def test_merge_blocks_held_fist_approach_until_reopened(self) -> None:
        self.hold(0.5)
        self.hold(1, left="Closed_Fist", right="Closed_Fist")
        self.controller.merge()
        self.assertFalse(self.hold(0.5, left="Closed_Fist", right="Closed_Fist", near=True).split)
        self.hold(0.5, near=True)
        self.assertTrue(self.hold(0.5, left="Closed_Fist", right="Closed_Fist", near=True).split)

    def test_startup_and_lost_fists_cannot_split_by_approaching(self) -> None:
        self.hold(1, left="Closed_Fist", right="Closed_Fist")
        self.assertFalse(self.hold(0.5, left="Closed_Fist", right="Closed_Fist", near=True).split)
        self.hold(0.5)
        self.hold(1, left="Closed_Fist", right="Closed_Fist")
        self.hold(0.1, left="None", right="None")
        self.assertFalse(self.hold(0.5, left="Closed_Fist", right="Closed_Fist", near=True).split)

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
        self.hold(0.8, left="Closed_Fist", right="Pointing_Up")
        self.hold(0.5, near=True)
        output = self.hold(0.8, left="Closed_Fist", right="Closed_Fist", near=True)
        self.assertTrue(output.locked)
        self.assertTrue(output.split)

    def test_low_score_gap_reset_and_invalid_timing(self) -> None:
        self.hold(0.5)
        self.assertFalse(self.hold(0.8, left="Closed_Fist", right="Pointing_Up", score=0.1).locked)
        self.hold(0.4)
        self.hold(0.4, left="Closed_Fist", right="Pointing_Up")
        self.t += 2
        self.assertFalse(
            self.controller.update(sample(self.t, left="Closed_Fist", right="Pointing_Up")).locked
        )
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
        pending = self.hold(0.4, left="Closed_Fist", right="Pointing_Up")
        self.assertTrue(pending.pending_lock)
        lost = self.hold(0.3, left="Closed_Fist", right="Pointing_Up", score=0.1)
        self.assertFalse(lost.locked)
        self.assertFalse(lost.pending_lock)
        self.assertFalse(self.hold(0.8, left="Closed_Fist", right="Pointing_Up").locked)

    def test_pair_selects_extended_chord_and_missing_pose_is_silent(self) -> None:
        output = self.hold(0.5, left="Pointing_Up", right="Thumb_Up")
        self.assertEqual(output.quality, "major9")
        self.assertEqual(len(output.notes), 5)
        self.t += 0.01
        frame = sample(self.t)
        output = self.controller.update(Frame(self.t, frame.hands))
        self.assertEqual(output.gain, 0)
        self.assertEqual(output.balls, ())

    def test_incomplete_pair_cancels_quality_dwell_and_holds_chord(self) -> None:
        self.hold(0.5, right="Thumb_Up")
        self.assertEqual(self.hold(0.2, left="Pointing_Up", right="Thumb_Up").quality, "major7")
        self.assertEqual(self.hold(0.5, left="None", right="Thumb_Up").quality, "major7")
        self.assertEqual(self.hold(0.34, left="Pointing_Up", right="Thumb_Up").quality, "major7")
        self.assertEqual(self.hold(0.03, left="Pointing_Up", right="Thumb_Up").quality, "major9")
        for sign in ("None", "ILoveYou", "Closed_Fist"):
            result = self.hold(0.5, left=sign, right="Pointing_Up")
            self.assertEqual(result.quality, "major9")

    def test_every_pair_changes_quality_without_moving_locked_root(self) -> None:
        self.hold(0.5)
        self.hold(0.8, left="Closed_Fist", right="Pointing_Up")
        for (left, right), quality in QUALITY_PAIRS.items():
            result = self.hold(1.6 if quality == "major" else 0.5, left=left, right=right, root=2)
            with self.subTest(left=left, right=right):
                self.assertTrue(result.locked)
                self.assertEqual((result.root, result.quality), (7, quality))
                self.assertEqual(
                    {n % 12 for n in result.notes}, set(Chord(7, quality).pitch_classes)
                )

    def test_split_does_not_retrigger_after_merge_while_fists_held(self) -> None:
        self.hold(0.5, near=True)
        self.assertTrue(self.hold(0.7, near=True, left="Closed_Fist", right="Closed_Fist").split)
        self.controller.merge()
        self.assertFalse(self.hold(0.7, near=True, left="Closed_Fist", right="Closed_Fist").split)

    def test_nearby_fist_gesture_toggles_split_merge_once_per_closure(self) -> None:
        self.hold(0.5, right="Pointing_Up")
        self.hold(0.8, left="Closed_Fist", right="Pointing_Up")
        initial = self.controller.chord
        events = []
        for expected_split in (True, False, True):
            self.hold(0.5, near=True)
            for _ in range(100):
                self.t += 0.01
                output = self.controller.update(
                    sample(self.t, left="Closed_Fist", right="Closed_Fist", near=True)
                )
                events.extend(output.events)
            self.assertEqual(output.split, expected_split)
            self.assertEqual(len(output.balls), 2 if expected_split else 1)
            self.assertTrue(output.locked)
            self.assertEqual(self.controller.chord, initial)
        self.assertEqual(events, ["split", "merge", "split"])

    def test_gesture_loss_does_not_merge_until_reopened(self) -> None:
        self.hold(0.5, near=True)
        self.hold(0.7, left="Closed_Fist", right="Closed_Fist", near=True)
        self.hold(0.5, left="None", right="None", near=True)
        self.assertTrue(self.hold(0.7, left="Closed_Fist", right="Closed_Fist", near=True).split)
        self.hold(0.5, near=True)
        self.assertFalse(self.hold(0.7, left="Closed_Fist", right="Closed_Fist", near=True).split)
