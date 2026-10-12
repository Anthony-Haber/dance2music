"""Device-free MIDI byte, lifecycle, port-selection and CLI integration contracts."""

import json
import subprocess
import sys
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
import pytest

from instrument.__main__ import main
from instrument.controller import Controller
from instrument.midi import NOTES_PORT, MidiNotes, MidiPort, output_ports
from instrument.models import Ball, Frame, Hand, Output
from instrument.replay import demonstration
from instrument.visuals import HUD_HEIGHT, MIDI_STATUS_HEIGHT, Renderer


class FakePort:
    name = NOTES_PORT

    def __init__(self, fail_at: set[int] | None = None) -> None:
        self.messages: list[list[int]] = []
        self.attempts: list[list[int]] = []
        self.closed = False
        self.fail_at = fail_at or set()

    def send(self, message: list[int]) -> None:
        assert not self.closed
        self.attempts.append(message.copy())
        if len(self.attempts) in self.fail_at:
            raise RuntimeError("disconnected cable")
        self.messages.append(message.copy())

    def close(self) -> None:
        self.closed = True


class FakeNative:
    def __init__(self, ports: list[str] | None = None) -> None:
        self.ports = ports or []
        self.opened: tuple[int | None, str] | None = None
        self.deleted = False
        self.messages: list[list[int]] = []

    def get_ports(self) -> list[str]:
        return self.ports

    def open_virtual_port(self, name: str) -> None:
        self.opened = (None, name)

    def open_port(self, index: int, name: str) -> None:
        self.opened = (index, name)

    def send_message(self, message: list[int]) -> None:
        self.messages.append(message.copy())

    def delete(self) -> None:
        self.deleted = True


def sounding(root: int = 48, **changes: object) -> Output:
    state = replace(
        Controller().update(Frame(0)),
        root_midi=root,
        balls=(Ball((320, 240), 40),),
        gain=0.5,
    )
    return replace(state, **changes)


def test_one_held_root_replaces_old_note_before_octave_or_interval_change() -> None:
    port = FakePort()
    midi = MidiNotes(port)
    for root in (48, 48, 55, 55, 67, 67, 55):
        midi.update(sounding(root))
    assert port.messages == [
        [0x90, 48, 96],
        [0x80, 48, 0],
        [0x90, 55, 96],
        [0x80, 55, 0],
        [0x90, 67, 96],
        [0x80, 67, 0],
        [0x90, 55, 96],
    ]
    midi.close()
    assert port.messages[-2:] == [[0x80, 55, 0], [0xB0, 123, 0]]
    midi.close()
    assert len(port.messages) == 9 and port.closed


def test_quality_lock_split_transfer_and_gain_changes_do_not_send_chord_tones() -> None:
    port = FakePort()
    midi = MidiNotes(port)
    original = sounding()
    for state in (
        original,
        replace(original, quality="minor", notes=(48, 51, 55)),
        replace(original, locked=True),
        replace(original, split=True, balls=(Ball((20, 30), 20), Ball((50, 60), 20))),
        replace(original, ball_owner="R", balls=(Ball((50, 60), 40, "R"),)),
        replace(original, gain=0.01),
    ):
        midi.update(state)
    assert port.messages == [[0x90, 48, 96]]


@pytest.mark.parametrize("missing", ["ball", "gain", "nan"])
def test_loss_releases_and_recovery_resumes_current_root(missing: str) -> None:
    port = FakePort()
    midi = MidiNotes(port)
    state = sounding()
    midi.update(state)
    lost = (
        replace(state, balls=())
        if missing == "ball"
        else replace(state, gain=0 if missing == "gain" else float("nan"))
    )
    midi.update(lost)
    midi.update(lost)
    midi.update(sounding(60))
    assert port.messages == [[0x90, 48, 96], [0x80, 48, 0], [0x90, 60, 96]]


def test_controller_demo_drives_monophonic_roots_through_qualities_and_split() -> None:
    controller, port = Controller(), FakePort()
    midi = MidiNotes(port)
    states = []
    for frame in demonstration(30):
        state = controller.update(frame)
        states.append(state)
        midi.update(state)
    assert {s.root_midi for s in states} == {48, 55, 57}
    assert any(s.quality == "minor" for s in states)
    assert any(s.split for s in states)
    assert [message[1] for message in port.messages if message[0] == 0x90] == [48, 55, 57]
    assert port.messages == [
        [0x90, 48, 96],
        [0x80, 48, 0],
        [0x90, 55, 96],
        [0x80, 55, 0],
        [0x90, 57, 96],
    ]


