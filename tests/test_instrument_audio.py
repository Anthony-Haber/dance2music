"""Synthesis without an audio device or sounddevice import."""

import unittest

import numpy as np

from instrument.audio import Synth


class AudioTests(unittest.TestCase):
    def test_silence_and_finite_bounded_chord(self) -> None:
        synth = Synth()
        silence = synth.render(2048, (), 0)
        np.testing.assert_array_equal(silence, np.zeros(2048, dtype=np.float32))
        sound = synth.render(48000, (48, 52, 55, 59), 1)
        self.assertEqual(sound.dtype, np.float32)
        self.assertTrue(np.isfinite(sound).all())
        self.assertGreater(float(np.std(sound)), 0.01)
        self.assertLessEqual(float(np.max(np.abs(sound))), 0.25)
        tail = synth.render(24000, (), 0)
        self.assertLess(float(np.max(np.abs(tail[-4800:]))), 1e-6)

    def test_chunk_continuity_and_note_transition(self) -> None:
        a, b = Synth(), Synth()
        whole = a.render(4096, (48, 52, 55), 0.7)
        chunks = np.concatenate([b.render(1024, (48, 52, 55), 0.7) for _ in range(4)])
        np.testing.assert_allclose(whole, chunks, atol=2e-6)
        new = b.render(1024, (50, 53, 57, 60), 0.7)
        self.assertLess(abs(float(new[0] - chunks[-1])), 0.03)

    def test_invalid_inputs_fail(self) -> None:
        for sample_rate in (0, 7999, 48000.5, float("nan"), float("inf")):
            with self.subTest(sample_rate=sample_rate), self.assertRaises(ValueError):
                Synth(sample_rate)
        synth = Synth()
        for samples, notes, gain in (
            (-1, (), 0),
            (100, (128,), 1),
            (100, (60,), float("nan")),
            (100, (60,), -1),
        ):
            with self.assertRaises(ValueError):
                synth.render(samples, notes, gain)
