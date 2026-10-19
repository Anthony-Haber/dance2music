"""Causal half-turn counting from fresh MediaPipe pose observations.

Device-free Python reference for the Movement Dictionary browser experiment.
Inputs are 33 image landmarks (normalized x/y) and 33 world landmarks (metres,
hip origin, y down, z away from camera). Missing points are None. Visibility
and presence default to 1 only when the caller omits those optional scores.
No old coordinates or inferred motion are substituted for missing observations.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from math import atan2, cos, degrees, exp, hypot, isfinite, sin
from typing import TypedDict

Landmarks = Sequence[Mapping[str, float] | None]


@dataclass(frozen=True)
class SpinConfig:
    """Experimental thresholds, mirrored and tested in browser spin.js."""

    visibility_min: float = 0.5
    torso_agreement_degrees: float = 45
    limb_agreement_degrees: float = 60
    gap_seconds: float = 0.3
    max_rate: float = 720  # degrees/s, reject implausible orientation jumps
    max_step: float = 75  # degrees/frame, never infer a 180-degree label flip
    rate_seconds: float = 0.12  # causal speed smoothing only; no future frames
    active_rate: float = 90
    order_fraction: float = 0.12  # image separation / image torso size
    order_hold_seconds: float = 0.05  # debounce a new left/right ordering
    reversal_degrees: float = 20  # tolerate small tracking jitter
    evidence_degrees: float = 45  # require meaningful torso rotation before confirming a swap
    half_turn_degrees: float = 180


class SpinResult(TypedDict):
    rate: float
    active: bool
    tracked: bool
    confidence: float
    status: str
    progress_degrees: float
    phase_degrees: float
    half_turns: int
    left_half_turns: int
    right_half_turns: int
    direction: int
    event: bool
    hands_swapped: bool
    legs_swapped: bool
    face_visible: bool


def _wrap(angle: float) -> float:
    return atan2(sin(angle), cos(angle))


class BodySpin:
    """Count 180-degree body turns only with a corroborating limb-order swap.

    Shoulders and hips must agree. Wrist or knee/ankle ordering can confirm a
    half turn; neither limb crossing nor disappearing face establishes a turn.
    Positive direction means the dancer turning to their own left. CSS display
    mirroring must not change the input coordinates or this anatomical direction.
    """

    out: SpinResult

    def __init__(self, config: SpinConfig | None = None) -> None:
        self.config = config or SpinConfig()
        self.reset()

    def reset(self) -> None:
        """Clear counts at the start of a new performance."""
        self._time: float | None = None
        self.left = self.right = 0
        self._break_path()
        self.out = self._result("ready")

    def _break_path(self) -> None:
        self._angle: float | None = None
        self._good_time: float | None = None
        self._progress = self._peak = self._rate = 0.0
        self._direction = 0
        self._orders: dict[str, int] = {}
        self._seen: dict[str, float] = {}
        self._candidates: dict[str, tuple[int, float]] = {}
        self._pending_swaps: dict[str, tuple[int, float]] = {}
        self._swaps = {"hands": False, "legs": False}

    def _point(
        self, points: Landmarks | None, index: int, *, world: bool = False
    ) -> tuple[float, float, float, float] | None:
        if points is None or len(points) != 33 or points[index] is None:
            return None
        p = points[index]
        assert p is not None
        values = (
            p.get("x", float("nan")),
            p.get("y", float("nan")),
            p.get("z", float("nan") if world else 0),
            p.get("visibility", 1),
            p.get("presence", 1),
        )
        if not all(
            isinstance(v, (int, float)) and not isinstance(v, bool) and isfinite(v) for v in values
        ):
            return None
        quality = min(values[3:])
        return (*values[:3], min(1.0, quality)) if quality >= self.config.visibility_min else None

    def _axis(
        self, image: Landmarks | None, world: Landmarks | None, left: int, right: int
    ) -> tuple[float, float] | None:
        il, ir = self._point(image, left), self._point(image, right)
        wl, wr = self._point(world, left, world=True), self._point(world, right, world=True)
        if il is None or ir is None or wl is None or wr is None:
            return None
        dx, dz = wl[0] - wr[0], wl[2] - wr[2]
        if hypot(dx, dz) < 1e-6:
            return None
        return atan2(dz, dx), min(il[3], ir[3], wl[3], wr[3])

    def _order(self, image: Landmarks | None, left: int, right: int, span: float) -> int:
        a, b = self._point(image, left), self._point(image, right)
        if a is None or b is None or abs(a[0] - b[0]) < span * self.config.order_fraction:
            return 0
        return 1 if a[0] > b[0] else -1

    def _result(
        self,
        status: str,
        *,
        tracked: bool = False,
        confidence: float = 0,
        face: bool = False,
        active: bool = False,
        event: bool = False,
    ) -> SpinResult:
        self.out = {
            "rate": self._rate if tracked else 0,
            "active": active,
            "tracked": tracked,
            "confidence": confidence,
            "status": status,
            "progress_degrees": abs(self._progress),
            "phase_degrees": degrees(self._angle) if self._angle is not None else 0,
            "half_turns": self.left + self.right,
            "left_half_turns": self.left,
            "right_half_turns": self.right,
            "direction": self._direction,
            "event": event,
            "hands_swapped": self._swaps["hands"],
            "legs_swapped": self._swaps["legs"],
            "face_visible": face,
        }
        return self.out

    def update(self, image: Landmarks | None, world: Landmarks | None, t: float) -> SpinResult:
        """Process one observation at monotonic t seconds, without device access."""
        cfg = self.config
        if not isfinite(t) or self._time is not None and t <= self._time:
            self._break_path()
            return self._result("invalid timing")
        self._time = t
        face = all(self._point(image, i) is not None for i in (0, 2, 5))
        shoulders = self._axis(image, world, 11, 12)
        hips = self._axis(image, world, 23, 24)
        status = "need torso"
        if shoulders and hips:
            status = "torso disagreement"
        if (
            not shoulders
            or not hips
            or abs(degrees(_wrap(shoulders[0] - hips[0]))) > cfg.torso_agreement_degrees
        ):
            if self._good_time is not None and t - self._good_time > cfg.gap_seconds:
                self._break_path()
            self._rate = 0
            return self._result(status, face=face)

        yaw = atan2(
            sum(sin(p[0]) * p[1] for p in (shoulders, hips)),
            sum(cos(p[0]) * p[1] for p in (shoulders, hips)),
        )
        quality = min(shoulders[1], hips[1])
        if self._good_time is not None and t - self._good_time > cfg.gap_seconds:
            self._break_path()
        dt = t - self._good_time if self._good_time is not None else 0
        delta = degrees(_wrap(yaw - self._angle)) if self._angle is not None else 0
        if dt > 0 and abs(delta) > min(cfg.max_step, cfg.max_rate * dt + 3):
            self._break_path()
            self._angle, self._good_time = yaw, t
            return self._result("orientation jump", face=face)
        self._angle, self._good_time = yaw, t
        if dt > 0:
            self._rate += (1 - exp(-dt / cfg.rate_seconds)) * (delta / dt - self._rate)
        self._progress += delta
        if self._direction == 0 and abs(self._progress) >= 3 - 1e-7:
            self._direction = 1 if self._progress > 0 else -1
        if self._direction:
            self._peak = max(self._peak, self._progress * self._direction)
            retreat = self._peak - self._progress * self._direction
            if retreat >= cfg.reversal_degrees - 1e-7:
                self._direction *= -1
                self._progress = self._direction * retreat
                self._peak = retreat
                self._swaps = {"hands": False, "legs": False}
                self._pending_swaps.clear()

        # Use fresh image ordering independently of estimated world depth. At a
        # profile view a nearly overlapping pair has no reliable ordering.
        assert image is not None
        torso_points = [self._point(image, i) for i in (11, 12, 23, 24)]
        assert all(p is not None for p in torso_points)
        xs = [p[0] for p in torso_points if p is not None]
        ys = [p[1] for p in torso_points if p is not None]
        span = max(max(xs) - min(xs), max(ys) - min(ys), 1e-6)
        shoulder_order = self._order(image, 11, 12, span)
        hip_order = self._order(image, 23, 24, span)
        body_order = shoulder_order if shoulder_order == hip_order else 0
        support = False
        for name, options in (("hands", ((15, 16),)), ("legs", ((25, 26), (27, 28)))):
            pair = next((p for p in options if self._axis(image, world, *p)), None)
            if pair is None:
                self._candidates.pop(name, None)
                continue
            axis = self._axis(image, world, *pair)
            assert axis is not None
            aligned = abs(degrees(_wrap(axis[0] - yaw))) <= cfg.limb_agreement_degrees
            support = support or aligned
            if name in self._seen and t - self._seen[name] > cfg.gap_seconds:
                self._orders.pop(name, None)
                self._pending_swaps.pop(name, None)
            self._seen[name] = t
            order = self._order(image, *pair, span)
            if not order:
                self._candidates.pop(name, None)
                continue
            previous = self._orders.get(name)
            if previous is None:
                self._orders[name] = order
            elif previous != order:
                candidate = self._candidates.get(name)
                if candidate is None or candidate[0] != order:
                    self._candidates[name] = (order, t)
                elif t - candidate[1] >= cfg.order_hold_seconds:
                    self._orders[name] = order
                    self._candidates.pop(name, None)
                    self._pending_swaps[name] = (order, t)
            else:
                self._candidates.pop(name, None)
            pending = self._pending_swaps.get(name)
            if pending and t - pending[1] <= cfg.gap_seconds:
                if (
                    aligned
                    and pending[0] == order == body_order
                    and abs(self._progress) >= cfg.evidence_degrees - 1e-7
                ):
                    self._swaps[name] = True

        status = "turning" if abs(self._progress) >= 5 - 1e-7 else "ready"
        event = False
        completed = abs(self._progress) >= cfg.half_turn_degrees - 1e-7
        if completed:
            event = any(self._swaps.values())
            if event:
                if self._progress > 0:
                    self.left += 1
                else:
                    self.right += 1
            status = "half turn" if event else "unconfirmed"
        out = self._result(
            status,
            tracked=True,
            confidence=quality,
            face=face,
            active=support and abs(self._rate) > cfg.active_rate,
            event=event,
        )
        if completed:
            self._progress -= (1 if self._progress > 0 else -1) * cfg.half_turn_degrees
            self._peak = abs(self._progress)
            self._swaps = {"hands": False, "legs": False}
            self._pending_swaps.clear()
        return out