@pytest.mark.parametrize("owner", ["L", "R"])
def test_owned_controller_output_keeps_note_when_other_wrist_leaves(owner: str) -> None:
    controller, port = Controller(), FakePort()
    midi = MidiNotes(port)
    for index in range(120):
        t = index / 100
        frame = Frame(
            t,
            tuple(
                Hand(
                    side, (x, 240), "Closed_Fist" if side == owner and t >= 0.4 else "Open_Palm", 1
                )
                for side, x in (("L", 270), ("R", 370))
            ),
            (320, 240),
            100,
        )
        state = controller.update(frame)
        midi.update(state)
    assert state.ball_owner == owner
    one = Frame(1.2, (Hand(owner, (270, 240)),), (320, 240), 100)
    midi.update(controller.update(one))
    assert port.messages == [[0x90, 48, 96]]
    midi.update(controller.update(replace(one, time_s=1.21, hands=())))
    assert port.messages[-1] == [0x80, 48, 0]
    midi.update(controller.update(replace(one, time_s=1.22)))
    assert port.messages[-1] == [0x90, 48, 96]


def test_pause_persists_through_frames_then_resumes_latest_root() -> None:
    port = FakePort()
    midi = MidiNotes(port)
    midi.update(sounding())
    midi.set_paused(True)
    for _ in range(5):
        midi.update(sounding(55))
    assert port.messages == [[0x90, 48, 96], [0x80, 48, 0], [0xB0, 123, 0]]
    assert "PAUSED" in midi.status
    midi.set_paused(False)
    midi.update(sounding(55))
    assert port.messages[-1] == [0x90, 55, 96]
    assert "NOTE 55" in midi.status


@pytest.mark.parametrize("channel,velocity,root", [(1, 1, 0), (16, 127, 127)])
def test_channel_velocity_and_pitch_boundaries(channel: int, velocity: int, root: int) -> None:
    port = FakePort()
    midi = MidiNotes(port, channel, velocity)
    midi.update(sounding(root))
    midi.close()
    assert port.messages == [
        [0x90 | (channel - 1), root, velocity],
        [0x80 | (channel - 1), root, 0],
        [0xB0 | (channel - 1), 123, 0],
    ]


@pytest.mark.parametrize("channel,velocity", [(0, 96), (17, 96), (1, 0), (1, 128), (1.5, 96)])
def test_invalid_parameters_send_nothing(channel: int, velocity: int) -> None:
    port = FakePort()
    with pytest.raises(ValueError, match="channel.*velocity"):
        MidiNotes(port, channel, velocity)
    assert not port.messages


@pytest.mark.parametrize("root", [-1, 128, 48.5])
def test_invalid_root_is_not_sent(root: int) -> None:
    port = FakePort()
    midi = MidiNotes(port)
    with pytest.raises(ValueError, match="root note"):
        midi.update(sounding(root))
    assert not port.messages


def test_failed_note_on_attempt_is_released_and_failed_off_still_panics_and_closes() -> None:
    port = FakePort(fail_at={1, 2})
    midi = MidiNotes(port)
    with pytest.raises(RuntimeError, match="disconnected"):
        midi.update(sounding())
    with pytest.raises(RuntimeError, match="disconnected"):
        midi.close()
    assert port.attempts == [[0x90, 48, 96], [0x80, 48, 0], [0xB0, 123, 0]]
    assert port.messages == [[0xB0, 123, 0]] and port.closed
    midi.close()
    with pytest.raises(RuntimeError, match="closed"):
        midi.update(sounding())


def test_log_records_only_sent_bytes_with_source_times_including_cleanup() -> None:
    port = FakePort()
    records = []
    midi = MidiNotes(port, record=lambda timestamp, message: records.append((timestamp, message)))
    midi.update(sounding(time_s=0.4))
    midi.update(sounding(55, time_s=1.2))
    midi.close()
    assert [t for t, _ in records] == [0.4, 1.2, 1.2, 1.2, 1.2]
    assert [m for _, m in records] == port.messages and midi.messages == 5


def test_module_import_does_not_load_native_backend_or_open_devices() -> None:
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import sys; import instrument.midi; assert 'rtmidi' not in sys.modules",
        ],
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert result.returncode == 0, result.stderr


