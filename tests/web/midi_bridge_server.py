"""Synthetic MIDI driver for real browser/HTTP tests; never imports a native backend."""

import http.server
import json
import os
import signal
from pathlib import Path

from web.midi_bridge import MidiBridge, midi_handler

ROOT = Path(__file__).resolve().parents[2]
LOG = Path(os.environ["MIDI_TEST_LOG"])
records: dict[str, dict[str, object]] = {}
names = ["IAC Driver Safari Test A", "IAC Driver Safari Test B"]


def save() -> None:
    LOG.write_text(json.dumps(records), encoding="utf-8")


class Sink:
    def __init__(self, name: str) -> None:
        self.name = name
        self.messages: list[list[int]] = []
        records[name] = {"messages": self.messages, "closed": False}
        save()

    def send(self, message: list[int]) -> None:
        self.messages.append(message.copy())
        save()

    def close(self) -> None:
        records[self.name]["closed"] = True
        save()


def interrupt(signum: int, frame: object) -> None:
    raise KeyboardInterrupt


signal.signal(signal.SIGTERM, interrupt)
save()
bridge = MidiBridge(lambda: names, Sink)
handler = midi_handler(bridge, str(ROOT / "web"))
# Test subprocess pipes may not be drained by the harness while it waits for
# startup. Keep repeated health checks from blocking request threads on logging.
handler.func.log_message = lambda self, *args: None
try:
    with http.server.ThreadingHTTPServer(("127.0.0.1", 5098), handler) as server:
        bridge.start()
        print("ready", flush=True)
        server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    bridge.close()
