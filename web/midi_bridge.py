"""Loopback-only browser MIDI bridge; native devices open only on explicit requests.

Inputs are ordered batches of three-byte note/expression/panic messages. Each
selected destination has an expiring session so stalled/closed pages release
owned pitches even when browser cleanup cannot reach the server.
"""

import functools
import http.server
import ipaddress
import json
import logging
import secrets
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit

from instrument.midi import MidiPort, Sender, output_ports
from web.phone_server import WebHandler

SESSION_TIMEOUT = 0.75
WATCHDOG_PERIOD = 0.1
MAX_MESSAGES = 64
MAX_BODY_BYTES = 16384
logger = logging.getLogger(__name__)


@dataclass
class Session:
    port: Sender
    destination: str
    last_seen: float
    checked_ports: float
    sequence: int = -1
    active: set[tuple[int, int]] = field(default_factory=set)
    channels: set[int] = field(default_factory=set)


def messages_from(payload: object) -> list[list[int]]:
    """Validate a bounded batch before sending any bytes; no SysEx/system messages."""
    if not isinstance(payload, list) or len(payload) > MAX_MESSAGES:
        raise ValueError(f"MIDI messages must be a list of at most {MAX_MESSAGES} messages")
    messages = []
    for message in payload:
        if (
            not isinstance(message, list)
            or len(message) != 3
            or any(type(byte) is not int for byte in message)
            or not 0 <= message[1] <= 127
            or not 0 <= message[2] <= 127
        ):
            raise ValueError("MIDI messages need a status and two integer data bytes in [0,127]")
        kind = message[0] & 0xF0
        if not 0x80 <= message[0] <= 0xBF or kind not in (0x80, 0x90, 0xB0):
            raise ValueError("Only MIDI Note On/Off and expression/panic controls are supported")
        if kind == 0xB0 and not (message[1] == 11 or (message[1] in (64, 123) and message[2] == 0)):
            raise ValueError("Only expression CC11, sustain-off and all-notes-off are supported")
        messages.append(message.copy())
    return messages


