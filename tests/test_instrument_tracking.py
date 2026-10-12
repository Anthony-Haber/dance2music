"""Body-driven tracking and wrist crops without models, cameras or downloads."""

import json
import math
import tempfile
import unittest
from contextlib import ExitStack
from dataclasses import asdict
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np

from instrument.controller import Controller
from instrument.models import Frame, Hand
from instrument.replay import read_replay
from instrument.tracking import (
    GestureState,
    Tracker,
    body_hands,
    hand_crop,
    observations,
    pose_observations,
)


def body_result() -> SimpleNamespace:
    points = [SimpleNamespace(x=0.5, y=0.5, visibility=1.0, presence=1.0) for _ in range(33)]
    for joint, x, y in (
        (11, 0.4, 0.3),
        (12, 0.6, 0.3),
        (23, 0.4, 0.7),
        (24, 0.6, 0.7),
        (13, 0.3, 0.4),
        (14, 0.7, 0.4),
        (15, 0.2, 0.5),
        (16, 0.8, 0.5),
        (25, 0.4, 0.8),
        (26, 0.6, 0.8),
        (27, 0.4, 0.95),
        (28, 0.6, 0.95),
    ):
        points[joint].x, points[joint].y = x, y
    return SimpleNamespace(pose_landmarks=[points])


def empty_hands() -> SimpleNamespace:
    return SimpleNamespace(hand_landmarks=[], handedness=[], gestures=[])


def fake_tracker() -> Tracker:
    tracker = Tracker.__new__(Tracker)
    tracker.mp = SimpleNamespace(Image=lambda **kw: kw["data"], ImageFormat=SimpleNamespace(SRGB=1))
    tracker.pose = Mock()
    tracker.pose.detect_for_video.return_value = body_result()
    tracker.crops = {side: Mock() for side in ("L", "R")}
    for recognizer in tracker.crops.values():
        recognizer.recognize_for_video.return_value = empty_hands()
    tracker.hand_states = {side: GestureState() for side in ("L", "R")}
    tracker.crop_index = 0
    tracker.last_ms, tracker.previous = -1, None
    return tracker


