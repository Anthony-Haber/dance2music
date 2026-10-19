"""Native-free browser-to-desktop MIDI session and HTTP integration contracts."""

import http.server
import json
import threading
import urllib.error
import urllib.request
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest

from web.midi_bridge import MAX_BODY_BYTES, SESSION_TIMEOUT, MidiBridge, messages_from, midi_handler


class Port:
    name = "IAC Driver Anthony"

    def __init__(self, fail_at: set[int] | None = None) -> None:
        self.messages: list[list[int]] = []
        self.attempts: list[list[int]] = []
        self.closed = 0
        self.fail_at = fail_at or set()

    def send(self, message: list[int]) -> None:
        assert not self.closed
        self.attempts.append(message.copy())
        if len(self.attempts) in self.fail_at:
            raise RuntimeError("native send failed")
        self.messages.append(message.copy())

    def close(self) -> None:
        self.closed += 1


def bridge_with(port: Port) -> MidiBridge:
    return MidiBridge(lambda: [port.name], lambda name: port)


def test_listing_never_opens_port_and_selection_is_exact() -> None:
    opened = []
    ports = ["IAC Driver ARIA_IN", "IAC Driver ARIA_OUT"]
    bridge = MidiBridge(lambda: ports, lambda name: opened.append(name) or Port())
    assert bridge.ports() == [{"id": name, "name": name} for name in ports]
    for name in ("ARIA", "", None, 1):
        with pytest.raises(ValueError):
            bridge.open(name)
    assert opened == []
    token = bridge.open(ports[1])
    assert opened == [ports[1]]
    assert bridge.sessions[token].active == set()
    bridge.close()


def test_hotplug_does_not_expose_unnamed_or_duplicate_port_choices() -> None:
    bridge = MidiBridge(lambda: ["IAC Driver Anthony", None, "", " ", "IAC Driver Anthony"])
    assert bridge.ports() == [{"id": "IAC Driver Anthony", "name": "IAC Driver Anthony"}]
    bridge.close()


def test_native_bytes_are_ordered_and_cleanup_is_owned_channel_only() -> None:
    port = Port()
    bridge = bridge_with(port)
    token = bridge.open(port.name)
    messages = [[191, 11, 64], [159, 48, 100], [159, 52, 100], [159, 55, 100]]
    bridge.send(token, 0, messages)
    bridge.send(token, 1, [])  # Holding a chord needs only a heartbeat.
    assert port.messages == messages
    bridge.send(token, 2, [[143, 52, 0], [159, 51, 100]])
    bridge.close_session(token)
    assert port.messages[-6:] == [[143, n, 0] for n in (48, 51, 55)] + [
        [191, c, 0] for c in (11, 64, 123)
    ]
    assert port.closed == 1
    bridge.close_session(token)
    bridge.close()
    assert port.closed == 1


@pytest.mark.parametrize(
    "payload",
    [
        None,
        [1],
        [[144, 60]],
        [[144, True, 100]],
        [[144, 128, 100]],
        [[144, 60, -1]],
        [[144.5, 60, 100]],
        [[240, 60, 0]],
        [[160, 60, 0]],
        [[176, 7, 100]],
        [[176, 64, 127]],
        [[176, 123, 1]],
        [[144, 60, 1]] * 65,
    ],
)
def test_invalid_batches_never_partially_send(payload: object) -> None:
    port = Port()
    bridge = bridge_with(port)
    token = bridge.open(port.name)
    with pytest.raises(ValueError):
        bridge.send(token, 0, payload)
    assert not port.attempts
    bridge.close()


def test_message_copy_and_zero_velocity_note_on_release() -> None:
    payload = [[144, 0, 127], [144, 127, 1]]
    assert messages_from(payload) == payload
    assert messages_from(payload)[0] is not payload[0]
    port = Port()
    bridge = bridge_with(port)
    token = bridge.open(port.name)
    bridge.send(token, 0, payload)
    bridge.send(token, 1, [[144, 0, 0], [176, 123, 0]])
    assert bridge.sessions[token].active == set()
    bridge.close()


def test_repeated_out_of_order_batches_and_unknown_sessions_do_not_send() -> None:
    port = Port()
    bridge = bridge_with(port)
    token = bridge.open(port.name)
    bridge.send(token, 0, [[144, 60, 100]])
    for sequence in (0, 2, -1, True):
        with pytest.raises(ValueError):
            bridge.send(token, sequence, [[144, 64, 100]])
    for missing in (None, "unknown", []):
        with pytest.raises(KeyError):
            bridge.send(missing, 0, [])
    assert port.messages == [[144, 60, 100]]
    bridge.close()


def test_stale_session_releases_without_browser_and_cannot_replay_late_notes() -> None:
    port = Port()
    now = [0.0]
    bridge = MidiBridge(lambda: [port.name], lambda name: port, lambda: now[0])
    token = bridge.open(port.name)
    bridge.send(token, 0, [[144, 60, 100]])
    now[0] = SESSION_TIMEOUT - 0.01
    bridge.expire()
    assert not port.closed
    now[0] = SESSION_TIMEOUT
    bridge.expire()
    assert port.messages[-4:] == [[128, 60, 0], [176, 11, 0], [176, 64, 0], [176, 123, 0]]
    with pytest.raises(KeyError):
        bridge.send(token, 1, [[144, 60, 100]])
    assert port.closed == 1


