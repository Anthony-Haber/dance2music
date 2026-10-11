"""Native Python instrument: camera/video, deterministic demo and JSONL replay."""

import argparse
import json
import math
import sys
import time
import wave
from collections.abc import Iterator
from contextlib import ExitStack
from dataclasses import asdict
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from numpy.typing import NDArray

from instrument.audio import Playback, Synth
from instrument.controller import Controller
from instrument.models import Config, Frame, Output
from instrument.replay import demonstration, read_replay
from instrument.tracking import Tracker
from instrument.visuals import Renderer

WINDOW_TITLE = "dance2music - Anthony's Python instrument"


class Exports:
    """Incremental diagnostic exports; no unbounded audio/video buffers."""

    def __init__(self, directory: Path, fps: int, stack: ExitStack, volume: float = 1.0) -> None:
        directory.mkdir(parents=True, exist_ok=True)
        self.directory, self.fps = directory, fps
        self.frames = stack.enter_context((directory / "frames.jsonl").open("w", encoding="utf-8"))
        self.states = stack.enter_context((directory / "states.jsonl").open("w", encoding="utf-8"))
        self.audio = wave.open(str(directory / "chords.wav"), "wb")
        stack.callback(self.audio.close)
        self.audio.setnchannels(1)
        self.audio.setsampwidth(2)
        self.audio.setframerate(48000)
        self.synth = Synth(volume=volume)
        self.writer: Any = None
        self.stack = stack
        self.saved: set[str] = set()
        self.audio_samples = 0
        self.first_time: float | None = None
        self.last_state: Output | None = None
        stack.callback(self.finish_audio)

    def _write_audio_until(self, target_samples: int, state: Output) -> None:
        """Apply an observation only from its timestamp onward, in bounded chunks."""
        while self.audio_samples < target_samples:
            count = min(48000, target_samples - self.audio_samples)
            audio = self.synth.render(count, state.notes, state.gain)
            self.audio.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes())
            self.audio_samples += count

    def finish_audio(self) -> None:
        """Give the final observation one nominal frame interval before closing."""
        if self.first_time is not None and self.last_state is not None:
            target = round((self.last_state.time_s - self.first_time + 1 / self.fps) * 48000)
            self._write_audio_until(target, self.last_state)

    def write(self, frame: Frame, state: Output, image: NDArray[np.uint8]) -> None:
        self.frames.write(json.dumps(asdict(frame)) + "\n")
        self.states.write(json.dumps(asdict(state)) + "\n")
        if self.writer is None:
            self.writer = cv2.VideoWriter(
                str(self.directory / "preview.avi"),
                cv2.VideoWriter.fourcc(*"MJPG"),
                self.fps,
                (image.shape[1], image.shape[0]),
            )
            self.stack.callback(self.writer.release)
            if not self.writer.isOpened():
                raise RuntimeError(
                    "Cannot open preview.avi writer; check output path and MJPG codec"
                )
        self.writer.write(image)
        if self.first_time is None:
            self.first_time = frame.time_s
        if self.last_state is not None:
            target_samples = round((frame.time_s - self.first_time) * 48000)
            self._write_audio_until(target_samples, self.last_state)
        self.last_state = state
        labels = ["first"]
        if state.locked:
            labels.append("locked")
        if state.split:
            labels.append("split")
        if state.quality == "minor":
            labels.append("minor")
        for label in labels:
            if label not in self.saved:
                if not cv2.imwrite(str(self.directory / f"{label}.png"), image):
                    raise RuntimeError(f"Cannot save {label}.png")
                self.saved.add(label)
        if not cv2.imwrite(str(self.directory / "final.png"), image):
            raise RuntimeError("Cannot save final.png")


