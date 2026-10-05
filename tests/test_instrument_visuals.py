"""Ball geometry, deterministic drawing, and loss behavior."""

import math
import unittest

import numpy as np

from instrument.controller import Controller
from instrument.models import Config, Frame
from instrument.visuals import Renderer
from tests.test_instrument_controller import sample


class VisualTests(unittest.TestCase):
    def test_dead_zone_guide_matches_configured_controller_boundary(self) -> None:
        config = Config(dead_zone_torsos=0.5)
        frame = Frame(0, torso_center=(320, 240), torso_px=100)
        state = Controller(config).update(frame)
        source = np.zeros((480, 640, 3), dtype=np.uint8)
        image = Renderer(config=config).draw(source, frame, state)
        self.assertTrue(np.any(image[240, 370]))
        self.assertFalse(np.any(image[240, 345]))

    def test_midpoint_radius_and_split_area_gain(self) -> None:
        controller = Controller()
        merged = controller.update(sample(0))
        self.assertEqual(len(merged.balls), 1)
        self.assertAlmostEqual(merged.balls[0].radius, 90)
        center = tuple(sum(h.wrist[i] for h in sample(0).hands) / 2 for i in (0, 1))
        self.assertEqual(merged.balls[0].center, center)
        controller.split = True
        split = controller.update(sample(0.01))
        self.assertEqual(
            tuple(b.center for b in split.balls), tuple(h.wrist for h in sample(0).hands)
        )
        self.assertAlmostEqual(sum(b.radius**2 for b in split.balls), merged.balls[0].radius ** 2)
        self.assertAlmostEqual(merged.gain, split.gain)
        single = Frame(0.02, (sample(0).hands[0],), (320, 240), 100)
        output = controller.update(single)
        self.assertEqual(len(output.balls), 1)
        self.assertEqual(output.gain, 0)
        output = controller.update(Frame(0.03))
        self.assertEqual(output.balls, ())
        self.assertTrue(output.split)

    def test_render_is_finite_deterministic_bounded_and_copies_input(self) -> None:
        first, second = Renderer(seed=4), Renderer(seed=4)
        controller = Controller()
        source = np.zeros((480, 640, 3), dtype=np.uint8)
        for index in range(40):
            frame = sample(index * 0.03)
            output = controller.update(frame)
            a = first.draw(source, frame, output)
            b = second.draw(source, frame, output)
            np.testing.assert_array_equal(a, b)
            self.assertEqual(a.shape, source.shape)
            self.assertEqual(a.dtype, np.uint8)
            self.assertLessEqual(len(first.particles), 300)
        self.assertEqual(int(source.sum()), 0)
        self.assertGreater(int(a.sum()), 0)
        self.assertTrue(math.isfinite(float(a.max())))

    def test_absent_or_offscreen_balls_and_light_style(self) -> None:
        renderer = Renderer(style="light")
        source = np.zeros((480, 640, 3), dtype=np.uint8)
        controller = Controller()
        missing = Frame(0)
        image = renderer.draw(source, missing, controller.update(missing))
        self.assertEqual(image.shape, source.shape)
        with self.assertRaises(ValueError):
            Renderer(style="invalid")
