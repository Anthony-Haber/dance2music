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
        self.assertLessEqual(float(np.max(np.abs(sound))), 0.7)
        tail = synth.render(24000, (), 0)
        self.assertLess(float(np.max(np.abs(tail[-4800:]))), 1e-6)

    def test_chunk_continuity_and_note_transition(self) -> None:
        a, b = Synth(), Synth()
        whole = a.render(4096, (48, 52, 55), 0.7)
        chunks = np.concatenate([b.render(1024, (48, 52, 55), 0.7) for _ in range(4)])
        np.testing.assert_allclose(whole, chunks, atol=2e-6)
        new = b.render(1024, (50, 53, 57, 60), 0.7)
        self.assertLess(abs(float(new[0] - chunks[-1])), 0.03)

    def test_ordinary_hand_spacing_is_audible_and_master_volume_scales_output(self) -> None:
        from instrument.controller import Controller
        from instrument.models import Frame, Hand

        frame = Frame(0, (Hand("L", (250, 240)), Hand("R", (390, 240))), (320, 240), 160)
        state = Controller().update(frame)
        sound = Synth().render(48000, state.notes, state.gain)
        rms = float(np.sqrt(np.mean(sound[4800:] ** 2)))
        # Ordinary 140px wrist spacing / 160px torso: above -32 dBFS, no clipping.
        self.assertGreater(rms, 10 ** (-32 / 20))
        self.assertLess(float(np.max(np.abs(sound))), 0.7)
        quiet = Synth(volume=0.5).render(48000, state.notes, state.gain)
        np.testing.assert_allclose(quiet, sound * 0.5, atol=1e-7)
        np.testing.assert_array_equal(Synth(volume=0).render(1024, state.notes, 1), np.zeros(1024))
        for volume in (-1, 1.1, float("nan")):
            with self.subTest(volume=volume), self.assertRaises(ValueError):
                Synth(volume=volume)

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