class TrackingTests(unittest.TestCase):
    def test_mirrored_body_sides_select_ordered_chords_even_when_hands_cross(self) -> None:
        tracker = fake_tracker()
        controller = Controller()
        image = np.zeros((480, 640, 3), dtype=np.uint8)
        for side, gesture in (("L", "Thumb_Down"), ("R", "Thumb_Up")):
            tracker.crops[side].recognize_for_video.return_value = SimpleNamespace(
                hand_landmarks=[[SimpleNamespace(x=0.5, y=0.5) for _ in range(21)]],
                handedness=[[]],
                gestures=[[SimpleNamespace(category_name=gesture, score=0.99)]],
            )
        frame = tracker.detect(image, 0)
        hands = {hand.side: hand for hand in frame.hands}
        self.assertEqual(hands["L"].wrist, (512, 240))
        self.assertEqual(hands["R"].wrist, (128, 240))
        controller.update(frame)
        for index in range(1, 30):
            frame = tracker.detect(image, index * 0.04)
            state = controller.update(frame)
        self.assertEqual(state.quality, "minor_major7")
        # Follow the same body joints across the screen, rather than sorting by x.
        pose = tracker.pose.detect_for_video.return_value.pose_landmarks[0]
        for first, second in ((13, 14), (15, 16)):
            pose[first].x, pose[second].x = pose[second].x, pose[first].x
        for index in range(30, 60):
            frame = tracker.detect(image, index * 0.04)
            state = controller.update(frame)
        hands = {hand.side: hand for hand in frame.hands}
        self.assertLess(hands["L"].wrist[0], hands["R"].wrist[0])
        self.assertEqual(hands["L"].gesture, "Thumb_Down")
        self.assertEqual(hands["R"].gesture, "Thumb_Up")
        self.assertEqual(state.quality, "minor_major7")
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "frames.jsonl"
            path.write_text(json.dumps(asdict(frame)) + "\n", encoding="utf-8")
            self.assertEqual(list(read_replay(path)), [frame])

    def test_model_cleanup_releases_all_tasks_when_one_close_fails(self) -> None:
        tracker = fake_tracker()
        tracker.resources = ExitStack()
        tracker.resources.callback(tracker.pose.close)
        for recognizer in tracker.crops.values():
            tracker.resources.callback(recognizer.close)
        tracker.crops["R"].close.side_effect = RuntimeError("failed to close task")
        with self.assertRaisesRegex(RuntimeError, "failed to close task"):
            tracker.close()
        tracker.pose.close.assert_called_once()
        for recognizer in tracker.crops.values():
            recognizer.close.assert_called_once()

    def test_whole_body_drives_ball_when_hand_models_detect_nothing(self) -> None:
        tracker = fake_tracker()
        frame = tracker.detect(np.zeros((480, 640, 3), dtype=np.uint8), 0)
        self.assertEqual(len(frame.pose_landmarks), 33)
        self.assertIsNotNone(frame.pose_landmarks[27])
        self.assertEqual(tuple(h.wrist for h in frame.hands), ((512, 240), (128, 240)))
        self.assertTrue(all(h.gesture == "None" and h.confidence == 0 for h in frame.hands))
        state = Controller().update(frame)
        self.assertEqual(state.balls[0].center, (320, 240))
        self.assertGreater(state.gain, 0)
        self.assertFalse(state.locked)
        image, timestamp = tracker.crops["L"].recognize_for_video.call_args.args
        self.assertEqual(image.shape, (256, 256, 3))
        self.assertEqual(timestamp, 0)
        tracker.crops["R"].recognize_for_video.assert_not_called()
        tracker.detect(np.zeros((480, 640, 3), dtype=np.uint8), 0.04)
        self.assertEqual(tracker.crops["R"].recognize_for_video.call_args.args[1], 40)

    def test_missing_wrist_has_no_stale_ball_and_lost_body_is_silent(self) -> None:
        tracker = fake_tracker()
        image = np.zeros((480, 640, 3), dtype=np.uint8)
        controller = Controller()
        controller.update(tracker.detect(image, 0))
        tracker.pose.detect_for_video.return_value.pose_landmarks[0][15].visibility = 0.1
        missing = tracker.detect(image, 0.04)
        self.assertIsNone(missing.pose_landmarks[15])
        self.assertEqual(tuple(h.side for h in missing.hands), ("L",))
        self.assertEqual(controller.update(missing).balls, ())
        tracker.pose.detect_for_video.return_value = SimpleNamespace(pose_landmarks=[])
        state = controller.update(tracker.detect(image, 0.08))
        self.assertEqual(state.gain, 0)

    def test_crop_padding_and_landmarks_map_back_to_original_image(self) -> None:
        image = np.full((100, 100, 3), 200, dtype=np.uint8)
        crop, box = hand_crop(image, (5, 50), None, 50)
        self.assertEqual(crop.shape, (256, 256, 3))
        self.assertLess(box[0], 0)
        np.testing.assert_array_equal(crop[:, 0], np.zeros((256, 3)))
        self.assertEqual(int(crop[128, 128, 0]), 200)
        result = SimpleNamespace(
            hand_landmarks=[[SimpleNamespace(x=0.5, y=0.5) for _ in range(21)]],
            # Crop identity comes from the body; even uncertain handedness is usable.
            handedness=[[]],
            gestures=[[SimpleNamespace(category_name="Victory", score=0.9)]],
        )
        hand = observations(result, 100, 100, side="L", box=box)[0]
        self.assertEqual(hand.wrist, (5, 50))
        pose = tuple((5.0, 50.0) if j == 16 else None for j in range(33))
        merged = body_hands(pose, (hand,))
        self.assertEqual((merged[0].side, merged[0].gesture), ("L", "Victory"))

    def test_crop_canned_fist_is_confirmed_before_reaching_controller(self) -> None:
        tracker = fake_tracker()
        result = SimpleNamespace(
            hand_landmarks=[[SimpleNamespace(x=0.5, y=0.5) for _ in range(21)]],
            handedness=[[]],
            gestures=[[SimpleNamespace(category_name="Closed_Fist", score=0.99)]],
        )
        tracker.crops["L"].recognize_for_video.return_value = result
        image = np.zeros((480, 640, 3), dtype=np.uint8)
        for index in range(11):
            frame = tracker.detect(image, index * 0.04)
            left = next(h for h in frame.hands if h.side == "L")
            self.assertEqual(left.gesture, "Closed_Fist" if index >= 10 else "None")
        self.assertEqual(left.raw_gesture, "Closed_Fist")
        self.assertEqual(left.gesture_since, 0)
        self.assertAlmostEqual(left.landmarks[0][0], 512 + 0.35 * (512 - 448))

    def test_position_filter_is_causal_and_clears_missing_joints_and_long_gaps(self) -> None:
        tracker = fake_tracker()
        pose = tuple((100.0, 200.0) for _ in range(33))
        tracker.previous = Frame(0, pose_landmarks=pose)
        moved = tuple((200.0, 200.0) for _ in range(33))
        filtered = tracker._smooth_pose(moved, 0.04)
        self.assertAlmostEqual(filtered[15][0], 100 + (1 - math.exp(-1)) * 100)
        missing = tuple(None if j == 15 else moved[j] for j in range(33))
        self.assertIsNone(tracker._smooth_pose(missing, 0.04)[15])
        self.assertEqual(tracker._smooth_pose(moved, 0.3), moved)

    def test_cached_hand_details_do_not_replace_missing_body_wrists(self) -> None:
        pose = tuple((100.0, 240.0) if j == 15 else None for j in range(33))
        detailed = (Hand("L", (200, 240), "Closed_Fist", 0.99),)
        hands = body_hands(pose, detailed)
        self.assertEqual(tuple(h.side for h in hands), ("R",))
        output = Controller().update(Frame(0, hands, (320, 240), 100, pose_landmarks=pose))
        self.assertEqual(output.balls, ())
        self.assertEqual(output.gain, 0)

    def test_pose_confidence_validation_and_replay_round_trip(self) -> None:
        result = body_result()
        result.pose_landmarks[0][15].visibility = float("nan")
        pose = pose_observations(result, 640, 480)
        self.assertIsNone(pose[15])
        frame = Frame(0, pose_landmarks=pose)
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "frames.jsonl"
            path.write_text(json.dumps(asdict(frame)) + "\n", encoding="utf-8")
            self.assertEqual(list(read_replay(path)), [frame])
        with self.assertRaises(ValueError):
            Frame(0, pose_landmarks=((0, 0),))
        self.assertEqual(pose_observations(SimpleNamespace(pose_landmarks=[]), 640, 480), ())
