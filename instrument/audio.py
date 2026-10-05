"""Simple local chord synth; optional hardware playback is an explicit boundary."""

import math
import time
from typing import Any

import numpy as np
from numpy.typing import NDArray


class Synth:
    """Four persistent oscillator slots, causal 60ms pitch and 30ms gain smoothing."""

    def __init__(self, sample_rate: int = 48000) -> None:
        if not isinstance(sample_rate, int) or sample_rate < 8000:
            raise ValueError("Sample rate must be an integer >= 8000 Hz")
        self.sample_rate = sample_rate
        self.phases = np.zeros(4)
        self.frequencies = np.full(4, 261.625565)
        self.amplitudes = np.zeros(4)

    def render(self, samples: int, notes: tuple[int, ...], gain: float) -> NDArray[np.float32]:
        """Return mono float32 samples in [-0.25,0.25]; no device needed.

        Missing tracking supplies gain=0; release takes 30ms to avoid a click.
        Notes are MIDI integers; an empty tuple releases all oscillator slots.
        """
        if not isinstance(samples, int) or samples < 0:
            raise ValueError("Sample count must be a nonnegative integer")
        if len(notes) > 4 or any(not isinstance(n, int) or not 0 <= n <= 127 for n in notes):
            raise ValueError("Use up to four valid integer MIDI notes")
        if not math.isfinite(gain) or not 0 <= gain <= 1:
            raise ValueError("Gain must be finite in [0,1]")
        if samples == 0:
            return np.empty(0, dtype=np.float32)
        target_frequency = self.frequencies.copy()
        target_amplitude = np.zeros(4)
        for index, note in enumerate(notes):
            target_frequency[index] = 440 * 2 ** ((note - 69) / 12)
            target_amplitude[index] = 0.18 * gain / len(notes)
        steps = np.arange(1, samples + 1, dtype=np.float64)[:, None] / self.sample_rate
        frequencies = target_frequency + (self.frequencies - target_frequency) * np.exp(
            -steps / 0.060
        )
        amplitudes = target_amplitude + (self.amplitudes - target_amplitude) * np.exp(
            -steps / 0.030
        )
        phases = self.phases + np.cumsum(math.tau * frequencies / self.sample_rate, axis=0)
        tone = (np.sin(phases) + 0.2 * np.sin(2 * phases)) / 1.2
        sound = np.sum(amplitudes * tone, axis=1)
        self.phases = phases[-1] % math.tau
        self.frequencies = frequencies[-1]
        self.amplitudes = amplitudes[-1]
        return sound.astype(np.float32)


class Playback:
    """Optional sounddevice stream. Call close in finally; failures are surfaced."""

    def __init__(self, device: str | int | None = None) -> None:
        import sounddevice as sd

        self.synth = Synth()
        self.latest: tuple[tuple[int, ...], float] = ((), 0.0)
        self.error: str | None = None
        self.stream = sd.OutputStream(
            samplerate=48000,
            channels=1,
            dtype="float32",
            blocksize=512,
            device=device,
            callback=self._callback,
        )
        try:
            self.stream.start()
        except Exception:
            self.stream.close()
            raise

    def _callback(self, outdata: Any, frames: int, timing: Any, status: Any) -> None:
        del timing
        if status:
            self.error = str(status)
        notes, gain = self.latest  # One atomic snapshot for the audio callback.
        outdata[:, 0] = self.synth.render(frames, notes, gain)

    def update(self, notes: tuple[int, ...], gain: float) -> None:
        if self.error:
            raise RuntimeError(f"Audio stream reported {self.error}; use --mute or another device")
        self.latest = notes, gain

    def close(self) -> None:
        self.latest = (), 0.0
        try:
            time.sleep(0.12)
            self.stream.stop()
        finally:
            self.stream.close()
