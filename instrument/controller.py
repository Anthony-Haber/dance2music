"""Causal instrument state; no camera, drawing, sound or file effects."""

import math
from dataclasses import dataclass

from instrument.harmony import Chord, gesture_quality, root_region, voice_lead
from instrument.models import GESTURES, Ball, Config, Frame, Output
from instrument.root_control import ROOT_MIDI_MAX, ROOT_MIDI_MIN, IntervalSelector


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
        self.root_midi = 48 + self.chord.root
        self.root_mode = getattr(self, "root_mode", self.config.root_mode)
        self.mode_changed = False
        self.notes = voice_lead((), self.chord)
        self.locked = self.split = False
        self.ball_owner: str | None = None
        self.owned_radius_torsos = self.owned_gain = 0.0
        self.last_time: float | None = None
        self._clear_transients()

    def _clear_transients(self) -> None:
        self.gates = {"L": FistGate(), "R": FistGate()}
        self.root_dwell, self.quality_dwell, self.major_dwell = Dwell(), Dwell(), Dwell()
        self.interval_selector = IntervalSelector()
        self.pending_since: float | None = None
        self.pending_transfer: str | None = None
        self.pending_sides: set[str] = set()
        self.pending_root = self.chord.root
        self.pending_root_midi = self.root_midi
        self.split_requested = False

    def set_root_mode(self, mode: str) -> None:
        """Switch root input without changing the current chord, register or lock."""
        if mode not in {"interval", "midpoint"}:
            raise ValueError("Root mode must be interval or midpoint")
        if mode != self.root_mode:
            self.root_mode, self.mode_changed = mode, True
            self.root_dwell = Dwell()
            self.interval_selector = IntervalSelector()

    def toggle_root_mode(self) -> None:
        self.set_root_mode("midpoint" if self.root_mode == "interval" else "interval")

    def merge(self) -> None:
        """Keyboard merge control, independent of chord and lock."""
        self.split = False
        self.ball_owner = None
        # A merge while both fists are held must not immediately split again.
        self.split_requested = False
        self.pending_since = None
        self.pending_transfer = None
        for gate in self.gates.values():
            gate.closure_triggered = False

    def update(self, frame: Frame) -> Output:
        now = frame.time_s
        if frame.root_mode is not None:
            self.set_root_mode(frame.root_mode)
        if self.last_time is not None:
            if now <= self.last_time:
                raise ValueError("Controller frame timestamps must strictly increase")
            if now - self.last_time > self.config.max_gap_s + 1e-9:
                self._clear_transients()
        self.last_time = now
        events: list[str] = []
        if self.mode_changed:
            events.append(f"root_mode:{self.root_mode}")
            self.mode_changed = False
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
        transfer_target = (
            "L"
            if gestures.get("L") == "Closed_Fist" and gestures.get("R") == "Open_Palm"
            else "R"
            if gestures.get("R") == "Closed_Fist" and gestures.get("L") == "Open_Palm"
            else None
        )
        if self.pending_since is not None and (
            transfer_target != self.pending_transfer
            or (
                self.pending_transfer is not None
                and any(gestures.get(side) != "Closed_Fist" for side in self.pending_sides)
            )
        ):
            # A different pair during arbitration requires a fresh closure.
            # Nearby fists still use the held closure's split eligibility below.
            self.pending_since = None
        if closures and self.pending_since is None:
            self.pending_since, self.pending_root = now, self.chord.root
            self.pending_root_midi = self.root_midi
            self.pending_sides = set(closures)
            self.pending_transfer = transfer_target
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
                # The same nearby-fist gesture returns either attached mode
                # (one owning hand or two split hands) to the midpoint.
                self.split = False if self.ball_owner is not None else not self.split
                self.ball_owner = None
                events.append("split" if self.split else "merge")
                self.split_requested = False
                for gate in self.gates.values():
                    gate.closure_triggered = False
        else:
            self.split_requested = False
            if self.pending_since is not None and (
                now - self.pending_since + 1e-9 >= self.config.arbitration_s
            ):
                if self.pending_transfer is not None:
                    self._transfer(frame, self.pending_transfer)
                    events.append(f"transfer:{self.pending_transfer}")
                else:
                    self.locked = not self.locked
                    if self.locked:
                        self.chord = Chord(self.pending_root, self.chord.quality)
                        self.root_midi = self.pending_root_midi
                    events.append("lock" if self.locked else "unlock")
                self.pending_since = None
                self.root_dwell = Dwell()
        raw_root = None
        root = self.chord.root
        transposed = False
        root_allowed = not self.locked and self.pending_since is None and not self.split_requested
        if self.root_mode == "midpoint":
            raw_root = root_region(frame, self.config.dead_zone_torsos)
            if root_allowed:
                selected = self.root_dwell.read(raw_root, now, self.config.root_dwell_s)
                if isinstance(selected, int):
                    target = self.root_midi + selected - self.chord.root
                    if ROOT_MIDI_MIN <= target <= ROOT_MIDI_MAX:
                        root, self.root_midi = selected, target
            else:
                self.root_dwell = Dwell()
        else:
            fist_active = any(
                hand.gesture == "Closed_Fist"
                or (
                    hand.raw_gesture == "Closed_Fist"
                    and hand.raw_confidence >= self.config.confidence_min
                )
                for hand in frame.hands
            )
            blocked = (
                "ROOT LOCKED"
                if self.locked
                else "FIST CONTROL"
                if not root_allowed or fist_active
                else None
            )
            step = self.interval_selector.read(frame, self.config, blocked)
            if self.interval_selector.candidate is not None:
                raw_root = (root + self.interval_selector.candidate) % 12
            if step is not None:
                target = self.root_midi + step
                notes = tuple(note + step for note in self.notes)
                if ROOT_MIDI_MIN <= target <= ROOT_MIDI_MAX and all(0 <= n <= 127 for n in notes):
                    self.root_midi, self.notes = target, notes
                    root = target % 12
                    transposed = True
                    events.append(f"interval:{step:+d}")
                else:
                    self.interval_selector.feedback = "REGISTER LIMIT - RETURN TO CENTER"
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
        if chord != self.chord or transposed:
            events.append("chord")
        if (
            (chord != self.chord and not transposed)
            or quality != self.chord.quality
            or {n % 12 for n in self.notes} != set(chord.pitch_classes)
        ):
            shift = self.root_midi - (48 + chord.root)
            self.notes = voice_lead(self.notes, chord, shift)
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
            (self.pending_since is not None and self.pending_transfer is None)
            or self.split_requested,
            root_mode=self.root_mode,
            root_midi=self.root_midi,
            hand_directions=self.interval_selector.directions,
            interval_candidate=self.interval_selector.candidate,
            root_armed=self.interval_selector.armed,
            root_feedback=self.interval_selector.feedback,
            ball_owner=self.ball_owner,
            pending_transfer=self.pending_transfer if self.pending_since is not None else None,
        )

    def _transfer(self, frame: Frame, owner: str) -> None:
        """Capture combined ball area and loudness, independent of the other wrist."""
        balls, gain = self._geometry(frame)
        if frame.torso_px is None or not balls:
            return
        radius = math.sqrt(sum(ball.radius**2 for ball in balls))
        self.owned_radius_torsos = radius / frame.torso_px
        self.owned_gain = gain
        self.ball_owner, self.split = owner, False

    def _geometry(self, frame: Frame) -> tuple[tuple[Ball, ...], float]:
        if frame.torso_px is None or frame.torso_center is None:
            return (), 0.0
        if self.ball_owner is not None:
            owner = next((hand for hand in frame.hands if hand.side == self.ball_owner), None)
            if owner is None:
                return (), 0.0
            ball = Ball(owner.wrist, self.owned_radius_torsos * frame.torso_px, owner.side)
            return (ball,), self.owned_gain
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
