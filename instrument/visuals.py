"""Native adaptation of Joseph Bakarji's wrist-based glow and sparks.

Geometry is supplied by the controller; replacing this renderer does not change
gesture or harmony semantics. BGR uint8 inputs have shape (height,width,3);
Outputs add HUD_HEIGHT rows (plus MIDI_STATUS_HEIGHT when enabled) above the entire
camera frame without changing its scale.
"""

import colorsys
import math
import random
from dataclasses import dataclass

import cv2
import numpy as np
from numpy.typing import NDArray

from instrument.harmony import ROOT_NAMES
from instrument.models import Config, Frame, Output, Point
from instrument.root_control import hand_origins, interval_name

HAND_EDGES = (
    (0, 1),
    (1, 2),
    (2, 3),
    (3, 4),
    (0, 5),
    (5, 6),
    (6, 7),
    (7, 8),
    (5, 9),
    (9, 10),
    (10, 11),
    (11, 12),
    (9, 13),
    (13, 14),
    (14, 15),
    (15, 16),
    (13, 17),
    (0, 17),
    (17, 18),
    (18, 19),
    (19, 20),
)
BODY_EDGES = (
    (11, 12),
    (11, 13),
    (13, 15),
    (12, 14),
    (14, 16),
    (11, 23),
    (12, 24),
    (23, 24),
    (23, 25),
    (25, 27),
    (24, 26),
    (26, 28),
    (27, 29),
    (29, 31),
    (28, 30),
    (30, 32),
)
HAND_READOUT_HEIGHT = 110
ROOT_STATUS_HEIGHT = 100
HUD_HEIGHT = 240 + HAND_READOUT_HEIGHT + ROOT_STATUS_HEIGHT
MIDI_STATUS_HEIGHT = 44


def pixel(point: Point) -> tuple[int, int]:
    return round(point[0]), round(point[1])


def _label(
    image: NDArray[np.uint8],
    text: str,
    anchor: Point,
    scale: float,
    color: tuple[int, int, int] = (255, 255, 255),
) -> None:
    """Bold text with a dark shadow and outline for contrast against camera/glow."""
    position = pixel(anchor)
    cv2.putText(
        image,
        text,
        (position[0] + 2, position[1] + 2),
        cv2.FONT_HERSHEY_SIMPLEX,
        scale,
        (0, 0, 0),
        6,
        cv2.LINE_AA,
    )
    cv2.putText(image, text, position, cv2.FONT_HERSHEY_SIMPLEX, scale, (0, 0, 0), 6, cv2.LINE_AA)
    cv2.putText(image, text, position, cv2.FONT_HERSHEY_SIMPLEX, scale, color, 2, cv2.LINE_AA)


def root_color(root: int) -> tuple[int, int, int]:
    rgb = colorsys.hsv_to_rgb(root / 12, 0.55, 1)
    return tuple(round(v * 255) for v in reversed(rgb))  # type: ignore[return-value]


@dataclass
class Particle:
    x: float
    y: float
    vx: float
    vy: float
    life: float
    age: float = 0.0


