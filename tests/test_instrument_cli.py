"""Native CLI contracts, replay exports, tracking adapters and failure messages."""

import json
import subprocess
import sys
import tempfile
import unittest
import wave
from contextlib import ExitStack
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import numpy as np

from instrument.__main__ import Exports
from instrument.controller import Controller
from instrument.models import Frame
from instrument.replay import read_replay
from instrument.tracking import observations, torso_geometry


class CliTests(unittest.TestCase):
    def test_exported_audio_changes_at_observation_time_after_irregular_gap(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary)
            image = np.zeros((240, 320, 3), dtype=np.uint8)
            silent = Controller().update(Frame(0))
            with ExitStack() as stack:
                exporter = Exports(target, 30, stack)
                for timestamp in (0.0, 0.12, 1.2):
                    frame = Frame(timestamp)
                    state = replace(silent, time_s=timestamp, gain=1.0 if timestamp == 1.2 else 0)
                    exporter.write(frame, state, image)
            with wave.open(str(target / "chords.wav"), "rb") as stream:
                samples = np.frombuffer(stream.readframes(stream.getnframes()), dtype="<i2")
            np.testing.assert_array_equal(samples[:57600], np.zeros(57600, dtype=np.int16))
            self.assertGreater(int(np.max(np.abs(samples[57600:]))), 100)
            self.assertEqual(len(samples), 59200)

    def test_malformed_replay_has_line_context(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "frames.jsonl"
            for invalid in (
                [],
                {"time_s": 0, "hands": [{"side": "L", "wrist": [0, 0], "gesture": []}]},
            ):
                with self.subTest(invalid=invalid):
                    path.write_text(json.dumps(invalid) + "\n", encoding="utf-8")
                    with self.assertRaisesRegex(ValueError, "line 1"):
                        list(read_replay(path))

    def test_tracking_adapter_rejects_nonfinite_confidence(self) -> None:
        landmarks = [SimpleNamespace(x=0.2, y=0.3) for _ in range(21)]
        for handedness_score, gesture_score in ((float("nan"), 0.9), (0.9, float("nan"))):
            result = SimpleNamespace(
                hand_landmarks=[landmarks],
                handedness=[[SimpleNamespace(category_name="Left", score=handedness_score)]],
                gestures=[[SimpleNamespace(category_name="Open_Palm", score=gesture_score)]],
            )
            with self.subTest(handedness=handedness_score, gesture=gesture_score):
                self.assertEqual(observations(result, 640, 480), ())
        body = [SimpleNamespace(x=0.5, y=0.3, visibility=1, presence=1) for _ in range(33)]
        body[23].y = body[24].y = 0.7
        for attribute in ("visibility", "presence"):
            with self.subTest(attribute=attribute):
                setattr(body[11], attribute, float("nan"))
                self.assertEqual(
                    torso_geometry(SimpleNamespace(pose_landmarks=[body]), 640, 480), (None, None)
                )
                setattr(body[11], attribute, 1)

    def test_headless_demo_writes_events_audio_and_frames_without_models(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary)
            process = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "instrument",
                    "--demo",
                    "--headless",
                    "--seconds",
                    "15",
                    "--fps",
                    "10",
                    "--output",
                    str(target),
                ],
                capture_output=True,
                text=True,
                timeout=60,
            )
            self.assertEqual(process.returncode, 0, process.stderr)
            summary = json.loads(process.stdout)
            self.assertEqual(summary["frames"], 150)
            states = [
                json.loads(line) for line in (target / "states.jsonl").read_text().splitlines()
            ]
            events = {event for state in states for event in state["events"]}
            self.assertTrue({"lock", "unlock", "split", "chord"}.issubset(events))
            self.assertTrue(states[-1]["split"])
            self.assertTrue((target / "chords.wav").is_file())
            self.assertTrue((target / "split.png").is_file())
            self.assertEqual(len(list(read_replay(target / "frames.jsonl"))), 150)

    def test_replay_bad_line_and_missing_model_fail_cleanly(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "frames.jsonl"
            path.write_text('{"time_s": 1}\n{"time_s": 1}\n', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "line 2"):
                list(read_replay(path))
            process = subprocess.run(
                [sys.executable, "-m", "instrument", "--model-smoke", "--models", temporary],
                capture_output=True,
                text=True,
                timeout=10,
            )
            self.assertNotEqual(process.returncode, 0)
            self.assertIn("Missing local model", process.stderr)

    def test_tracking_adapter_drops_duplicates_and_missing_body(self) -> None:
        landmarks = [SimpleNamespace(x=0.1 + i * 0.001, y=0.2) for i in range(21)]
        category = SimpleNamespace(category_name="Open_Palm", score=0.9)
        left = SimpleNamespace(category_name="Left", score=0.9)
        result = SimpleNamespace(
            hand_landmarks=[landmarks], handedness=[[left]], gestures=[[category]]
        )
        hands = observations(result, 640, 480)
        self.assertEqual(hands[0].wrist, (64, 96))
        self.assertTrue(0 <= hands[0].openness <= 1)
        result.hand_landmarks *= 2
        result.handedness *= 2
        result.gestures *= 2
        self.assertEqual(observations(result, 640, 480), ())
        self.assertEqual(torso_geometry(SimpleNamespace(pose_landmarks=[]), 640, 480), (None, None))
        body = [SimpleNamespace(x=0.5, y=0.3, visibility=1, presence=1) for _ in range(33)]
        body[23].y = body[24].y = 0.7
        center, scale = torso_geometry(SimpleNamespace(pose_landmarks=[body]), 640, 480)
        np.testing.assert_allclose(center, (320, 240), atol=1e-9)
        self.assertAlmostEqual(scale, 192)

    def test_model_setup_rejects_corrupt_existing_file_without_network(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            (Path(temporary) / "gesture_recognizer.task").write_bytes(b"corrupt model")
            process = subprocess.run(
                [sys.executable, "-m", "instrument.setup_models", "--directory", temporary],
                capture_output=True,
                text=True,
                timeout=10,
            )
            self.assertNotEqual(process.returncode, 0)
            self.assertIn("checksum mismatch", process.stderr)
