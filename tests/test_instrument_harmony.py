"""Musical intervals, root ring and complete catalogue reachability."""

import math
import random
import unittest
from itertools import permutations

from instrument.harmony import (
    CHORD_SIGNS,
    INTERVALS,
    QUALITY_PAIRS,
    Chord,
    gesture_quality,
    root_region,
    voice_lead,
)
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
            "half_diminished7": (0, 3, 6, 10),
            "diminished7": (0, 3, 6, 9),
            "major6": (0, 4, 7, 9),
            "minor6": (0, 3, 7, 9),
            "major69": (0, 4, 7, 9, 14),
            "minor69": (0, 3, 7, 9, 14),
            "major9": (0, 4, 7, 11, 14),
            "minor9": (0, 3, 7, 10, 14),
            "dominant9": (0, 4, 7, 10, 14),
            "major13": (0, 4, 7, 11, 14, 21),
            "minor13": (0, 3, 7, 10, 14, 21),
            "dominant13": (0, 4, 7, 10, 14, 21),
            "minor11": (0, 3, 7, 10, 14, 17),
            "sus4": (0, 5, 7),
            "dominant7sus4": (0, 5, 7, 10),
            "augmented": (0, 4, 8),
            "dominant7b9": (0, 4, 7, 10, 13),
            "dominant7sharp9": (0, 4, 7, 10, 15),
            "major7sharp11": (0, 4, 7, 11, 18),
        }
        self.assertEqual(INTERVALS, expected)
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
        self.assertEqual(len(symbols), 300)
        self.assertEqual(Chord(7, "minor_major7").symbol, "Gm(maj7)")
        self.assertEqual(Chord(0, "half_diminished7").symbol, "Cm7b5")
        self.assertEqual(Chord(0, "diminished7").symbol, "Cdim7")

    def test_complete_ordered_map_matches_approved_table(self) -> None:
        expected = (
            ("C", "Cm6", "Cm7b5", "C6", "C6/9"),
            ("Cm", "Cm11", "Cm9", "Cm13", "Cm6/9"),
            ("Cdim7", "C7b9", "Caug", "C7#9", "C7sus4"),
            ("Cmaj7", "Cmaj9", "Cmaj7#11", "Cmaj13", "Cm(maj7)"),
            ("Cm7", "C9", "Csus4", "C7", "C13"),
        )
        symbols = set()
        for right, row in zip(CHORD_SIGNS, expected, strict=True):
            for left, symbol in zip(CHORD_SIGNS, row, strict=True):
                quality = gesture_quality(left, right)
                self.assertIsNotNone(quality)
                self.assertEqual(Chord(0, quality).symbol, symbol)
                symbols.add(symbol)
        self.assertEqual(len(symbols), 25)
        for unsupported in (None, "None", "Closed_Fist", "ILoveYou"):
            for sign in CHORD_SIGNS:
                self.assertIsNone(gesture_quality(unsupported, sign))
                self.assertIsNone(gesture_quality(sign, unsupported))

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

        targets = []
        for root in range(12):
            for (left, right), quality in QUALITY_PAIRS.items():
                frames = tuple(
                    sample(index * 0.18, root=root, left=left, right=right)
                    for index in range(10 if quality == "major" else 3)
                )
                targets.append((root, quality, frames))
        for start_root in range(12):
            for start_quality in INTERVALS:
                for target_root, target_quality, frames in targets:
                    controller = Controller(initial=Chord(start_root, start_quality))
                    for frame in frames:
                        output = controller.update(frame)
                    self.assertEqual((output.root, output.quality), (target_root, target_quality))

    def test_optimized_voice_leading_matches_exhaustive_musical_cost(self) -> None:
        rng = random.Random(19)
        for count in (3, 4, 5, 6):
            qualities = [q for q, intervals in INTERVALS.items() if len(intervals) == count]
            for _ in range(24):
                previous = tuple(rng.sample(range(48, 84), count))
                chord = Chord(rng.randrange(12), rng.choice(qualities))
                choices = []
                for order in permutations(chord.pitch_classes):
                    notes = tuple(
                        min(
                            (n for n in range(48, 84) if n % 12 == pc),
                            key=lambda n: (abs(n - old), n),
                        )
                        for old, pc in zip(previous, order, strict=True)
                    )
                    moves = tuple(abs(a - b) for a, b in zip(previous, notes, strict=True))
                    choices.append((sum(moves), max(moves), notes))
                self.assertEqual(voice_lead(previous, chord), min(choices)[2])

    def test_voice_leading_preserves_notes_across_voice_count_changes(self) -> None:
        previous = ()
        for root in range(12):
            for quality in INTERVALS:
                chord = Chord(root, quality)
                previous = voice_lead(previous, chord)
                self.assertEqual({n % 12 for n in previous}, set(chord.pitch_classes))
                self.assertEqual(len(previous), len(chord.pitch_classes))
                self.assertTrue(all(48 <= n <= 83 for n in previous))
        for arguments in ((12, "major"), (0, "unsupported")):
            with self.assertRaises(ValueError):
                Chord(*arguments)
