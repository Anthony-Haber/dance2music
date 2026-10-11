"""MediaPipe boundary. Models must already exist; all detection is local."""

import math
import os
from contextlib import ExitStack
from dataclasses import replace
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

from instrument.models import Frame, Hand, Point

POSE_CONFIDENCE_MIN = 0.3
CROP_SIZE = 256
CROP_TORSOS = 1.1
CROP_MIN_PX = 64
CROP_REACH = 0.35
POSITION_TAU_S = 0.04


GESTURE_MIN = 0.5
GESTURE_HOLD_S = 0.35
HAND_LOSS_S = 0.4
OPENNESS_TAU_S = 0.1


class GestureState:
    """Port of web/live/hands.js Hand.update: canned labels, never joint guesses.

    Label changes (including None) require 350ms of the same candidate. Missing
    detections retain the last observed hand for up to 400ms, as in web far mode.
    A held accepted fist does not acquire a new edge when its raw label flickers.
    """

    def __init__(self) -> None:
        self.hand: Hand | None = None
        self.seen = False
        self.last_seen = -1e9
        self.previous_time: float | None = None
        self.candidate = "None"
        self.candidate_since = 0.0
        self.gesture = "None"
        self.score = 0.0
        self.gesture_since: float | None = None
        self.openness = 0.0

    def update(self, hand: Hand | None, now: float) -> None:
        if hand is None:
            if now - self.last_seen > HAND_LOSS_S:
                self.seen = False
                self.hand = None
            return
        self.seen = True
        self.last_seen = now
        dt = max(0.01, now - (self.previous_time if self.previous_time is not None else now))
        self.previous_time = now
        self.openness += (1 - math.exp(-dt / OPENNESS_TAU_S)) * (hand.openness - self.openness)
        candidate = hand.gesture if hand.confidence >= GESTURE_MIN else "None"
        if candidate != self.candidate:
            self.candidate, self.candidate_since = candidate, now
        if now - self.candidate_since >= GESTURE_HOLD_S:
            self.gesture, self.score = candidate, hand.confidence
            self.gesture_since = self.candidate_since
        self.hand = replace(
            hand,
            gesture=self.gesture,
            confidence=self.score,
            openness=self.openness,
            raw_gesture=candidate,
            raw_confidence=hand.confidence,
            gesture_since=self.gesture_since,
        )


def observations(
    result: Any,
    width: int,
    height: int,
    *,
    side: str | None = None,
    box: tuple[float, float, float, float] | None = None,
) -> tuple[Hand, ...]:
    """Convert Tasks results to pixel coordinates, rejecting ambiguous identities.

    Input is mirrored before inference. Side IDs are model handedness labels,
    not assignments by screen position, so crossing hands does not swap IDs.
    A pose-guided crop supplies its body side, avoiding uncertain handedness
    on sideways palms. Gesture score measures label confidence, not position.
    """
    hands: list[Hand] = []
    for index, landmarks in enumerate(result.hand_landmarks):
        if len(landmarks) != 21:
            continue
        identity_side = side
        if identity_side is None:
            if not result.handedness[index]:
                continue
            identity = result.handedness[index][0]
            if (
                identity.category_name not in {"Left", "Right"}
                or not math.isfinite(identity.score)
                or not 0.5 <= identity.score <= 1
            ):
                continue
            identity_side = identity.category_name[0]
        x, y, box_width, box_height = box or (0, 0, width, height)
        points = tuple((float(x + p.x * box_width), float(y + p.y * box_height)) for p in landmarks)
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
                identity_side,
                points[0],
                gesture.category_name if gesture else "None",
                float(gesture.score) if gesture else 0.0,
                openness,
                points,
            )
        )
    # Do not guess when two detections claim the same identity.
    return tuple(hand for hand in hands if sum(h.side == hand.side for h in hands) == 1)


def pose_observations(result: Any, width: int, height: int) -> tuple[Point | None, ...]:
    """33 displayed body points; missing/uncertain joints are None, never stale."""
    if not result.pose_landmarks or len(result.pose_landmarks[0]) != 33:
        return ()
    points: list[Point | None] = []
    for landmark in result.pose_landmarks[0]:
        scores = (landmark.visibility or 0, landmark.presence or 0)
        point = (float(landmark.x * width), float(landmark.y * height))
        reliable = all(math.isfinite(s) and POSE_CONFIDENCE_MIN <= s <= 1 for s in scores)
        points.append(point if reliable and all(math.isfinite(v) for v in point) else None)
    return tuple(points)


