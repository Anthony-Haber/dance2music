"""Repeatable scripted frames and JSONL replay, independent of camera/models."""

import json
import math
from collections.abc import Iterator
from pathlib import Path

from instrument.models import Frame, Hand


def demonstration(fps: int = 30) -> Iterator[Frame]:
    """15-second sequence: root, lock, locked minor, unlock, near split, reopen.

    Coordinates use a 960x720 image with a 160-pixel torso; no CV claim is made.
    """
    if fps <= 0:
        raise ValueError("fps must be positive")
    for index in range(15 * fps):
        t = index / fps
        angle = (0 if t < 1 else 7 if t < 7 else 2) * math.pi / 6
        midpoint = (480 + 185 * math.cos(angle), 360 + 185 * math.sin(angle))
        gap = 60 if 10 <= t < 12 else 220
        left, right = "Open_Palm", "Open_Palm"
        if 2 <= t < 3 or 7 <= t < 8:
            left = "Closed_Fist"
        if 4 <= t < 7:
            right = "Pointing_Up"
        if 10 <= t < 12:
            left = right = "Closed_Fist"
        yield Frame(
            t,
            (
                Hand("L", (midpoint[0] - gap / 2, midpoint[1]), left, 0.99),
                Hand("R", (midpoint[0] + gap / 2, midpoint[1]), right, 0.99),
            ),
            (480, 360),
            160,
            0.3 + 0.2 * math.sin(t),
        )


def read_replay(path: Path) -> Iterator[Frame]:
    """JSONL: time_s, hands[{side,wrist,gesture,confidence}], torso_center/px, energy.

    Coordinates are pixels. None means missing pose; absent hands mean tracking
    loss. Invalid or nonmonotonic timestamps fail rather than silently reorder.
    """
    previous = -1.0
    with path.open(encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, 1):
            if not line.strip():
                continue
            try:
                data = json.loads(line)
                if not isinstance(data, dict):
                    raise ValueError("each observation must be a JSON object")
                if not isinstance(data.get("hands", []), list) or any(
                    not isinstance(hand, dict) for hand in data.get("hands", [])
                ):
                    raise ValueError("hands must be a list of JSON objects")
                hands = tuple(
                    Hand(
                        h["side"],
                        tuple(h["wrist"]),
                        h.get("gesture", "None"),
                        h.get("confidence", 0),
                        h.get("openness", 0),
                        tuple(tuple(p) for p in h.get("landmarks", [])),
                    )
                    for h in data.get("hands", [])
                )
                frame = Frame(
                    data["time_s"],
                    hands,
                    tuple(data["torso_center"]) if data.get("torso_center") else None,
                    data.get("torso_px"),
                    data.get("energy", 0),
                )
                if frame.time_s <= previous:
                    raise ValueError("timestamps must strictly increase")
                previous = frame.time_s
            except (KeyError, TypeError, ValueError) as error:
                raise ValueError(f"Invalid replay {path}, line {line_number}: {error}") from error
            yield frame
