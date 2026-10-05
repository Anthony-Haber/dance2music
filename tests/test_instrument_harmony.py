"""Musical intervals, root ring and complete catalogue reachability."""

import math
import unittest

from instrument.harmony import QUALITY_GESTURES, Chord, root_region, voice_lead
from instrument.models import Frame, Hand


class HarmonyTests(unittest.TestCase):
    def test_catalogue_intervals_and_symbols(self) -> None:
        expected = {
            "major": (0, 4, 7),
            "minor": (0, 3, 7),
            "dominant7": (0, 4, 7, 10),
            "major7": (0, 4, 7, 11),
            "minor7": (0, 3, 7, 10),
            "minor_major7": (0, 3, 7, 11),
        }
        symbols = set()
        for root in range(12):
            for quality, intervals in expected.items():
                chord = Chord(root, quality)
                self.assertEqual(
                    chord.pitch_classes, tuple((root + interval) % 12 for interval in intervals)
                )
                notes = voice_lead((), chord)
                self.assertEqual({n % 12 for n in notes}, set(chord.pitch_classes))
                self.assertTrue(all(48 <= n <= 83 for n in notes))
                symbols.add(chord.symbol)
        self.assertEqual(len(symbols), 72)
        self.assertEqual(Chord(7, "minor_major7").symbol, "Gm(maj7)")

    def test_root_regions_and_dead_zone(self) -> None:
        for root in range(12):
            x, y = (
                200 + 100 * math.cos(root * math.pi / 6),
                200 + 100 * math.sin(root * math.pi / 6),
            )
            frame = Frame(0, (Hand("L", (x - 30, y)), Hand("R", (x + 30, y))), (200, 200), 100)
            self.assertEqual(root_region(frame, 0.25), root)
        frame = Frame(0, (Hand("L", (180, 200)), Hand("R", (220, 200))), (200, 200), 100)
        self.assertIsNone(root_region(frame, 0.25))
        self.assertIsNone(root_region(Frame(0), 0.25))

    def test_any_chord_can_reach_every_chord(self) -> None:
        from instrument.controller import Controller
        from tests.test_instrument_controller import sample

        for start_root in range(12):
            for start_quality in QUALITY_GESTURES.values():
                for target_root in range(12):
                    for gesture, target_quality in QUALITY_GESTURES.items():
                        controller = Controller(initial=Chord(start_root, start_quality))
                        for index in range(11):
                            output = controller.update(
                                sample(index * 0.05, root=target_root, right=gesture)
                            )
                        self.assertEqual(
                            (output.root, output.quality), (target_root, target_quality)
                        )

    def test_voice_leading_preserves_notes_across_voice_count_changes(self) -> None:
        previous = ()
        for root in range(12):
            for quality in QUALITY_GESTURES.values():
                chord = Chord(root, quality)
                previous = voice_lead(previous, chord)
                self.assertEqual({n % 12 for n in previous}, set(chord.pitch_classes))
                self.assertEqual(len(previous), len(chord.pitch_classes))
                self.assertTrue(all(48 <= n <= 83 for n in previous))
        for arguments in ((12, "major"), (0, "unsupported")):
            with self.assertRaises(ValueError):
                Chord(*arguments)