class Renderer:
    def __init__(self, style: str = "fire", seed: int = 0, config: Config | None = None) -> None:
        if style not in {"fire", "light"}:
            raise ValueError("Ball style must be fire or light")
        self.style = style
        self.config = config if config is not None else Config()
        self.random = random.Random(seed)
        self.particles: list[Particle] = []
        self.previous_time: float | None = None
        self.previous_split: bool | None = None
        self.previous_owner: str | None = None

    def draw(
        self,
        image: NDArray[np.uint8],
        frame: Frame,
        state: Output,
        latency_ms: float = 0,
        midi_status: str | None = None,
    ) -> NDArray[np.uint8]:
        """Return an independent rendered image; caller's input is never modified."""
        if image.ndim != 3 or image.shape[2] != 3 or image.dtype != np.uint8:
            raise ValueError("Renderer expects a uint8 HxWx3 BGR image")
        out = image.copy()
        if frame.pose_landmarks:
            for first, second in BODY_EDGES:
                a, b = frame.pose_landmarks[first], frame.pose_landmarks[second]
                if a is not None and b is not None:
                    cv2.line(out, pixel(a), pixel(b), (190, 190, 100), 2, cv2.LINE_AA)
            for point in frame.pose_landmarks:
                if point is not None:
                    cv2.circle(out, pixel(point), 3, (220, 220, 130), -1, cv2.LINE_AA)
        dt = (
            0 if self.previous_time is None else min(0.1, max(0, frame.time_s - self.previous_time))
        )
        self.previous_time = frame.time_s
        if (
            not state.balls
            or state.split != self.previous_split
            or state.ball_owner != self.previous_owner
        ):
            self.particles.clear()
        self.previous_split = state.split
        self.previous_owner = state.ball_owner
        color = root_color(state.root)
        for ball in state.balls:
            flicker = (
                1
                + 0.05 * math.sin(frame.time_s / 0.045)
                + 0.035 * math.sin(frame.time_s / 0.023 + 1)
                + 0.08 * frame.energy * math.sin(frame.time_s / 0.011)
            )
            radius = max(2.0, ball.radius * flicker)
            self._glow(out, ball.center, radius, color)
            # Spawn proportional to elapsed time, not machine frame rate.
            rate = (30 + 240 * frame.energy + 180 * state.gain) / len(state.balls)
            for _ in range(int(rate * dt)):
                angle = self.random.uniform(0, math.tau)
                speed = self.random.uniform(40, 200) * (0.4 + frame.energy)
                self.particles.append(
                    Particle(
                        ball.center[0] + radius * math.cos(angle),
                        ball.center[1] + radius * math.sin(angle),
                        speed * math.cos(angle),
                        speed * math.sin(angle) - (60 if self.style == "fire" else 0),
                        self.random.uniform(0.4, 0.9),
                    )
                )
        particle_layer = np.zeros_like(out)
        for particle in self.particles:
            particle.age += dt
            particle.x += particle.vx * dt
            particle.y += particle.vy * dt
            if self.style == "fire":
                particle.vy -= 120 * dt
            opacity = max(0.0, 1 - particle.age / particle.life)
            tint = color if self.style == "light" else (60, 140 + round(100 * opacity), 255)
            cv2.circle(
                particle_layer,
                (round(particle.x), round(particle.y)),
                round(1 + 2.5 * opacity),
                tuple(round(c * opacity) for c in tint),
                -1,
                cv2.LINE_AA,
            )
        out = cv2.add(out, particle_layer).astype(np.uint8)
        self.particles = [p for p in self.particles if p.age < p.life][-300:]
        self._guides(out, frame, state, color)
        # Controls occupy their own rows; never conceal the camera's head/upper body.
        panel_height = HUD_HEIGHT + (MIDI_STATUS_HEIGHT if midi_status is not None else 0)
        panel = np.zeros((panel_height, image.shape[1], 3), dtype=np.uint8)
        self._hud(panel, frame, state, latency_ms)
        if midi_status is not None:
            text_width = cv2.getTextSize(midi_status, cv2.FONT_HERSHEY_SIMPLEX, 0.65, 2)[0][0]
            scale = 0.65 * min(1.0, max(1, image.shape[1] - 32) / max(1, text_width))
            _label(panel, midi_status, (16, HUD_HEIGHT + 30), scale, (150, 230, 180))
        return np.concatenate((panel, out), axis=0)

    def _glow(
        self, image: NDArray[np.uint8], center: Point, radius: float, color: tuple[int, int, int]
    ) -> None:
        height, width = image.shape[:2]
        extent = min(radius * 1.25, max(width, height) * 2)
        x, y = center
        x0, x1 = max(0, int(x - extent)), min(width, int(x + extent) + 1)
        y0, y1 = max(0, int(y - extent)), min(height, int(y + extent) + 1)
        if x0 >= x1 or y0 >= y1:
            return
        yy, xx = np.ogrid[y0:y1, x0:x1]
        fraction = np.sqrt((xx - x) ** 2 + (yy - y) ** 2) / max(extent, 1)
        stops = (0, 0.3, 0.75, 1) if self.style == "light" else (0, 0.3, 0.65, 1)
        colors = (
            ((255, 255, 255), color, color, color)
            if self.style == "light"
            else ((225, 250, 255), (90, 200, 255), (30, 100, 255), (10, 30, 190))
        )
        alpha = (0.95, 0.75, 0.30, 0) if self.style == "light" else (0.95, 0.8, 0.45, 0)
        overlay = np.stack(
            [
                np.interp(
                    fraction, stops, [c[channel] * a for c, a in zip(colors, alpha, strict=True)]
                )
                for channel in range(3)
            ],
            axis=2,
        )
        roi = image[y0:y1, x0:x1]
        image[y0:y1, x0:x1] = np.clip(roi.astype(np.float32) + overlay, 0, 255).astype(np.uint8)
        cv2.circle(
            image,
            pixel(center),
            min(round(radius), max(width, height) * 2),
            color if self.style == "light" else (70, 170, 255),
            1,
            cv2.LINE_AA,
        )

    def _guides(
        self, image: NDArray[np.uint8], frame: Frame, state: Output, color: tuple[int, int, int]
    ) -> None:
        if state.root_mode == "interval" and frame.torso_px is not None:
            for side, origin in hand_origins(frame).items():
                cv2.circle(
                    image,
                    pixel(origin),
                    round(frame.torso_px * self.config.interval_neutral_torsos),
                    (160, 160, 160),
                    1,
                    cv2.LINE_AA,
                )
                radius = frame.torso_px * self.config.interval_neutral_torsos
                label_x = origin[0] + radius + 8 if side == "L" else origin[0] - radius - 100
                _label(image, f"{side} CENTER", (label_x, origin[1] + 6), 0.5)
        elif frame.torso_center is not None and frame.torso_px is not None:
            center, radius = frame.torso_center, frame.torso_px * 1.2
            for root, name in enumerate(ROOT_NAMES):
                angle = root * math.pi / 6
                anchor = (
                    center[0] + radius * math.cos(angle),
                    center[1] + radius * math.sin(angle),
                )
                _label(image, name, anchor, 0.9)
            cv2.circle(
                image,
                pixel(center),
                round(frame.torso_px * self.config.dead_zone_torsos),
                (90, 90, 90),
                1,
            )
        for hand in frame.hands:
            for first, second in HAND_EDGES if hand.landmarks else ():
                cv2.line(
                    image,
                    pixel(hand.landmarks[first]),
                    pixel(hand.landmarks[second]),
                    color,
                    1,
                    cv2.LINE_AA,
                )
            cv2.circle(image, pixel(hand.wrist), 5, color, -1)
            label = (
                f"{hand.side}: {hand.gesture} {hand.confidence:.2f}"
                if hand.landmarks or hand.gesture != "None"
                else f"{hand.side}: body wrist"
            )
            _label(image, label, (hand.wrist[0] + 8, hand.wrist[1] + 26), 0.7)
            if hand.landmarks and hand.raw_gesture is not None:
                _label(
                    image,
                    f"raw: {hand.raw_gesture} {hand.raw_confidence:.2f}",
                    (hand.wrist[0] + 8, hand.wrist[1] + 54),
                    0.7,
                )

    def _hud(
        self, image: NDArray[np.uint8], frame: Frame, state: Output, latency_ms: float
    ) -> None:
        image[:] = (18, 18, 24)
        hands = {hand.side: hand for hand in frame.hands}
        column_width = image.shape[1] // 2
        for column, (side, name) in enumerate((("L", "LEFT HAND"), ("R", "RIGHT HAND"))):
            x = column * column_width + 16
            hand = hands.get(side)
            tint = (255, 220, 150) if side == "L" else (150, 220, 255)
            _label(image, name, (x, 24), 0.65, tint)
            gesture = (
                "NOT SEEN"
                if hand is None
                else "UNKNOWN"
                if hand.gesture == "None"
                else hand.gesture.replace("_", " ").upper()
            )
            # Enlarge on wide camera feeds, fitting each label within its own column.
            scale = min(1.8, max(0.95, image.shape[1] / 640 * 0.95))
            text_width = cv2.getTextSize(gesture, cv2.FONT_HERSHEY_SIMPLEX, scale, 2)[0][0]
            scale *= min(1.0, max(1, column_width - 40) / max(1, text_width))
            _label(image, gesture, (x, 66), scale, tint)
            raw = (
                "No hand detected"
                if hand is None
                else f"Seeing: {hand.raw_gesture.replace('_', ' ')} {hand.raw_confidence:.0%}"
                if hand.raw_gesture is not None
                else "Seeing: unavailable"
                if hand.landmarks
                else "Wrist only; no gesture"
            )
            _label(image, raw, (x, 94), 0.5)
        # Keep the existing controls below the prominent gesture readouts.
        image = image[HAND_READOUT_HEIGHT:]
        root_note = f"{ROOT_NAMES[state.root]}{state.root_midi // 12 - 1}"
        if state.root_mode == "interval":
            _label(image, f"ROOT: INTERVAL | {root_note} | T: MIDPOINT", (16, 26), 0.65)
            left, right = (
                direction.upper() if direction else "MISSING" for direction in state.hand_directions
            )
            _label(image, f"LEFT: {left} | RIGHT: {right}", (16, 56), 0.65)
            feedback = state.root_feedback
            if state.root_armed and state.interval_candidate is not None:
                target = state.root_midi + state.interval_candidate
                target_note = f"{ROOT_NAMES[target % 12]}{target // 12 - 1}"
                feedback = (
                    f"{interval_name(state.interval_candidate)}: {root_note} -> {target_note}"
                    f" | {feedback}"
                )
            feedback_width = cv2.getTextSize(feedback, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)[0][0]
            feedback_scale = 0.6 * min(1.0, max(1, image.shape[1] - 40) / max(1, feedback_width))
            _label(image, feedback, (16, 88), feedback_scale)
        else:
            _label(image, f"ROOT: MIDPOINT | {root_note} | T: INTERVAL", (16, 26), 0.65)
            _label(image, "Move hand midpoint around the root ring", (16, 56), 0.6)
            midpoint_target = (
                ROOT_NAMES[state.root_candidate] if state.root_candidate is not None else "HOLD"
            )
            _label(image, f"TARGET: {midpoint_target}", (16, 88), 0.6)
        image = image[ROOT_STATUS_HEIGHT:]
        lock_status = (
            "ROOT LOCKED"
            if state.locked
            else "ROOT LOCKING..."
            if state.pending_lock
            else "ROOT FREE"
        )
        _label(image, f"{state.symbol}   {lock_status}", (16, 36), 1.0, (150, 230, 180))
        status = "BODY / WRISTS READY" if state.balls else "BODY / WRISTS INCOMPLETE"
        mode = "TWO BALLS" if state.split else "ONE BALL"
        if state.ball_owner is not None:
            side = "LEFT" if state.ball_owner == "L" else "RIGHT"
            mode = f"ONE BALL: {side} HAND"
            status = f"{side} HAND READY" if state.balls else f"{side} HAND / BODY NOT SEEN"
        if state.pending_transfer is not None:
            side = "LEFT" if state.pending_transfer == "L" else "RIGHT"
            status = f"TRANSFERRING TO {side} HAND..."
        _label(image, f"{mode} | gain {state.gain:.0%} | {latency_ms:.1f} ms", (16, 68), 0.65)
        _label(image, status, (16, 100), 0.65)
        for y, line in (
            (132, "Fist+palm: transfer | Near fists: split/merge"),
            (164, "T: root mode | R: reset | S: style | Q: quit"),
            (196, "M: midpoint | 25 pairs | Point: index up"),
            (
                228,
                f"Both hands | Palms {self.config.major_dwell_s:g}s: major | Unknown: hold",
            ),
        ):
            _label(image, line, (16, y), 0.6, (210, 210, 220))
