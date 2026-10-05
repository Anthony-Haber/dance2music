"""Native adaptation of Joseph Bakarji's wrist-based glow and sparks.

Geometry is supplied by the controller; replacing this renderer does not change
gesture or harmony semantics. BGR uint8 images have shape (height,width,3).
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


def pixel(point: Point) -> tuple[int, int]:
    return round(point[0]), round(point[1])


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

    def draw(
        self, image: NDArray[np.uint8], frame: Frame, state: Output, latency_ms: float = 0
    ) -> NDArray[np.uint8]:
        """Return an independent rendered image; caller's input is never modified."""
        if image.ndim != 3 or image.shape[2] != 3 or image.dtype != np.uint8:
            raise ValueError("Renderer expects a uint8 HxWx3 BGR image")
        out = image.copy()
        dt = (
            0 if self.previous_time is None else min(0.1, max(0, frame.time_s - self.previous_time))
        )
        self.previous_time = frame.time_s
        if not state.balls or state.split != self.previous_split:
            self.particles.clear()
        self.previous_split = state.split
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
        self._hud(out, frame, state, latency_ms)
        return out

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
        if frame.torso_center is not None and frame.torso_px is not None:
            center, radius = frame.torso_center, frame.torso_px * 1.2
            for root, name in enumerate(ROOT_NAMES):
                angle = root * math.pi / 6
                anchor = (
                    center[0] + radius * math.cos(angle),
                    center[1] + radius * math.sin(angle),
                )
                cv2.putText(
                    image,
                    name,
                    pixel(anchor),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.5,
                    root_color(root) if root == state.root else (150, 150, 150),
                    1,
                    cv2.LINE_AA,
                )
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
            label = f"{hand.side}: {hand.gesture} {hand.confidence:.2f}"
            cv2.putText(
                image,
                label,
                pixel((hand.wrist[0] + 8, hand.wrist[1] + 20)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.4,
                (230, 230, 230),
                1,
                cv2.LINE_AA,
            )

    @staticmethod
    def _hud(image: NDArray[np.uint8], frame: Frame, state: Output, latency_ms: float) -> None:
        cv2.rectangle(image, (0, 0), (image.shape[1], 110), (18, 18, 24), -1)
        text = (
            f"{state.symbol}   {'ROOT LOCKED' if state.locked else 'ROOT FREE'}"
            f"   {'TWO BALLS' if state.split else 'ONE BALL'}"
        )
        cv2.putText(
            image, text, (16, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (150, 230, 180), 2, cv2.LINE_AA
        )
        status = "TRACKING READY" if state.gain > 0 else "TRACKING INCOMPLETE / SILENT"
        if state.pending_lock:
            status += "   deciding fist / split"
        cv2.putText(
            image,
            f"{status}   {latency_ms:.1f} ms processing",
            (16, 55),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.45,
            (210, 210, 210),
            1,
            cv2.LINE_AA,
        )
        for y, line in (
            (78, "M merge | R reset | S fire/light | Q quit"),
            (99, "Palm major | Point minor | Victory 7 | Thumb up maj7 | down m7 | Love m(maj7)"),
        ):
            cv2.putText(
                image,
                line,
                (16, y),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.40,
                (170, 170, 180),
                1,
                cv2.LINE_AA,
            )
