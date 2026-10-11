"""Website canned-gesture parity and regression coverage for flickering fists."""

import json
import shutil
import subprocess
import tempfile
import unittest
from dataclasses import asdict, replace
from pathlib import Path
from types import SimpleNamespace

from instrument.controller import Controller
from instrument.harmony import QUALITY_PAIRS, Chord
from instrument.models import Frame, Hand
from instrument.replay import read_replay
from instrument.tracking import GestureState, observations


def raw_hand(label: str, score: float = 0.99) -> Hand:
    return Hand("L", (100, 240), label, score, 0.5, ((100, 240),) * 21)


class FistTests(unittest.TestCase):
    def test_complete_chord_map_with_alternating_confirmation_flicker_and_replay(self) -> None:
        controller = Controller(initial=Chord(7, "major"))
        detectors = {side: GestureState() for side in ("L", "R")}
        frames, outputs = [], []
        selections = list(QUALITY_PAIRS.items())
        for index in range(len(selections) * 60):
            t = index * 0.04
            (left, right), quality = selections[index // 60]
            side = ("L", "R")[index % 2]
            label = left if side == "L" else right
            if index % 60 > 30 and index % 9 == 0:
                label = "None"
            detectors[side].update(replace(raw_hand(label), side=side), t)
            hands = tuple(
                replace(detector.hand or Hand(s, (100, 240)), wrist=(160 + i * 320, 240))
                for i, (s, detector) in enumerate(detectors.items())
            )
            frame = Frame(t, hands, (320, 240), 100)
            frames.append(frame)
            outputs.append(controller.update(frame))
            if index % 60 == 59:
                self.assertEqual((outputs[-1].root, outputs[-1].quality), (7, quality))
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "frames.jsonl"
            path.write_text("".join(json.dumps(asdict(f)) + "\n" for f in frames), encoding="utf-8")
            restored = list(read_replay(path))
        replay = Controller(initial=Chord(7, "major"))
        self.assertEqual([replay.update(frame) for frame in restored], outputs)

    def test_joint_shape_does_not_override_canned_none(self) -> None:
        result = SimpleNamespace(
            hand_landmarks=[[SimpleNamespace(x=0.5, y=0.5) for _ in range(21)]],
            handedness=[[]],
            gestures=[[SimpleNamespace(category_name="None", score=0.99)]],
        )
        hand = observations(result, 640, 480, side="L")[0]
        state = GestureState()
        for t in (0, 0.2, 0.4):
            state.update(hand, t)
        self.assertEqual(state.hand.gesture, "None")

    def test_alternating_raw_labels_keep_confirmed_fist(self) -> None:
        state = GestureState()
        state.update(raw_hand("Closed_Fist"), 0)
        state.update(raw_hand("Closed_Fist"), 0.36)
        for index in range(1, 20):
            label = "None" if index % 2 else "Closed_Fist"
            state.update(raw_hand(label), 0.36 + index * 0.04)
            self.assertEqual(state.hand.gesture, "Closed_Fist")
            self.assertEqual(state.hand.raw_gesture, label)
        state.update(raw_hand("None"), 1.2)
        state.update(raw_hand("None"), 1.56)
        self.assertEqual(state.hand.gesture, "None")

    def test_low_confidence_fists_never_confirm(self) -> None:
        state = GestureState()
        for t in (0, 0.4, 0.8):
            state.update(raw_hand("Closed_Fist", 0.49), t)
            self.assertEqual(state.hand.gesture, "None")
            self.assertEqual(state.hand.raw_gesture, "None")

    def test_short_dropout_keeps_hand_then_expires(self) -> None:
        state = GestureState()
        state.update(raw_hand("Closed_Fist"), 0)
        state.update(raw_hand("Closed_Fist"), 0.36)
        state.update(None, 0.7)
        self.assertTrue(state.seen)
        self.assertEqual(state.hand.gesture, "Closed_Fist")
        state.update(None, 0.77)
        self.assertFalse(state.seen)
        self.assertIsNone(state.hand)

    def test_confirmed_fist_locks_once_despite_raw_flicker_and_replays(self) -> None:
        detector = GestureState()
        frames, outputs = [], []
        controller = Controller(initial=Chord(7, "minor"))
        for index in range(76):
            t = index * 0.04
            label = "Open_Palm" if t < 0.8 else "Closed_Fist"
            if 1.24 <= t < 2.4 and index % 2:
                label = "None"
            detector.update(raw_hand(label), t)
            hand = detector.hand
            self.assertIsNotNone(hand)
            frame = Frame(t, (hand, Hand("R", (500, 240))), (320, 240), 100)
            frames.append(frame)
            outputs.append(controller.update(frame))
        self.assertEqual(sum("lock" in s.events for s in outputs), 1)
        self.assertTrue(outputs[-1].locked)
        self.assertEqual(outputs[-1].quality, "minor")
        # Website confirmation plus arbitration, without a second closure dwell.
        lock_time = next(s.time_s for s in outputs if "lock" in s.events)
        self.assertLessEqual(lock_time - 0.8, 0.68)
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "frames.jsonl"
            path.write_text("".join(json.dumps(asdict(f)) + "\n" for f in frames), encoding="utf-8")
            restored = list(read_replay(path))
        self.assertEqual(restored, frames)
        replay_controller = Controller(initial=Chord(7, "minor"))
        self.assertEqual([replay_controller.update(f) for f in restored], outputs)

    def test_nearby_confirmed_fists_split_and_separated_fists_lock(self) -> None:
        for gap, split in ((40, True), (400, False)):
            with self.subTest(gap=gap):
                controller, detectors = Controller(), [GestureState(), GestureState()]
                events = []
                for index in range(50):
                    t = index * 0.04
                    label = "Open_Palm" if t < 0.8 else "Closed_Fist"
                    hands = []
                    for side, detector, x in zip(
                        ("L", "R"), detectors, (100, 100 + gap), strict=True
                    ):
                        detector.update(replace(raw_hand(label), side=side, wrist=(x, 240)), t)
                        hands.append(detector.hand)
                    output = controller.update(Frame(t, tuple(hands), (320, 240), 100))
                    events.extend(output.events)
                self.assertEqual(output.split, split)
                self.assertEqual(output.locked, not split)
                self.assertEqual(events.count("split" if split else "lock"), 1)

    def test_reopening_and_a_second_confirmed_closure_unlocks(self) -> None:
        detector, controller = GestureState(), Controller()
        events = []
        for index in range(90):
            t = index * 0.04
            label = "Closed_Fist" if 0.8 <= t < 1.6 or t >= 2.4 else "Open_Palm"
            detector.update(raw_hand(label), t)
            output = controller.update(
                Frame(t, (detector.hand, Hand("R", (500, 240))), (320, 240), 100)
            )
            events.extend(output.events)
        self.assertEqual(
            [event for event in events if event in {"lock", "unlock"}], ["lock", "unlock"]
        )
        self.assertFalse(output.locked)

    def test_alternating_confirmed_fists_split_after_approaching(self) -> None:
        controller = Controller()
        detectors = {side: GestureState() for side in ("L", "R")}
        events = []
        for index in range(90):
            t = index * 0.04
            label = "Closed_Fist" if 0.8 <= t < 2.8 else "Open_Palm"
            # Match the camera: only one hand receives a new model result per frame.
            side = ("L", "R")[index % 2]
            detectors[side].update(replace(raw_hand(label), side=side), t)
            gap = 40 if 2 <= t < 2.8 else 400
            hands = tuple(
                replace(detector.hand or Hand(s, (100, 240)), wrist=(100 + i * gap, 240))
                for i, (s, detector) in enumerate(detectors.items())
            )
            output = controller.update(Frame(t, hands, (320, 240), 100))
            events.extend(output.events)
            if 1.6 <= t < 2:
                self.assertTrue(output.locked)
                self.assertFalse(output.split)
            if t >= 2:
                self.assertTrue(output.split)
                self.assertTrue(output.locked)
                self.assertEqual(len(output.balls), 2)
        self.assertEqual(events.count("lock"), 1)
        self.assertEqual(events.count("split"), 1)
        self.assertEqual(events.count("unlock"), 0)

    def test_confirmed_pair_toggles_split_merge_despite_flicker_and_replays(self) -> None:
        controller = Controller()
        detectors = {side: GestureState() for side in ("L", "R")}
        frames, outputs = [], []
        for index in range(135):
            t = index * 0.04
            phase = t % 1.8
            label = "Open_Palm" if phase < 0.8 else "Closed_Fist"
            if phase >= 1.3 and index % 4 == 0:
                label = "None"
            side = ("L", "R")[index % 2]
            detectors[side].update(replace(raw_hand(label), side=side), t)
            hands = tuple(
                replace(detector.hand or Hand(s, (100, 240)), wrist=(100 + i * 40, 240))
                for i, (s, detector) in enumerate(detectors.items())
            )
            frame = Frame(t, hands, (320, 240), 100)
            frames.append(frame)
            outputs.append(controller.update(frame))
        events = [event for state in outputs for event in state.events if event != "chord"]
        self.assertEqual(events, ["split", "merge", "split"])
        self.assertTrue(outputs[-1].split)
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "frames.jsonl"
            path.write_text("".join(json.dumps(asdict(f)) + "\n" for f in frames), encoding="utf-8")
            restored = list(read_replay(path))
        replay_controller = Controller()
        self.assertEqual([replay_controller.update(f) for f in restored], outputs)

    @unittest.skipUnless(shutil.which("node"), "Node is optional for direct JavaScript parity")
    def test_filter_matches_actual_website_hand_update(self) -> None:
        source = (Path(__file__).parents[1] / "web/live/hands.js").read_text(encoding="utf-8")
        # Execute the actual Hand class and thresholds, without DOM/model loads.
        thresholds = source[source.index("export const HS =") : source.index("const d2 =")]
        methods = source[source.index("const d2 =") : source.index("export class Hands")]
        cases = []
        for index in range(150):
            label = "Open_Palm" if index < 20 else "Closed_Fist"
            if 32 <= index < 65 and index % 2:
                label = "None"
            if 65 <= index < 80:
                label = None
            if 80 <= index < 100:
                label = "Victory"
            score = 0.49 if 100 <= index < 120 else 0.99
            cases.append({"t": index * 0.04, "label": label, "score": score})
        script = (
            thresholds.replace("export ", "")
            + methods.replace("export ", "")
            + """
const h = new Hand();
const results = JSON.parse(process.argv[1]).map(c => {
  h.update(c.label === null ? null : { lm: Array(21).fill({x: 100, y: 240}),
    gesture: c.label, score: c.score }, c.t);
  return [h.seen, h.gesture, h.score, h.candG, h.candGSince];
});
console.log(JSON.stringify(results));
"""
        )
        expected = json.loads(
            subprocess.run(
                ["node", "-e", script, json.dumps(cases)],
                check=True,
                capture_output=True,
                text=True,
            ).stdout
        )
        state = GestureState()
        for case, reference in zip(cases, expected, strict=True):
            hand = None if case["label"] is None else raw_hand(case["label"], case["score"])
            state.update(hand, case["t"])
            self.assertEqual(
                [state.seen, state.gesture, state.score, state.candidate, state.candidate_since],
                reference,
            )