def test_missing_optional_dependency_has_install_command() -> None:
    with patch.dict(sys.modules, {"rtmidi": None}):
        with pytest.raises(RuntimeError, match="requirements/midi.txt"):
            MidiPort()


def test_virtual_source_has_clear_name_and_disappears_on_close() -> None:
    native = FakeNative()
    with patch(
        "instrument.midi._backend", return_value=SimpleNamespace(MidiOut=lambda name: native)
    ):
        port = MidiPort()
    assert native.opened == (None, NOTES_PORT) and port.name == NOTES_PORT
    port.send([0x90, 48, 96])
    port.close()
    port.close()
    assert native.deleted and native.messages == [[0x90, 48, 96]]
    with pytest.raises(RuntimeError, match="closed"):
        port.send([0x90, 48, 96])


@pytest.mark.parametrize("destination", ["IAC dance2music Notes", "dance2music"])
def test_destination_uses_exact_or_unique_match(destination: str) -> None:
    native = FakeNative(["hardware", "IAC dance2music Notes"])
    with patch(
        "instrument.midi._backend", return_value=SimpleNamespace(MidiOut=lambda name: native)
    ):
        port = MidiPort(destination)
    assert native.opened == (1, NOTES_PORT) and port.name == "IAC dance2music Notes"
    port.close()


def test_exact_name_wins_over_other_substring_matches() -> None:
    native = FakeNative(["Notes", "Notes 2"])
    with patch(
        "instrument.midi._backend", return_value=SimpleNamespace(MidiOut=lambda name: native)
    ):
        port = MidiPort("Notes")
    assert native.opened == (0, NOTES_PORT)
    port.close()


@pytest.mark.parametrize("destination,reason", [("Notes", "ambiguous"), ("missing", "not found")])
def test_bad_destination_fails_without_opening_hardware(destination: str, reason: str) -> None:
    native = FakeNative(["Notes 1", "Notes 2"])
    with patch(
        "instrument.midi._backend", return_value=SimpleNamespace(MidiOut=lambda name: native)
    ):
        with pytest.raises(RuntimeError, match=reason):
            MidiPort(destination)
    assert native.opened is None and native.deleted


def test_empty_destination_is_not_a_wildcard() -> None:
    with pytest.raises(ValueError, match="empty"):
        MidiPort(" ")


def test_listing_releases_client() -> None:
    native = FakeNative(["IAC Notes"])
    with patch(
        "instrument.midi._backend", return_value=SimpleNamespace(MidiOut=lambda name: native)
    ):
        assert output_ports() == ["IAC Notes"]
    assert native.deleted and native.opened is None


def test_native_open_and_send_failures_have_context_and_free_endpoint() -> None:
    native = FakeNative()
    with patch(
        "instrument.midi._backend", return_value=SimpleNamespace(MidiOut=lambda name: native)
    ):
        with patch.object(native, "open_virtual_port", side_effect=RuntimeError("unsupported")):
            with pytest.raises(RuntimeError, match="loopMIDI"):
                MidiPort()
        assert native.deleted
        native.deleted = False
        port = MidiPort()
    with patch.object(native, "send_message", side_effect=RuntimeError("disconnected")):
        with pytest.raises(RuntimeError, match=NOTES_PORT):
            port.send([0x90, 48, 96])
    port.close()
    assert native.deleted


def call_cli(monkeypatch: pytest.MonkeyPatch, *args: str) -> int:
    monkeypatch.setattr(sys, "argv", ["instrument", *args])
    return main()