def test_send_checks_expiration_even_before_watchdog_runs() -> None:
    port = Port()
    now = [0.0]
    bridge = MidiBridge(lambda: [port.name], lambda name: port, lambda: now[0])
    token = bridge.open(port.name)
    now[0] = SESSION_TIMEOUT
    with pytest.raises(KeyError, match="timed out"):
        bridge.send(token, 0, [[144, 60, 100]])
    assert port.closed and not port.messages


def test_partial_note_on_and_failed_note_off_still_clean_other_notes_and_close() -> None:
    port = Port(fail_at={2, 3})
    bridge = bridge_with(port)
    token = bridge.open(port.name)
    with pytest.raises(RuntimeError, match="native send failed"):
        bridge.send(token, 0, [[144, 48, 100], [144, 52, 100], [144, 55, 100]])
    assert port.attempts == [
        [144, 48, 100],
        [144, 52, 100],
        [128, 48, 0],
        [128, 52, 0],
        [176, 11, 0],
        [176, 64, 0],
        [176, 123, 0],
    ]
    assert port.closed == 1 and token not in bridge.sessions


def test_refresh_and_disconnect_require_explicit_reselection() -> None:
    port, available, now = Port(), [Port.name], [0.0]
    bridge = MidiBridge(lambda: available, lambda name: port, lambda: now[0])
    token = bridge.open(port.name)
    bridge.send(token, 0, [[144, 60, 100]])
    for step in (0.4, 0.8):
        now[0] = step
        bridge.send(token, int(step / 0.4), [])
    available.clear()
    assert bridge.ports() == []
    now[0] = 1.2
    with pytest.raises(RuntimeError, match="disconnected"):
        bridge.send(token, 3, [])
    assert port.closed == 1 and not bridge.sessions


def test_same_destination_cannot_be_owned_by_two_tabs() -> None:
    port = Port()
    bridge = bridge_with(port)
    token = bridge.open(port.name)
    with pytest.raises(RuntimeError, match="another tab"):
        bridge.open(port.name)
    bridge.close_session(token)
    bridge.close()


@contextmanager
def api(tmp_path: Path, bridge: MidiBridge) -> Iterator[str]:
    (tmp_path / "index.html").write_text("Anthony instrument", encoding="utf-8")
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), midi_handler(bridge, str(tmp_path)))
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=2)
        bridge.close()


def post(url: str, path: str, payload: object, **headers: str) -> dict[str, object]:
    request = urllib.request.Request(
        url + path,
        data=json.dumps(payload).encode(),
        headers={"Origin": url, "Content-Type": "application/json", **headers},
    )
    with urllib.request.urlopen(request, timeout=3) as response:
        assert response.headers["Cache-Control"] == "no-store"
        return json.loads(response.read())


def test_http_port_listing_selection_batch_cleanup_and_static_page(tmp_path: Path) -> None:
    port = Port()
    with api(tmp_path, bridge_with(port)) as url:
        with urllib.request.urlopen(url + "/api/midi/ports") as response:
            assert json.loads(response.read())["ports"] == [{"id": port.name, "name": port.name}]
        assert not port.closed and not port.messages
        token = post(url, "/api/midi/open", {"port": port.name})["session"]
        assert post(
            url, "/api/midi/send", {"session": token, "sequence": 0, "messages": [[144, 60, 100]]}
        ) == {"ok": True}
        post(url, "/api/midi/close", {"session": token})
        assert port.closed == 1
        with urllib.request.urlopen(url + "/") as response:
            assert response.headers["Cache-Control"] == "no-cache"
            assert response.read() == b"Anthony instrument"


@pytest.mark.parametrize(
    "headers",
    [
        {"Origin": "https://attacker.invalid"},
        {"Host": "attacker.invalid:80"},
        {"Sec-Fetch-Site": "cross-site"},
        {"Content-Type": "text/plain"},
    ],
)
def test_http_rejects_cross_origin_and_non_json_before_device_access(
    tmp_path: Path, headers: dict[str, str]
) -> None:
    opened = []
    bridge = MidiBridge(lambda: [Port.name], lambda name: opened.append(name) or Port())
    with api(tmp_path, bridge) as url:
        with pytest.raises(urllib.error.HTTPError) as error:
            post(url, "/api/midi/open", {"port": Port.name}, **headers)
        assert error.value.code in (400, 403)
        assert not opened


def test_http_rejects_missing_origin_invalid_json_and_oversized_body(tmp_path: Path) -> None:
    port = Port()
    with api(tmp_path, bridge_with(port)) as url:
        for body, headers, code in [
            (b"{}", {}, 403),
            (b"bad json", {"Origin": url, "Content-Type": "application/json"}, 400),
            (b" " * (MAX_BODY_BYTES + 1), {"Origin": url, "Content-Type": "application/json"}, 400),
        ]:
            request = urllib.request.Request(url + "/api/midi/open", data=body, headers=headers)
            with pytest.raises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(request)
            assert error.value.code == code
        assert not port.closed


def test_http_driver_failure_is_actionable(tmp_path: Path) -> None:
    def missing() -> list[str]:
        raise RuntimeError("Install requirements/midi.txt")

    with api(tmp_path, MidiBridge(missing)) as url:
        with pytest.raises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(url + "/api/midi/ports")
        assert error.value.code == 503
        assert "requirements/midi.txt" in json.loads(error.value.read())["error"]
