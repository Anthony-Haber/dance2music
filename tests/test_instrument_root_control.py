"""Relative intervals, register, mode changes and body-relative position contracts."""

import json
import tempfile
import unittest
from dataclasses import asdict, replace
from pathlib import Path

import numpy as np

from instrument.audio import Synth
from instrument.controller import Controller
from instrument.harmony import INTERVALS, Chord, voice_lead
from instrument.models import Config, Frame, Hand
from instrument.replay import read_replay
from instrument.root_control import hand_directions

OFFSETS = {
    "center": (0, 0),
    "left": (-60, 0),
    "right": (60, 0),
    "up": (0, -60),
    "down": (0, 60),
    "diagonal": (60, 60),
}
EXPECTED = {
    "left": (-5, 5, 7, -7),
    "right": (-2, 2, 1, -1),
    "up": (-3, 3, 12, -6),
    "down": (-4, 4, 6, -12),
}


def position_frame(
    t: float, left: str = "center", right: str = "center", **kwargs: object
) -> Frame:
    wrists = tuple(
        Hand(side, (x + OFFSETS[direction][0], 240 + OFFSETS[direction][1]), "Victory", 1)
        for side, x, direction in (("L", 350, left), ("R", 290, right))
    )
    return Frame(t, wrists, (320, 240), 100, **kwargs)


