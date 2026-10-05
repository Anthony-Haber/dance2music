"""MediaPipe boundary. Models must already exist; all detection is local."""

import math
import os
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

from instrument.models import Frame, Hand, Point


def observations(result: Any, width: int, height: int) -> tuple[Hand, ...]:
    """Convert Tasks results to pixel coordinates, rejecting ambiguous identities.

    Input is mirrored before inference. Side IDs are model handedness labels,
    not assignments by screen position, so crossing hands does not swap IDs.
    Gesture score measures label confidence, not positional certainty.
    """
    hands: list[Hand] = []
    for index, landmarks in enumerate(result.hand_landmarks):
        if len(landmarks) != 21 or not result.handedness[index]:
            continue
        identity = result.handedness[index][0]
        if (
            identity.category_name not in {"Left", "Right"}
            or not math.isfinite(identity.score)
            or not 0.5 <= identity.score <= 1
        ):
            continue
        points = tuple((float(p.x * width), float(p.y * height)) for p in landmarks)
        if not all(math.isfinite(v) for point in points for v in point):
            continue
        ratios = [
            math.dist(points[tip], points[0]) / max(1e-6, math.dist(points[mcp], points[0]))
            for tip, mcp in ((8, 5), (12, 9), (16, 13), (20, 17))
        ]
        openness = max(0.0, min(1.0, (sum(ratios) / 4 - 1.1) / 0.8))
        categories = result.gestures[index]
        gesture = categories[0] if categories else None
        if gesture and (not math.isfinite(gesture.score) or not 0 <= gesture.score <= 1):
            continue
        hands.append(
            Hand(
                identity.category_name[0],
                points[0],
                gesture.category_name if gesture else "None",
                float(gesture.score) if gesture else 0.0,
                openness,
                points,
            )
        )
    # Do not guess when two detections claim the same identity.
    return tuple(hand for hand in hands if sum(h.side == hand.side for h in hands) == 1)


def torso_geometry(result: Any, width: int, height: int) -> tuple[Point | None, float | None]:
    """Reliable shoulder/hip geometry, in pixels; absent pose returns None."""
    if not result.pose_landmarks:
        return None, None
    pose = result.pose_landmarks[0]
    if len(pose) < 25 or any(
        not math.isfinite(score) or not 0.5 <= score <= 1
        for j in (11, 12, 23, 24)
        for score in (pose[j].visibility or 0, pose[j].presence or 0)
    ):
        return None, None
    shoulder = tuple((getattr(pose[11], a) + getattr(pose[12], a)) / 2 for a in ("x", "y"))
    hip = tuple((getattr(pose[23], a) + getattr(pose[24], a)) / 2 for a in ("x", "y"))
    center = ((shoulder[0] + hip[0]) * width / 2, (shoulder[1] + hip[1]) * height / 2)
    length = math.hypot((shoulder[0] - hip[0]) * width, (shoulder[1] - hip[1]) * height)
    if not all(math.isfinite(v) for v in (*center, length)) or length < 10:
        return None, None
    return center, length


class Tracker:
    """Synchronous VIDEO-mode tasks with strict monotonic timestamps and cleanup."""

    def __init__(self, model_directory: Path) -> None:
        gesture_path = model_directory / "gesture_recognizer.task"
        pose_path = model_directory / "pose_landmarker_lite.task"
        for path in (gesture_path, pose_path):
            if not path.is_file():
                raise FileNotFoundError(
                    f"Missing local model {path}. Run python scripts/setup_instrument_models.py "
                    "explicitly or supply --models with existing model files."
                )
        os.environ.setdefault("MPLCONFIGDIR", str(Path("output/.matplotlib").resolve()))
        import mediapipe as mp

        self.mp = mp
        vision = mp.tasks.vision
        options = mp.tasks.BaseOptions
        self.pose = vision.PoseLandmarker.create_from_options(
            vision.PoseLandmarkerOptions(
                base_options=options(model_asset_path=str(pose_path)),
                running_mode=vision.RunningMode.VIDEO,
                num_poses=1,
            )
        )
        try:
            self.gestures = vision.GestureRecognizer.create_from_options(
                vision.GestureRecognizerOptions(
                    base_options=options(model_asset_path=str(gesture_path)),
                    running_mode=vision.RunningMode.VIDEO,
                    num_hands=2,
                )
            )
        except Exception:
            self.pose.close()
            raise
        self.last_ms = -1
        self.previous: Frame | None = None

    def detect(self, image_bgr: NDArray[np.uint8], time_s: float) -> Frame:
        """image_bgr: (H,W,3) uint8 mirrored image; timestamps are elapsed seconds."""
        import cv2

        if not math.isfinite(time_s) or time_s < 0:
            raise ValueError("Detection timestamp must be finite nonnegative seconds")
        if image_bgr.ndim != 3 or image_bgr.shape[2] != 3 or image_bgr.dtype != np.uint8:
            raise ValueError("Tracker expects a uint8 HxWx3 BGR image")
        timestamp_ms = int(time_s * 1000)
        if timestamp_ms <= self.last_ms:
            raise ValueError("MediaPipe video timestamps must increase by at least 1 millisecond")
        self.last_ms = timestamp_ms
        image = self.mp.Image(
            image_format=self.mp.ImageFormat.SRGB,
            data=np.ascontiguousarray(cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)),
        )
        height, width = image_bgr.shape[:2]
        pose_result = self.pose.detect_for_video(image, timestamp_ms)
        hand_result = self.gestures.recognize_for_video(image, timestamp_ms)
        center, torso_px = torso_geometry(pose_result, width, height)
        hands = observations(hand_result, width, height)
        energy = 0.0
        if self.previous and torso_px:
            dt = time_s - self.previous.time_s
            previous = {h.side: h for h in self.previous.hands}
            speeds = [
                math.dist(h.wrist, previous[h.side].wrist) / torso_px / dt
                for h in hands
                if h.side in previous and 0 < dt <= 0.2
            ]
            energy = min(1.0, sum(speeds) / max(1, len(speeds)) / 3)
        frame = Frame(time_s, hands, center, torso_px, energy)
        self.previous = frame
        return frame

    def close(self) -> None:
        try:
            self.gestures.close()
        finally:
            self.pose.close()