class MidiBridge:
    """Explicit destination ownership and ordered delivery, protected across HTTP threads."""

    def __init__(
        self,
        list_ports: Callable[[], list[str]] = output_ports,
        open_port: Callable[[str], Sender] = MidiPort,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.list_ports, self.open_port, self.clock = list_ports, open_port, clock
        self.sessions: dict[str, Session] = {}
        self.lock = threading.RLock()
        self.stopped = threading.Event()
        self.thread: threading.Thread | None = None

    def ports(self) -> list[dict[str, str]]:
        """List current destinations exactly as the Mac driver names them; never select one."""
        # CoreMIDI can briefly expose an unnamed endpoint during hot removal.
        names = [name for name in self.list_ports() if isinstance(name, str) and name.strip()]
        return [{"id": name, "name": name} for name in dict.fromkeys(names)]

    def open(self, destination: object) -> str:
        if not isinstance(destination, str) or not destination or len(destination) > 512:
            raise ValueError("Select an exact MIDI destination name")
        with self.lock:
            if self.stopped.is_set():
                raise RuntimeError("MIDI server is stopping")
            if destination not in self.list_ports():
                raise ValueError(
                    "MIDI destination disappeared; refresh and select its current name"
                )
            if any(session.destination == destination for session in self.sessions.values()):
                raise RuntimeError("This MIDI destination is already selected in another tab")
            if len(self.sessions) >= 8:
                raise RuntimeError("Close an existing MIDI connection before opening another")
            port = self.open_port(destination)
            token = secrets.token_urlsafe(24)
            now = self.clock()
            self.sessions[token] = Session(port, destination, now, now)
            return token

    def _session(self, token: object) -> Session:
        if not isinstance(token, str) or token not in self.sessions:
            raise KeyError("MIDI connection expired or closed; select the port again")
        return self.sessions[token]

    def send(self, token: object, sequence: object, payload: object) -> None:
        messages = messages_from(payload)
        if type(sequence) is not int or sequence < 0:
            raise ValueError("MIDI sequence must be a nonnegative integer")
        with self.lock:
            session = self._session(token)
            if self.clock() - session.last_seen >= SESSION_TIMEOUT:
                self._close(str(token))
                raise KeyError("MIDI connection timed out; select the port again")
            if sequence != session.sequence + 1:
                raise ValueError("MIDI batch arrived out of order; reconnect the port")
            try:
                now = self.clock()
                if now - session.checked_ports >= 1:
                    if session.destination not in self.list_ports():
                        raise RuntimeError("MIDI destination disconnected; refresh the port list")
                    session.checked_ports = now
                for message in messages:
                    status, note, value = message
                    channel, kind = status & 0x0F, status & 0xF0
                    session.channels.add(channel)
                    if kind == 0x90 and value > 0:
                        # Include attempted pitches in cleanup after a partial native send.
                        session.active.add((channel, note))
                    session.port.send(message)
                    if kind == 0x80 or (kind == 0x90 and value == 0):
                        session.active.discard((channel, note))
                    elif kind == 0xB0 and note == 123:
                        session.active = {entry for entry in session.active if entry[0] != channel}
                session.sequence = sequence
                session.last_seen = now
            except Exception:
                self._close(str(token))
                raise

    def _close(self, token: str) -> None:
        """Best effort all-note cleanup; always release the native object once."""
        session = self.sessions.pop(token, None)
        if session is None:
            return
        cleanup = [[0x80 | channel, note, 0] for channel, note in sorted(session.active)]
        cleanup += [
            [0xB0 | channel, control, 0]
            for channel in sorted(session.channels)
            for control in (11, 64, 123)
        ]
        try:
            for message in cleanup:
                try:
                    session.port.send(message)
                except Exception:
                    # Disconnected drivers can reject release; keep trying the other notes.
                    pass
        finally:
            try:
                session.port.close()
            except Exception as error:
                logger.warning("Cannot close MIDI destination %r: %s", session.destination, error)

    def close_session(self, token: object) -> None:
        if not isinstance(token, str):
            raise ValueError("MIDI session must be a string")
        with self.lock:
            self._close(token)

    def expire(self) -> None:
        """Release expired connections independently of browser frame/watchdog timers."""
        with self.lock:
            expired = [
                token
                for token, session in self.sessions.items()
                if self.clock() - session.last_seen >= SESSION_TIMEOUT
            ]
            for token in expired:
                self._close(token)

    def start(self) -> None:
        def watch() -> None:
            while not self.stopped.wait(WATCHDOG_PERIOD):
                self.expire()

        self.thread = threading.Thread(target=watch, name="browser-midi-watchdog", daemon=True)
        self.thread.start()

    def close(self) -> None:
        self.stopped.set()
        if self.thread is not None:
            self.thread.join(timeout=2)
        with self.lock:
            for token in list(self.sessions):
                self._close(token)


def midi_handler(
    bridge: MidiBridge,
    directory: str,
    base_handler: type[http.server.SimpleHTTPRequestHandler] = WebHandler,
) -> Callable[..., http.server.SimpleHTTPRequestHandler]:
    """Add a same-origin, loopback-only API to desktop serving; phone serving stays static."""

    # The runtime-selected parent preserves the host server's routes and guards.
    class Handler(base_handler):  # type: ignore[valid-type,misc]
        def end_headers(self) -> None:
            # Local edits must be revalidated on reload, including imported modules.
            # MIDI JSON responses already use the stricter no-store policy.
            if not self.path.startswith("/api/midi/"):
                self.send_header("Cache-Control", "no-cache")
            super().end_headers()

        def log_request(self, code: int | str = "-", size: int | str = "-") -> None:
            # Heartbeats/normal frames should not flood the performer's terminal.
            if self.path == "/api/midi/send" and str(code) == "200":
                return
            super().log_request(code, size)

        def _json(self, status: int, payload: dict[str, Any]) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _local(self, post: bool = False) -> bool:
            allowed_host = getattr(self, "allowed_host", None)
            if allowed_host is not None and not allowed_host():
                return False
            host = self.headers.get("Host", "")
            parsed = urlsplit("http://" + host)
            origin = self.headers.get("Origin")
            address = self.server.server_address
            port = address[1] if isinstance(address, tuple) else None
            valid = (
                ipaddress.ip_address(self.client_address[0]).is_loopback
                and parsed.hostname in ("127.0.0.1", "localhost", "::1")
                and parsed.port == port
                and (origin == "http://" + host if post else origin in (None, "http://" + host))
                and self.headers.get("Sec-Fetch-Site", "same-origin") == "same-origin"
            )
            if not valid:
                self._json(403, {"error": "Local MIDI accepts this localhost page only"})
            return valid

        def do_GET(self) -> None:
            if self.path != "/api/midi/ports":
                super().do_GET()
                return
            try:
                if self._local():
                    self._json(200, {"ports": bridge.ports()})
            except (ValueError, RuntimeError, OSError) as error:
                self._json(503, {"error": str(error)})

        def do_POST(self) -> None:
            if self.path not in ("/api/midi/open", "/api/midi/send", "/api/midi/close"):
                self._json(404, {"error": "Unknown MIDI operation"})
                return
            try:
                if not self._local(post=True):
                    return
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= MAX_BODY_BYTES:
                    raise ValueError("MIDI request body is missing or too large")
                if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                    raise ValueError("MIDI requests require application/json")
                self.connection.settimeout(2)
                payload = json.loads(self.rfile.read(length))
                if not isinstance(payload, dict):
                    raise ValueError("MIDI request must be a JSON object")
                if self.path == "/api/midi/open":
                    self._json(200, {"session": bridge.open(payload.get("port"))})
                elif self.path == "/api/midi/send":
                    bridge.send(
                        payload.get("session"), payload.get("sequence"), payload.get("messages")
                    )
                    self._json(200, {"ok": True})
                else:
                    bridge.close_session(payload.get("session"))
                    self._json(200, {"ok": True})
            except KeyError as error:
                self._json(409, {"error": str(error.args[0])})
            except (ValueError, TypeError) as error:
                self._json(400, {"error": str(error)})
            except (RuntimeError, OSError) as error:
                self._json(503, {"error": str(error)})

    return functools.partial(Handler, directory=directory)
