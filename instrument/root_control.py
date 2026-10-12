"""Body-relative interval selection, independent of devices and chord voicing."""

import math
from dataclasses import dataclass

from instrument.models import Config, Frame, Point

DIRECTIONS = ("left", "right", "up", "down")
# Rows: left-hand direction; columns: right-hand direction.
STEP_ROWS = ((-5, 5, 7, -7), (-2, 2, 1, -1), (-3, 3, 12, -6), (-4, 4, 6, -12))
ROOT_STEPS = {
    (left, right): step
    for left, row in zip(DIRECTIONS, STEP_ROWS, strict=True)
    for right, step in zip(DIRECTIONS, row, strict=True)
}
INTERVAL_NAMES = {
    1: "HALF STEP",
    2: "WHOLE STEP",
    3: "MINOR THIRD",
    4: "MAJOR THIRD",
    5: "FOURTH",
    6: "TRITONE",
    7: "FIFTH",
    12: "OCTAVE",
}
# Keep every catalogue quality available (the largest extension is +21).
ROOT_MIDI_MIN = 0
ROOT_MIDI_MAX = 106


def interval_name(step: int) -> str:
    return f"{INTERVAL_NAMES[abs(step)]} {'UP' if step > 0 else 'DOWN'}"


def hand_origins(frame: Frame) -> dict[str, Point]:
    """Chest-height origins below each shoulder in the corrected mirrored view.

    Recorded/synthetic input without a skeleton uses +/-0.3 torso horizontal
    offsets. A present skeleton with a missing shoulder cannot supply its origin.
    """
    if frame.torso_center is None or frame.torso_px is None:
        return {}
    origins = {}
    for side, shoulder, sign in (("L", 12, 1), ("R", 11, -1)):
        if frame.pose_landmarks:
            point = frame.pose_landmarks[shoulder]
            if point is None:
                continue
            x = point[0]
        else:
            x = frame.torso_center[0] + sign * 0.3 * frame.torso_px
        origins[side] = (x, frame.torso_center[1])
    return origins


def hand_directions(frame: Frame, config: Config) -> tuple[str | None, str | None]:
    """Directions relative to chest origins, not the other hand or image edges.

    Neutral is a radius in torso lengths. Outside it, a dominant axis must exceed
    the other by interval_axis_ratio; diagonal boundary positions are ambiguous.
    """
    origins = hand_origins(frame)
    hands = {hand.side: hand for hand in frame.hands}
    directions: list[str | None] = []
    for side in ("L", "R"):
        if side not in hands or side not in origins or frame.torso_px is None:
            directions.append(None)
            continue
        dx, dy = ((hands[side].wrist[i] - origins[side][i]) / frame.torso_px for i in (0, 1))
        if math.hypot(dx, dy) <= config.interval_neutral_torsos:
            direction = "center"
        elif abs(dx) >= config.interval_axis_ratio * abs(dy):
            direction = "right" if dx > 0 else "left"
        elif abs(dy) >= config.interval_axis_ratio * abs(dx):
            direction = "down" if dy > 0 else "up"
        else:
            direction = "diagonal"
        directions.append(direction)
    return directions[0], directions[1]


@dataclass
class IntervalSelector:
    """One step per neutral -> stable pair -> neutral cycle; no held repeats."""

    armed: bool = False
    neutral_since: float | None = None
    pair: tuple[str | None, str | None] | None = None
    pair_since: float = 0.0
    directions: tuple[str | None, str | None] = (None, None)
    candidate: int | None = None
    progress: float = 0.0
    feedback: str = "CENTER BOTH HANDS TO ARM"

    def reset(self) -> None:
        self.armed, self.neutral_since, self.pair = False, None, None
        self.candidate, self.progress = None, 0.0

    def read(self, frame: Frame, config: Config, blocked: str | None = None) -> int | None:
        self.directions = hand_directions(frame, config)
        self.candidate = ROOT_STEPS.get((self.directions[0] or "", self.directions[1] or ""))
        self.progress = 0.0
        if blocked or None in self.directions:
            self.reset()
            self.feedback = blocked or "BODY / WRISTS INCOMPLETE"
            return None
        if self.directions == ("center", "center"):
            self.pair = None
            if self.neutral_since is None:
                self.neutral_since = frame.time_s
            if frame.time_s - self.neutral_since + 1e-9 >= config.interval_rearm_s:
                self.armed = True
            self.feedback = "READY - MOVE BOTH HANDS" if self.armed else "HOLD CENTER TO ARM"
            return None
        self.neutral_since = None
        if not self.armed:
            self.pair = None
            if not self.feedback.startswith(("STEP APPLIED", "REGISTER LIMIT")):
                self.feedback = "CENTER BOTH HANDS TO ARM"
            return None
        if self.candidate is None:
            self.pair = None
            self.feedback = "MOVE BOTH HANDS; AVOID DIAGONALS"
            return None
        if self.pair != self.directions:
            self.pair, self.pair_since = self.directions, frame.time_s
        self.progress = min(1.0, (frame.time_s - self.pair_since) / config.root_dwell_s)
        self.feedback = f"HOLD {self.progress:.0%}"
        if frame.time_s - self.pair_since + 1e-9 < config.root_dwell_s:
            return None
        step = self.candidate
        self.armed, self.pair = False, None
        self.feedback = "STEP APPLIED - RETURN TO CENTER"
        return step
