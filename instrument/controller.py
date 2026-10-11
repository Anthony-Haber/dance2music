"""Causal instrument state; no camera, drawing, sound or file effects."""

import math
from dataclasses import dataclass

from instrument.harmony import Chord, gesture_quality, root_region, voice_lead
from instrument.models import GESTURES, Ball, Config, Frame, Output


@dataclass
class Dwell:
    candidate: str | int | None = None
    since: float = 0.0

    def read(self, value: str | int | None, now: float, seconds: float) -> str | int | None:
        if value is None or value != self.candidate:
            self.candidate, self.since = value, now
        return value if value is not None and now - self.since + 1e-9 >= seconds else None


@dataclass
class FistGate:
    armed: bool = False
    closed_since: float | None = None
    open_since: float | None = None
    closure_triggered: bool = False

    def read(
        self, gesture: str | None, now: float, config: Config, since: float | None = None
    ) -> bool:
        if gesture is None:
            self.armed, self.closed_since, self.open_since = False, None, None
            self.closure_triggered = False
            return False
        if gesture != "Closed_Fist":
            self.closed_since = None
            self.closure_triggered = False
            if self.open_since is None:
                self.open_since = now
            if now - self.open_since + 1e-9 >= config.reopen_s:
                self.armed = True
            return False
        self.open_since = None
        if self.closed_since is None:
            # Camera labels already underwent the website's 350ms confirmation.
            # Replays/synthetic raw labels retain the controller's normal dwell.
            self.closed_since = min(now, since) if since is not None else now
        if self.armed and now - self.closed_since + 1e-9 >= config.close_s:
            self.armed = False
            # Keep this closure eligible for a ball-mode toggle while held,
            # even after its root-lock arbitration has completed.
            self.closure_triggered = True
            return True
        return False

    def stable_closed(self, now: float, seconds: float) -> bool:
        return self.closed_since is not None and now - self.closed_since + 1e-9 >= seconds


