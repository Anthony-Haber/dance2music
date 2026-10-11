"""Ball geometry, deterministic drawing, and loss behavior."""

import math
import unittest
from unittest.mock import patch

import cv2
import numpy as np

from instrument.controller import Controller
from instrument.models import Config, Frame
from instrument.visuals import HUD_HEIGHT, Renderer
from tests.test_instrument_controller import sample
from tests.test_instrument_tracking import body_result


class VisualTests(unittest.TestCase):
    def test_full_body_overlay_includes_legs_with_no_hand_details(self) -> None:
        from instrument.tracking import body_hands, pose_observations, torso_geometry

        result = body_result()
        pose = pose_observations(result, 640, 480)
        center, length = torso_geometry(result, 640, 480)
        frame = Frame(0, body_hands(pose, ()), center, length, pose_landmarks=pose)
        source = np.zeros((480, 640, 3), dtype=np.uint8)
        image = Renderer().draw(source, frame, Controller().update(frame))
        self.assertGreater(int(image[HUD_HEIGHT + 450 : HUD_HEIGHT + 460, 250:260].sum()), 0)
        self.assertEqual(int(source.sum()), 0)

    def test_fist_confirmation_displays_locked_and_reopening_keeps_label(self) -> None:
        controller = Controller()
        renderer = Renderer()
        source = np.zeros((480, 640, 3), dtype=np.uint8)
        for index in range(101):
            t = index * 0.02
            frame = sample(t, left="Closed_Fist" if 0.3 <= t < 1.4 else "Open_Palm")
            state = controller.update(frame)
            if index in (35, 55, 95):
                with patch("instrument.visuals.cv2.putText", wraps=cv2.putText) as write:
                    renderer.draw(source, frame, state)
                text = " ".join(call.args[1] for call in write.call_args_list)
                if index == 35:
                    self.assertIn("ROOT LOCKING...", text)
                else:
                    self.assertTrue(state.locked)
                    self.assertIn("ROOT LOCKED", text)

    def test_dead_zone_guide_matches_configured_controller_boundary(self) -> None:
        config = Config(dead_zone_torsos=0.5)
        frame = Frame(0, torso_center=(320, 240), torso_px=100)
        state = Controller(config).update(frame)
        source = np.zeros((480, 640, 3), dtype=np.uint8)
        image = Renderer(config=config).draw(source, frame, state)
        self.assertTrue(np.any(image[HUD_HEIGHT + 240, 370]))
        self.assertFalse(np.any(image[HUD_HEIGHT + 240, 345]))

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
            self.assertEqual(a.shape, (source.shape[0] + HUD_HEIGHT, source.shape[1], 3))
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
        self.assertEqual(image.shape, (source.shape[0] + HUD_HEIGHT, source.shape[1], 3))
        with self.assertRaises(ValueError):
            Renderer(style="invalid")

    def test_controls_preserve_every_pixel_of_unoccluded_camera_frame(self) -> None:
        # Distinct content at every edge catches cropping, hidden rows and aspect changes.
        source = np.random.default_rng(8).integers(0, 256, (480, 640, 3), dtype=np.uint8)
        frame = Frame(0)
        image = Renderer().draw(source, frame, Controller().update(frame))
        np.testing.assert_array_equal(image[HUD_HEIGHT:], source)
        self.assertEqual(image.shape[1], source.shape[1])