class RootControlTests(unittest.TestCase):
    def setUp(self) -> None:
        self.controller = Controller(initial=Chord(0, "augmented"))
        self.t = -0.04

    def hold(self, left: str = "center", right: str = "center", frames: int = 12):
        for _ in range(frames):
            self.t += 0.04
            result = self.controller.update(position_frame(self.t, left, right))
        return result

    def test_every_pair_has_exact_signed_pitch_movement_and_all_roots_are_reachable(self) -> None:
        for root in range(12):
            reached = {root}
            for left, row in EXPECTED.items():
                for right, delta in zip(EXPECTED, row, strict=True):
                    with self.subTest(root=root, left=left, right=right):
                        self.setUp()
                        self.controller = Controller(initial=Chord(root, "augmented"))
                        original = self.hold()
                        moved = self.hold(left, right)
                        self.assertEqual(moved.root_midi, original.root_midi + delta)
                        self.assertEqual(moved.root, (root + delta) % 12)
                        self.assertEqual(moved.notes, tuple(n + delta for n in original.notes))
                        self.assertEqual(moved.quality, "augmented")
                        self.assertEqual(self.hold(left, right, 30).notes, moved.notes)
                        reached.add(moved.root)
            self.assertEqual(reached, set(range(12)))

    def test_startup_neutral_rearm_dwell_and_boundary_flicker(self) -> None:
        self.assertEqual(self.hold("left", "up", 30).root_midi, 48)
        self.hold(frames=4)  # Not long enough to rearm.
        self.assertEqual(self.hold("left", "up").root_midi, 48)
        self.assertTrue(self.hold().root_armed)
        self.assertEqual(self.hold("left", "up", 8).root_midi, 48)
        self.hold("diagonal", "up", 1)
        self.assertEqual(self.hold("left", "up", 8).root_midi, 48)
        moved = self.hold("left", "up", 2)
        self.assertEqual(moved.root_midi, 55)
        self.assertEqual(self.hold("right", "right", 30).root_midi, 55)
        self.hold()
        self.assertEqual(self.hold("right", "right").root_midi, 57)

    def test_all_catalogue_chords_transpose_without_losing_quality_or_tones(self) -> None:
        for quality in INTERVALS:
            for root in range(12):
                for left, row in EXPECTED.items():
                    for right, delta in zip(EXPECTED, row, strict=True):
                        controller = Controller(initial=Chord(root, quality))
                        original = controller.notes
                        for index in range(24):
                            a, b = ("center", "center") if index < 12 else (left, right)
                            frame = position_frame(index * 0.04, a, b)
                            frame = replace(
                                frame,
                                hands=tuple(
                                    replace(h, gesture="None", confidence=0) for h in frame.hands
                                ),
                            )
                            output = controller.update(frame)
                        self.assertEqual(
                            (output.root, output.quality), ((root + delta) % 12, quality)
                        )
                        self.assertEqual(output.notes, tuple(n + delta for n in original))
                        self.assertEqual(len(output.notes), len(INTERVALS[quality]))
                        self.assertTrue(all(0 <= n <= 127 for n in output.notes))

    def test_octaves_change_audio_frequency_and_round_trip_exactly(self) -> None:
        original = self.hold()
        up = self.hold("up", "up")
        self.assertEqual((up.root, up.root_midi), (0, 60))
        base_synth, up_synth = Synth(), Synth()
        base_audio = base_synth.render(48000, original.notes, 0.8)
        up_audio = up_synth.render(48000, up.notes, 0.8)
        np.testing.assert_allclose(
            up_synth.frequencies[: len(up.notes)],
            base_synth.frequencies[: len(original.notes)] * 2,
            atol=1e-4,
        )
        self.assertGreater(float(np.std(up_audio)), 0.01)
        self.assertFalse(np.array_equal(base_audio, up_audio))
        self.hold()
        down = self.hold("down", "down")
        self.assertEqual(down.notes, original.notes)
        self.assertEqual(down.root_midi, 48)

    def test_missing_tracking_and_gaps_cancel_candidates_and_require_neutral(self) -> None:
        self.hold()
        self.hold("left", "up", 6)
        self.t += 0.04
        self.controller.update(Frame(self.t))
        self.assertEqual(self.hold("left", "up", 30).root_midi, 48)
        self.hold()
        self.hold("left", "up", 6)
        self.t += 1
        self.assertEqual(self.hold("left", "up", 30).root_midi, 48)
        self.hold()
        self.assertEqual(self.hold("left", "up").root_midi, 55)

    def test_fist_lock_and_quality_changes_preserve_register(self) -> None:
        self.hold()
        up = self.hold("up", "up")
        self.hold()
        for _ in range(20):
            self.t += 0.04
            frame = position_frame(self.t)
            frame = replace(
                frame, hands=(replace(frame.hands[0], gesture="Closed_Fist"), frame.hands[1])
            )
            locked = self.controller.update(frame)
        self.assertTrue(locked.locked)
        self.assertEqual(self.hold("down", "down").notes, up.notes)
        for _ in range(12):
            self.t += 0.04
            frame = position_frame(self.t, "down", "down")
            frame = replace(
                frame,
                hands=(
                    replace(frame.hands[0], gesture="Pointing_Up"),
                    replace(frame.hands[1], gesture="Thumb_Up"),
                ),
            )
            changed = self.controller.update(frame)
        self.assertEqual((changed.root_midi, changed.quality), (60, "major9"))
        self.assertTrue(all(60 <= note <= 95 for note in changed.notes))
        self.assertEqual(len(changed.notes), 5)

    def test_mode_switch_preserves_chord_lock_and_requires_fresh_dwell(self) -> None:
        original = self.hold()
        self.hold("left", "up", 6)
        self.controller.toggle_root_mode()
        # At torso center, midpoint mode holds current root.
        switched = self.hold(frames=1)
        self.assertEqual(switched.root_mode, "midpoint")
        self.assertEqual(switched.notes, original.notes)
        self.assertIn("root_mode:midpoint", switched.events)
        self.controller.toggle_root_mode()
        self.assertEqual(self.hold("left", "up", 30).root_midi, 48)
        self.hold()
        self.assertEqual(self.hold("left", "up").root_midi, 55)
        self.controller.locked = True
        self.controller.toggle_root_mode()
        locked = self.hold("up", "up")
        self.assertTrue(locked.locked)
        self.assertEqual(locked.root_midi, 55)
        self.controller.reset()
        self.assertEqual((self.controller.root_mode, self.controller.root_midi), ("midpoint", 48))

    def test_translation_scale_shoulders_and_crossing_do_not_change_direction(self) -> None:
        frame = position_frame(0, "left", "up")
        self.assertEqual(hand_directions(frame, Config()), ("left", "up"))
        for scale, dx, dy in ((0.5, 30, 40), (2, 500, -20)):

            def transform(p, scale=scale, dx=dx, dy=dy):
                return p[0] * scale + dx, p[1] * scale + dy

            moved = replace(
                frame,
                hands=tuple(replace(h, wrist=transform(h.wrist)) for h in reversed(frame.hands)),
                torso_center=transform(frame.torso_center),
                torso_px=100 * scale,
            )
            self.assertEqual(hand_directions(moved, Config()), ("left", "up"))
        pose = [None] * 33
        pose[12], pose[11] = (350, 150), (290, 150)
        skeleton = replace(frame, pose_landmarks=tuple(pose))
        self.assertEqual(hand_directions(skeleton, Config()), ("left", "up"))
        pose[12] = None
        self.assertEqual(
            hand_directions(replace(frame, pose_landmarks=tuple(pose)), Config()), (None, "up")
        )

    def test_register_bounds_and_all_catalogue_qualities_stay_valid(self) -> None:
        for quality in INTERVALS:
            for root_midi in (0, 11, 48, 95, 96, 106):
                chord = Chord(root_midi % 12, quality)
                notes = voice_lead((), chord, root_midi - (48 + chord.root))
                self.assertTrue(all(0 <= n <= 127 for n in notes))
                self.assertEqual(notes[0], root_midi)
                self.assertEqual({n % 12 for n in notes}, set(chord.pitch_classes))
        self.hold()
        for _ in range(9):
            self.hold("up", "up")
            self.hold()
        limited = self.hold("up", "up")
        self.assertIn("REGISTER LIMIT", limited.root_feedback)
        self.assertTrue(all(0 <= n <= 127 for n in limited.notes))
        self.assertLessEqual(limited.root_midi, 106)
        for _ in range(12):
            self.hold()
            limited = self.hold("down", "down")
        self.assertIn("REGISTER LIMIT", limited.root_feedback)
        self.assertGreaterEqual(limited.root_midi, 0)

    def test_recorded_mode_switches_replay_exactly_and_legacy_defaults_to_midpoint(self) -> None:
        frames, states = [], []
        for index in range(50):
            mode = "interval" if index < 30 or index >= 40 else "midpoint"
            left, right = ("center", "center") if index < 10 else ("left", "up")
            frame = position_frame(index * 0.04, left, right, root_mode=mode)
            frames.append(frame)
            states.append(self.controller.update(frame))
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "frames.jsonl"
            path.write_text("\n".join(json.dumps(asdict(f)) for f in frames), encoding="utf-8")
            replay = Controller(initial=Chord(0, "augmented"))
            self.assertEqual([replay.update(f) for f in read_replay(path)], states)
            path.write_text('{"time_s":0}', encoding="utf-8")
            self.assertEqual(next(read_replay(path)).root_mode, "midpoint")
        for kwargs in (
            {"root_mode": "bad"},
            {"interval_neutral_torsos": 0},
            {"interval_axis_ratio": 1},
            {"interval_rearm_s": float("nan")},
        ):
            with self.assertRaises(ValueError):
                Config(**kwargs)