class Controller:
    """Persistent musical state driven by strictly increasing elapsed timestamps."""

    def __init__(self, config: Config | None = None, initial: Chord | None = None) -> None:
        self.config = config if config is not None else Config()
        self.initial = initial if initial is not None else Chord()
        self.reset()

    def reset(self) -> None:
        """Return to initial chord/unlocked/merged; both hands must reopen to arm."""
        self.chord = self.initial
        self.notes = voice_lead((), self.chord)
        self.locked = self.split = False
        self.last_time: float | None = None
        self._clear_transients()

    def _clear_transients(self) -> None:
        self.gates = {"L": FistGate(), "R": FistGate()}
        self.root_dwell, self.quality_dwell, self.major_dwell = Dwell(), Dwell(), Dwell()
        self.pending_since: float | None = None
        self.pending_sides: set[str] = set()
        self.pending_root = self.chord.root
        self.split_requested = False

    def merge(self) -> None:
        """Keyboard merge control, independent of chord and lock."""
        self.split = False
        # A merge while both fists are held must not immediately split again.
        self.split_requested = False
        self.pending_since = None
        for gate in self.gates.values():
            gate.closure_triggered = False

    def update(self, frame: Frame) -> Output:
        now = frame.time_s
        if self.last_time is not None:
            if now <= self.last_time:
                raise ValueError("Controller frame timestamps must strictly increase")
            if now - self.last_time > self.config.max_gap_s + 1e-9:
                self._clear_transients()
        self.last_time = now
        events: list[str] = []
        hands = {h.side: h for h in frame.hands}
        torso_valid = frame.torso_center is not None and frame.torso_px is not None
        gestures = {
            side: (
                hand.gesture
                if torso_valid
                and (hand.confidence >= self.config.confidence_min and hand.gesture in GESTURES)
                else None
            )
            for side, hand in hands.items()
        }
        closures: set[str] = set()
        for side, gate in self.gates.items():
            gesture = gestures.get(side)
            since = hands[side].gesture_since if side in hands else None
            if gate.read(gesture, now, self.config, since):
                closures.add(side)
        if self.pending_since is not None and (
            not torso_valid or any(gestures.get(side) is None for side in self.pending_sides)
        ):
            self.pending_since = None
        nearby_fists = bool(
            frame.torso_px is not None
            and len(hands) == 2
            and all(gestures.get(side) == "Closed_Fist" for side in ("L", "R"))
            and math.dist(hands["L"].wrist, hands["R"].wrist)
            <= self.config.split_torsos * frame.torso_px
        )
        if closures and self.pending_since is None:
            self.pending_since, self.pending_root = now, self.chord.root
            self.pending_sides = set(closures)
            self.root_dwell = Dwell()
        elif closures:
            self.pending_sides.update(closures)
        if nearby_fists:
            if self.pending_since is not None or any(
                gate.closure_triggered for gate in self.gates.values()
            ):
                self.split_requested = True
            self.pending_since = None
            if self.split_requested and all(
                gate.stable_closed(now, self.config.close_s) for gate in self.gates.values()
            ):
                self.split = not self.split
                events.append("split" if self.split else "merge")
                self.split_requested = False
                for gate in self.gates.values():
                    gate.closure_triggered = False
        else:
            self.split_requested = False
            if self.pending_since is not None and (
                now - self.pending_since + 1e-9 >= self.config.arbitration_s
            ):
                self.locked = not self.locked
                if self.locked:
                    self.chord = Chord(self.pending_root, self.chord.quality)
                self.pending_since = None
                self.root_dwell = Dwell()
                events.append("lock" if self.locked else "unlock")
        raw_root = root_region(frame, self.config.dead_zone_torsos)
        root = self.chord.root
        if not self.locked and self.pending_since is None and not self.split_requested:
            selected = self.root_dwell.read(raw_root, now, self.config.root_dwell_s)
            if isinstance(selected, int):
                root = selected
        else:
            self.root_dwell = Dwell()
        quality = self.chord.quality
        raw_quality = gesture_quality(gestures.get("L"), gestures.get("R"))
        # Both palms retain their slower deliberate reset, independent of pair dwell.
        if raw_quality == "major":
            raw_quality = None
        selected_quality = self.quality_dwell.read(raw_quality, now, self.config.quality_dwell_s)
        if isinstance(selected_quality, str):
            quality = selected_quality
        major = self.major_dwell.read(
            "major" if all(gestures.get(side) == "Open_Palm" for side in ("L", "R")) else None,
            now,
            self.config.major_dwell_s,
        )
        if major is not None:
            quality = "major"
        chord = Chord(root, quality)
        if chord != self.chord:
            events.append("chord")
        if chord != self.chord or {n % 12 for n in self.notes} != set(chord.pitch_classes):
            self.notes = voice_lead(self.notes, chord)
        self.chord = chord
        balls, gain = self._geometry(frame)
        return Output(
            now,
            chord.root,
            quality,
            chord.symbol,
            self.notes,
            self.locked,
            self.split,
            balls,
            gain,
            tuple(events),
            raw_root,
            self.pending_since is not None or self.split_requested,
        )

    def _geometry(self, frame: Frame) -> tuple[tuple[Ball, ...], float]:
        if frame.torso_px is None or frame.torso_center is None:
            return (), 0.0
        if len(frame.hands) != 2:
            balls = tuple(Ball(h.wrist, frame.torso_px * 0.12, h.side) for h in frame.hands)
            return (balls if self.split else ()), 0.0
        left, right = frame.hands
        radius = math.dist(left.wrist, right.wrist) / 2
        normalized = min(1.0, radius / frame.torso_px / self.config.gain_radius_torsos)
        gain = normalized**self.config.gain_exponent
        if self.split:
            balls = tuple(Ball(h.wrist, radius / math.sqrt(2), h.side) for h in frame.hands)
        else:
            center = ((left.wrist[0] + right.wrist[0]) / 2, (left.wrist[1] + right.wrist[1]) / 2)
            balls = (Ball(center, radius),)
        return balls, gain