def hand_crop(
    image: NDArray[np.uint8], wrist: Point, elbow: Point | None, torso_px: float
) -> tuple[NDArray[np.uint8], tuple[float, float, float, float]]:
    """Website's wrist/forearm-guided crop, resized to 256px with black edge padding.

    The returned box uses source-image pixels, including its offscreen portion,
    so detected points map back correctly even beside a frame edge.
    """
    import cv2

    center = (
        tuple(wrist[i] + CROP_REACH * (wrist[i] - elbow[i]) for i in (0, 1))
        if elbow is not None
        else wrist
    )
    size = max(CROP_MIN_PX, CROP_TORSOS * torso_px)
    x, y = center[0] - size / 2, center[1] - size / 2
    scale = CROP_SIZE / size
    transform = np.array(((scale, 0, -x * scale), (0, scale, -y * scale)), dtype=np.float32)
    crop = cv2.warpAffine(image, transform, (CROP_SIZE, CROP_SIZE), borderMode=cv2.BORDER_CONSTANT)
    return crop.astype(np.uint8, copy=False), (x, y, size, size)


def body_hands(pose: tuple[Point | None, ...], detailed: tuple[Hand, ...]) -> tuple[Hand, ...]:
    """Use body wrists for ball geometry, and website-filtered details for gestures."""
    found = {hand.side: hand for hand in detailed}
    hands: list[Hand] = []
    for side, joint in (("L", 15), ("R", 16)):
        wrist = pose[joint] if pose else None
        hand = found.get(side)
        if wrist is not None:
            hands.append(replace(hand, wrist=wrist) if hand is not None else Hand(side, wrist))
    return tuple(hands)


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
                    f"Missing local model {path}. Run python -m instrument.setup_models "
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
        self.resources = ExitStack()
        self.resources.callback(self.pose.close)
        self.crops: dict[str, Any] = {}
        try:
            for side in ("L", "R"):
                recognizer = vision.GestureRecognizer.create_from_options(
                    vision.GestureRecognizerOptions(
                        base_options=options(model_asset_path=str(gesture_path)),
                        running_mode=vision.RunningMode.VIDEO,
                        num_hands=1,
                        min_hand_detection_confidence=0.3,
                        min_hand_presence_confidence=0.3,
                        min_tracking_confidence=0.3,
                    )
                )
                self.crops[side] = recognizer
                self.resources.callback(recognizer.close)
        except Exception:
            self.resources.close()
            raise
        self.hand_states = {side: GestureState() for side in ("L", "R")}
        self.crop_index = 0
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
        center, torso_px = torso_geometry(pose_result, width, height)
        raw_pose = pose_observations(pose_result, width, height)
        pose = self._smooth_pose(raw_pose, time_s)
        # Website far mode alternates pose-guided crops, one recognizer per side.
        side, wrist_joint, elbow_joint = (("L", 15, 13), ("R", 16, 14))[self.crop_index % 2]
        self.crop_index += 1
        detected = None
        wrist = pose[wrist_joint] if pose else None
        if torso_px is not None and wrist is not None:
            crop, box = hand_crop(image_bgr, wrist, pose[elbow_joint], torso_px)
            crop_image = self.mp.Image(
                image_format=self.mp.ImageFormat.SRGB,
                data=np.ascontiguousarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)),
            )
            result = self.crops[side].recognize_for_video(crop_image, timestamp_ms)
            candidates = observations(result, width, height, side=side, box=box)
            detected = candidates[0] if candidates else None
        self.hand_states[side].update(detected, time_s)
        detailed = tuple(
            state.hand
            for state in self.hand_states.values()
            if state.seen and state.hand is not None
        )
        hands = body_hands(pose, detailed)
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
        frame = Frame(time_s, hands, center, torso_px, energy, pose)
        self.previous = frame
        return frame

    def _smooth_pose(
        self, pose: tuple[Point | None, ...], time_s: float
    ) -> tuple[Point | None, ...]:
        """Causal 40ms position filter; loss or a >200ms gap clears each joint."""
        if self.previous is None or not self.previous.pose_landmarks or not pose:
            return pose
        dt = time_s - self.previous.time_s
        if dt > 0.2:
            return pose
        alpha = 1 - math.exp(-dt / POSITION_TAU_S)
        return tuple(
            (
                old[0] + alpha * (point[0] - old[0]),
                old[1] + alpha * (point[1] - old[1]),
            )
            if point is not None and old is not None
            else point
            for point, old in zip(pose, self.previous.pose_landmarks, strict=True)
        )

    def close(self) -> None:
        """Release every model even if another model's close raises an error."""
        self.resources.close()
