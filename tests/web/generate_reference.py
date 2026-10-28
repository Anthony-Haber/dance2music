"""Export native behavior for dependency-free Node parity tests (no devices)."""

import gzip
import hashlib
import json
import random
import sys
from dataclasses import asdict, replace
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from instrument.controller import Controller  # noqa: E402
from instrument.harmony import CHORD_SIGNS, INTERVALS, Chord, voice_lead  # noqa: E402
from instrument.models import Config, Frame, Hand  # noqa: E402
from instrument.root_control import DIRECTIONS  # noqa: E402


def frame(time: float, left: str = "Open_Palm", right: str = "Open_Palm", gap: float = 90) -> Frame:
    return Frame(
        time,
        (Hand("L", (320 - gap / 2, 240), left, 1), Hand("R", (320 + gap / 2, 240), right, 1)),
        (320, 240),
        100,
    )


def references() -> dict[str, Any]:
    cases: list[dict[str, Any]] = []

    def export(
        name: str,
        frames: list[Frame],
        config: Config | None = None,
        initial: Chord | None = None,
        commands: dict[int, str] | None = None,
    ) -> None:
        config = config or Config()
        initial = initial or Chord()
        controller = Controller(config, initial)
        records = []
        for index, observation in enumerate(frames):
            command = (commands or {}).get(index)
            if command:
                getattr(controller, command)()
            records.append(
                {
                    "frame": asdict(observation),
                    "command": command,
                    "expected": asdict(controller.update(observation)),
                }
            )
        cases.append(
            {"name": name, "config": asdict(config), "initial": asdict(initial), "records": records}
        )

    for right in CHORD_SIGNS:
        for left in CHORD_SIGNS:
            export(
                f"pair:{left}:{right}",
                [frame(i * 0.04, left, right) for i in range(50)],
                initial=Chord(7, "dominant13"),
            )
    for gap in (90, 220):
        phases = [
            ("Open_Palm", "Open_Palm"),
            ("Closed_Fist", "Closed_Fist"),
            ("Open_Palm", "Open_Palm"),
            ("Closed_Fist", "Open_Palm"),
            ("Open_Palm", "Open_Palm"),
            ("Victory", "Closed_Fist"),
            ("Victory", "Victory"),
            ("Victory", "Closed_Fist"),
            ("Open_Palm", "Open_Palm"),
            ("Closed_Fist", "Closed_Fist"),
        ]
        frames = [
            frame(round((phase * 30 + i) * 0.04, 6), left, right, gap)
            for phase, (left, right) in enumerate(phases)
            for i in range(30)
        ]
        export(f"ball-and-lock:{gap}", frames)
        export(
            f"keyboard:{gap}", frames, commands={90: "merge", 140: "toggle_root_mode", 220: "reset"}
        )
    offsets = {
        "center": (0, 0),
        "left": (-60, 0),
        "right": (60, 0),
        "up": (0, -60),
        "down": (0, 60),
    }
    for left in DIRECTIONS:
        for right in DIRECTIONS:
            frames = []
            for index in range(60):
                pair = ("center", "center") if index < 10 else (left, right)
                hands = tuple(
                    Hand(side, (x + offsets[d][0], 240 + offsets[d][1]), "Victory", 1)
                    for side, x, d in (("L", 350, pair[0]), ("R", 290, pair[1]))
                )
                frames.append(Frame(index * 0.04, hands, (320, 240), 100))
            export(f"interval:{left}:{right}", frames, initial=Chord(0, "augmented"))
    export(
        "tracking-loss",
        [
            frame(i * 0.04, "Closed_Fist" if 10 <= i < 30 else "Victory", "Open_Palm")
            if i < 40
            else replace(
                frame(i * 0.04),
                hands=() if i < 45 else frame(i * 0.04).hands[:1],
                torso_center=None if i == 48 else (320, 240),
            )
            for i in range(55)
        ],
    )
    # Seeded raw/confirmed flicker, missing observations, gaps and mode changes.
    randomizer = random.Random(20261013)
    time = 0.0
    frames = []
    signs = [*CHORD_SIGNS, "Closed_Fist", "None", "ILoveYou"]
    for index in range(500):
        time = round(time + randomizer.choice([0.02, 0.04, 0.1, 0.25]), 6)
        observation = frame(
            time,
            randomizer.choice(signs),
            randomizer.choice(signs),
            randomizer.choice([70, 100, 300]),
        )
        if index % 11 == 0:
            observation = replace(observation, hands=observation.hands[:1])
        if index % 19 == 0:
            observation = replace(observation, torso_px=None)
        if index % 31 == 0:
            observation = replace(
                observation, root_mode=randomizer.choice(["interval", "midpoint"])
            )
        frames.append(observation)
    export("seeded-boundaries", frames)
    frames = []
    for index in range(55):
        observation = frame(index * 0.04)
        left_hand = observation.hands[0]
        left_hand = replace(
            left_hand,
            gesture="Closed_Fist" if 19 <= index < 38 else "Open_Palm",
            raw_gesture="Closed_Fist" if 10 <= index < 38 and index % 3 else "None",
            raw_confidence=1,
            gesture_since=0.4 if 19 <= index < 38 else 0,
        )
        frames.append(replace(observation, hands=(left_hand, observation.hands[1])))
    export("confirmed-fist-raw-flicker", frames)
    chords = [Chord(root, quality) for root in range(12) for quality in INTERVALS]
    catalogue = [
        {**asdict(chord), "symbol": chord.symbol, "notes": voice_lead((), chord)}
        for chord in chords
    ]
    digest = hashlib.sha256()
    for previous in catalogue:
        for chord in chords:
            digest.update(
                (
                    json.dumps(voice_lead(tuple(previous["notes"]), chord), separators=(",", ":"))
                    + "\n"
                ).encode()
            )
    return {
        "source": "instrument Python contracts; seed 20261013",
        "cases": cases,
        "catalogue": catalogue,
        "transition_sha256": digest.hexdigest(),
    }


if __name__ == "__main__":
    destination = Path(__file__).with_name("native-reference.json.gz")
    destination.write_bytes(
        gzip.compress(json.dumps(references(), separators=(",", ":")).encode(), mtime=0)
    )
    print(f"Native fixtures: {destination}")
