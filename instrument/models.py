"""Device-independent contracts. Positions and radii use displayed image pixels."""

from dataclasses import dataclass
from math import isfinite

Point = tuple[float, float]
GESTURES = frozenset(
    {"Closed_Fist", "Open_Palm", "Pointing_Up", "Victory", "Thumb_Up", "Thumb_Down", "ILoveYou"}
)


def valid_point(point: Point) -> bool:
    """True when both pixel coordinates are finite."""
    return len(point) == 2 and all(isfinite(value) for value in point)


@dataclass(frozen=True)
class Hand:
    side: str
    wrist: Point
    gesture: str = "None"
    confidence: float = 0.0
    openness: float = 0.0
    landmarks: tuple[Point, ...] = ()

    def __post_init__(self) -> None:
        if not isinstance(self.gesture, str):
            raise ValueError("Hand gesture must be a string label")
        if self.side not in {"L", "R"} or not valid_point(self.wrist):
            raise ValueError("Hand needs side L/R and finite wrist pixel coordinates")
        if not isfinite(self.confidence) or not 0 <= self.confidence <= 1:
            raise ValueError("Hand confidence must be finite in [0, 1]")
        if not isfinite(self.openness) or not 0 <= self.openness <= 1:
            raise ValueError("Hand openness must be finite in [0, 1]")
        if self.landmarks and (
            len(self.landmarks) != 21 or not all(valid_point(p) for p in self.landmarks)
        ):
            raise ValueError("Hand landmarks must be empty or 21 finite image points")


@dataclass(frozen=True)
class Frame:
    time_s: float
    hands: tuple[Hand, ...] = ()
    torso_center: Point | None = None
    torso_px: float | None = None
    energy: float = 0.0

    def __post_init__(self) -> None:
        if not isfinite(self.time_s) or self.time_s < 0:
            raise ValueError("Frame time must be finite nonnegative seconds")
        if len({hand.side for hand in self.hands}) != len(self.hands):
            raise ValueError("Each hand side may appear only once per frame")
        if self.torso_center is not None and not valid_point(self.torso_center):
            raise ValueError("Torso center must be finite")
        if self.torso_px is not None and (not isfinite(self.torso_px) or self.torso_px <= 0):
            raise ValueError("Torso length must be finite positive pixels or None")
        if not isfinite(self.energy) or not 0 <= self.energy <= 1:
            raise ValueError("Energy must be finite in [0, 1]")


@dataclass(frozen=True)
class Config:
    close_s: float = 0.35
    reopen_s: float = 0.20
    arbitration_s: float = 0.25
    root_dwell_s: float = 0.35
    quality_dwell_s: float = 0.35
    max_gap_s: float = 0.20
    confidence_min: float = 0.5
    split_torsos: float = 0.6
    dead_zone_torsos: float = 0.25
    gain_exponent: float = 1.5

    def __post_init__(self) -> None:
        for name in (
            "close_s",
            "reopen_s",
            "arbitration_s",
            "root_dwell_s",
            "quality_dwell_s",
            "max_gap_s",
            "split_torsos",
            "dead_zone_torsos",
            "gain_exponent",
        ):
            value = getattr(self, name)
            if not isfinite(value) or value <= 0:
                raise ValueError(f"{name} must be finite positive")
        if not isfinite(self.confidence_min) or not 0 < self.confidence_min <= 1:
            raise ValueError("confidence_min must be in (0, 1]")


@dataclass(frozen=True)
class Ball:
    center: Point
    radius: float
    anchor: str = "middle"


@dataclass(frozen=True)
class Output:
    time_s: float
    root: int
    quality: str
    symbol: str
    notes: tuple[int, ...]
    locked: bool
    split: bool
    balls: tuple[Ball, ...]
    gain: float
    events: tuple[str, ...] = ()
    root_candidate: int | None = None
    pending_lock: bool = False