def test_cli_headless_midi_is_paced_and_exports_cleanup(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    port = FakePort()
    sleeps = []
    monkeypatch.setattr("instrument.__main__.MidiPort", lambda destination: port)
    monkeypatch.setattr("instrument.__main__.time.perf_counter", lambda: 0.0)
    monkeypatch.setattr("instrument.__main__.time.sleep", sleeps.append)
    assert (
        call_cli(
            monkeypatch,
            "--demo",
            "--headless",
            "--midi",
            "--seconds",
            "0.1",
            "--fps",
            "100",
            "--output",
            str(tmp_path),
        )
        == 0
    )
    assert sleeps and sum(sleeps) > 0
    recorded = [json.loads(line) for line in (tmp_path / "midi.jsonl").read_text().splitlines()]
    assert [r["bytes"] for r in recorded] == [[0x90, 48, 96], [0x80, 48, 0], [0xB0, 123, 0]]
    summary = json.loads(capsys.readouterr().out)
    assert summary["midi"]["port"] == NOTES_PORT and summary["midi"]["messages"] == 3
    assert summary["preview_size_px"] == [960, 720 + HUD_HEIGHT + MIDI_STATUS_HEIGHT]
    assert port.closed


def test_cli_no_midi_does_not_open_backend(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("instrument.midi._backend", lambda: pytest.fail("unexpected MIDI device"))
    assert call_cli(monkeypatch, "--demo", "--headless", "--seconds", "0.05") == 0


def test_cli_list_does_not_start_camera_models_or_audio(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr("instrument.__main__.output_ports", lambda: ["IAC Notes"])
    monkeypatch.setattr("instrument.__main__.Tracker", lambda path: pytest.fail("models started"))
    monkeypatch.setattr(
        "instrument.__main__.Playback", lambda *a, **k: pytest.fail("audio started")
    )
    assert call_cli(monkeypatch, "--list-midi-ports") == 0
    assert json.loads(capsys.readouterr().out) == {"midi_destinations": ["IAC Notes"]}


def test_cli_destination_implies_midi_and_invalid_channel_opens_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    port = FakePort()
    destinations = []

    def make_port(destination: str | None) -> FakePort:
        destinations.append(destination)
        return port

    monkeypatch.setattr("instrument.__main__.MidiPort", make_port)
    assert (
        call_cli(
            monkeypatch, "--demo", "--headless", "--midi-port", "IAC Notes", "--seconds", "0.01"
        )
        == 0
    )
    assert destinations == ["IAC Notes"] and port.closed
    assert call_cli(monkeypatch, "--demo", "--headless", "--midi-channel", "17") == 1
    assert destinations == ["IAC Notes"]


@pytest.mark.parametrize(
    "failure,exit_code", [(RuntimeError("bad frame"), 1), (KeyboardInterrupt(), 130)]
)
def test_cli_loop_failure_releases_note(
    monkeypatch: pytest.MonkeyPatch, failure: BaseException, exit_code: int
) -> None:
    port = FakePort()
    monkeypatch.setattr("instrument.__main__.MidiPort", lambda destination: port)
    monkeypatch.setattr(
        "instrument.__main__.Renderer.draw", lambda *a, **k: (_ for _ in ()).throw(failure)
    )
    assert call_cli(monkeypatch, "--demo", "--headless", "--midi") == exit_code
    assert port.messages == [[0x90, 48, 96], [0x80, 48, 0], [0xB0, 123, 0]]
    assert port.closed


def test_cli_p_key_pauses_resumes_and_q_releases(monkeypatch: pytest.MonkeyPatch) -> None:
    port = FakePort()
    monkeypatch.setattr("instrument.__main__.MidiPort", lambda destination: port)
    with patch("instrument.__main__.time.sleep"):
        with patch("instrument.__main__.cv2.waitKey", side_effect=[ord("P"), ord("p"), ord("q")]):
            with patch("instrument.__main__.cv2.getWindowProperty", return_value=1):
                with patch.multiple(
                    "instrument.__main__.cv2",
                    namedWindow=lambda *a: None,
                    resizeWindow=lambda *a: None,
                    imshow=lambda *a: None,
                    destroyAllWindows=lambda: None,
                ):
                    assert call_cli(monkeypatch, "--demo", "--mute", "--midi") == 0
    assert port.messages == [
        [0x90, 48, 96],
        [0x80, 48, 0],
        [0xB0, 123, 0],
        [0x90, 48, 96],
        [0x80, 48, 0],
        [0xB0, 123, 0],
    ]
    assert port.closed


def test_midi_status_row_preserves_camera_image_and_existing_hud() -> None:
    image = np.zeros((480, 640, 3), dtype=np.uint8)
    midi = MidiNotes(FakePort())
    midi.update(sounding())
    output = Renderer().draw(image, Frame(0), sounding(), midi_status=midi.status)
    assert output.shape == (480 + HUD_HEIGHT + MIDI_STATUS_HEIGHT, 640, 3)
    assert np.any(output[HUD_HEIGHT : HUD_HEIGHT + MIDI_STATUS_HEIGHT])
    assert not np.any(image)