def camera_frames(
    capture: Any, tracker: Tracker, video: bool, fps: int
) -> Iterator[tuple[Frame, NDArray[np.uint8], float]]:
    start = time.perf_counter()
    previous = -1.0
    index = 0
    source_fps = float(capture.get(cv2.CAP_PROP_FPS)) if video else fps
    if not math.isfinite(source_fps) or source_fps <= 0:
        source_fps = fps
    while True:
        success, image = capture.read()
        if not success:
            if video:
                return
            raise RuntimeError(
                "Camera stopped providing frames; check camera connection/permissions"
            )
        image = cv2.flip(image, 1)
        timestamp = (
            index / source_fps if video else max(time.perf_counter() - start, previous + 0.002)
        )
        previous, index = timestamp, index + 1
        before = time.perf_counter()
        frame = tracker.detect(image, timestamp)
        yield frame, image, (time.perf_counter() - before) * 1000


def scripted_frames(frames: Iterator[Frame]) -> Iterator[tuple[Frame, NDArray[np.uint8], float]]:
    background = np.zeros((720, 960, 3), dtype=np.uint8)
    background[:] = (30, 24, 24)
    for frame in frames:
        yield frame, background, 0.0


def run(args: argparse.Namespace) -> dict[str, Any]:
    if not math.isfinite(args.seconds) or args.seconds < 0 or not 1 <= args.fps <= 120:
        raise ValueError("seconds must be finite nonnegative and fps in [1,120]")
    if not math.isfinite(args.volume) or not 0 <= args.volume <= 1:
        raise ValueError("volume must be finite in [0,1]")
    if args.camera_width <= 0 or args.camera_height <= 0:
        raise ValueError("camera dimensions must be positive pixels")
    config = (
        Config(**json.loads(args.config.read_text(encoding="utf-8"))) if args.config else Config()
    )
    controller, renderer = Controller(config), Renderer(args.style, config=config)
    core_times, render_times, inference_times = [], [], []
    final: Output | None = None
    with ExitStack() as stack:
        playback = None
        if not args.mute and not args.headless and not args.model_smoke:
            try:
                playback = Playback(args.audio_device, volume=args.volume)
            except Exception as error:
                raise RuntimeError(f"Cannot start audio: {error}. Retry with --mute.") from error
            stack.callback(playback.close)
        if args.model_smoke:
            tracker = Tracker(args.models)
            stack.callback(tracker.close)
            image = np.zeros((480, 640, 3), dtype=np.uint8)
            start = time.perf_counter()
            first = tracker.detect(image, 0)
            second = tracker.detect(image, 0.1)
            return {
                "model_smoke": "passed",
                "blank_frame_hands": len(first.hands) + len(second.hands),
                "two_frame_ms": (time.perf_counter() - start) * 1000,
            }
        if args.demo:
            source = scripted_frames(demonstration(args.fps))
        elif args.replay:
            source = scripted_frames(read_replay(args.replay))
        else:
            tracker = Tracker(args.models)
            stack.callback(tracker.close)
            # DirectShow negotiates widescreen webcam modes more reliably than
            # Windows' default Media Foundation backend, especially on USB cameras.
            backend = cv2.CAP_DSHOW if sys.platform == "win32" and not args.video else cv2.CAP_ANY
            capture = cv2.VideoCapture(str(args.video) if args.video else args.camera, backend)
            stack.callback(capture.release)
            if not capture.isOpened():
                raise RuntimeError(
                    "Cannot open camera/video; check index, path and OS camera permissions"
                )
            if not args.video:
                capture.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter.fourcc(*"MJPG"))
                capture.set(cv2.CAP_PROP_FRAME_WIDTH, args.camera_width)
                capture.set(cv2.CAP_PROP_FRAME_HEIGHT, args.camera_height)
            source = camera_frames(capture, tracker, args.video is not None, args.fps)
        exporter = (
            Exports(args.output, args.fps, stack, volume=args.volume) if args.output else None
        )
        if not args.headless:
            stack.callback(cv2.destroyAllWindows)
            cv2.namedWindow(WINDOW_TITLE, cv2.WINDOW_NORMAL | cv2.WINDOW_KEEPRATIO)
            cv2.resizeWindow(WINDOW_TITLE, 960, 720)
        wall_start = time.perf_counter()
        first_timestamp = None
        for frame, image, inference_ms in source:
            if first_timestamp is None:
                first_timestamp = frame.time_s
            elapsed = frame.time_s - first_timestamp
            if args.seconds and elapsed >= args.seconds:
                break
            # Playback uses source time; headless validation runs as fast as possible.
            if not args.headless:
                delay = elapsed - (time.perf_counter() - wall_start)
                if delay > 0:
                    time.sleep(delay)
            before = time.perf_counter()
            final = controller.update(frame)
            core_times.append((time.perf_counter() - before) * 1000)
            before = time.perf_counter()
            rendered = renderer.draw(image, frame, final, inference_ms + core_times[-1])
            render_times.append((time.perf_counter() - before) * 1000)
            inference_times.append(inference_ms)
            if playback:
                playback.update(final.notes, final.gain)
            if exporter:
                exporter.write(frame, final, rendered)
            if not args.headless:
                cv2.imshow(WINDOW_TITLE, rendered)
                key = cv2.waitKey(1) & 0xFF
                if key in (ord("q"), 27):
                    break
                if key == ord("m"):
                    controller.merge()
                elif key == ord("r"):
                    controller.reset()
                elif key == ord("s"):
                    renderer.style = "light" if renderer.style == "fire" else "fire"
                if cv2.getWindowProperty(WINDOW_TITLE, cv2.WND_PROP_VISIBLE) < 1:
                    break
        if final is None:
            raise ValueError("No input frames were processed")
    metrics = {
        "frames": len(core_times),
        "final_chord": final.symbol,
        "locked": final.locked,
        "split": final.split,
        "core_p95_ms": float(np.percentile(core_times, 95)),
        "render_p95_ms": float(np.percentile(render_times, 95)),
        "inference_p95_ms": float(np.percentile(inference_times, 95)),
        "wall_seconds": time.perf_counter() - wall_start,
        "source_size_px": [image.shape[1], image.shape[0]],
        "preview_size_px": [rendered.shape[1], rendered.shape[0]],
    }
    if args.output:
        (args.output / "summary.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    return metrics


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sources = parser.add_mutually_exclusive_group()
    sources.add_argument(
        "--demo", action="store_true", help="scripted 15-second native interaction"
    )
    sources.add_argument("--replay", type=Path, help="JSONL observations; no CV models needed")
    sources.add_argument("--video", type=Path, help="track a local video instead of camera")
    sources.add_argument(
        "--model-smoke", action="store_true", help="load models and infer two blank frames"
    )
    parser.add_argument("--camera", type=int, default=0)
    parser.add_argument("--camera-width", type=int, default=1280, help="requested capture width")
    parser.add_argument("--camera-height", type=int, default=720, help="requested capture height")
    parser.add_argument("--models", type=Path, default=Path("output/models"))
    parser.add_argument("--config", type=Path, help="JSON object overriding Config defaults")
    parser.add_argument("--style", choices=("fire", "light"), default="fire")
    parser.add_argument("--headless", action="store_true", help="disable window and audio devices")
    parser.add_argument("--mute", action="store_true")
    parser.add_argument("--audio-device", help="sounddevice output name or substring")
    parser.add_argument(
        "--volume", type=float, default=1.0, help="master volume in [0,1] (default 1)"
    )
    parser.add_argument(
        "--seconds", type=float, default=0, help="stop after this source duration; 0=all"
    )
    parser.add_argument("--fps", type=int, default=30, help="demo and diagnostic video fps")
    parser.add_argument(
        "--output", type=Path, help="write local frames/states, preview AVI, WAV and stills"
    )
    args = parser.parse_args()
    try:
        print(json.dumps(run(args), indent=2))
        return 0
    except Exception as error:
        # CLI boundary: all failures are actionable and return a nonzero status.
        print(f"Instrument failed: {error}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
