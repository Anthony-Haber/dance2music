#!/usr/bin/env python3
"""Serve the live tool (web/) on localhost, where browsers allow the camera.

    python live.py              # http://127.0.0.1:5092/live/
    python live.py --offline    # prepare browser assets and the native Magenta
                                # helper/models for later use without internet

Opens Chrome when installed, otherwise the default browser.
The page prefers the local copy when it exists and falls back to the CDN.
"""

from __future__ import annotations

import argparse
import functools
import http.server
import os
import shutil
import signal
import subprocess
import sys
import webbrowser
from collections.abc import Callable
from pathlib import Path
from types import FrameType
from typing import TYPE_CHECKING
from urllib.parse import urlsplit

from browser_assets import prepare as prepare_browser_assets
from magenta_runtime import MagentaRuntime
from piano_assets import prepare as prepare_piano_assets
from scene_assets import prepare as prepare_scene_assets
from web.phone_server import phone_host, serve_phone

if TYPE_CHECKING:
    from web.midi_bridge import MidiBridge

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, "web")
VENDOR = os.path.join(WEB, "live", "vendor", "mediapipe")
MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/"
MODEL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_{m}/float16/1/pose_landmarker_{m}.task"
)
FILES = ["vision_bundle.mjs"] + [
    f"wasm/vision_wasm{v}_internal.{e}" for v in ("", "_module", "_nosimd") for e in ("js", "wasm")
]
# Chrome still gates persisted Bluetooth permissions and getDevices() behind
# this feature. It retains the initial device chooser and service permissions.
# Scope the launch to Bluetooth instead of enabling all experimental web APIs.
CHROME_WATCH_ARGS = ["--enable-features=WebBluetoothNewPermissionsBackend"]


def open_browser(url: str) -> bool:
    """Prefer Chrome, falling back to the default browser if unavailable."""
    if sys.platform == "darwin":
        # Launch the executable from the same context as this server. On macOS
        # the Launch Services (`open -a`) path exhibited empty BLE discovery,
        # while a direct launch with the same Chrome profile received watches.
        # Keep Chrome outside the server's process group so Ctrl+C stops only
        # the server. Chrome handles reuse of an already-running profile.
        for application in (
            Path("/Applications/Google Chrome.app"),
            Path.home() / "Applications/Google Chrome.app",
        ):
            executable = application / "Contents/MacOS/Google Chrome"
            if not executable.is_file():
                continue
            try:
                subprocess.Popen(
                    [str(executable), *CHROME_WATCH_ARGS, url],
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    start_new_session=True,
                )
                return True
            except OSError:
                pass
        # Launch Services can still find installations in nonstandard locations.
        # Keep the URL an operand so an already-running Chrome receives it too.
        try:
            if (
                subprocess.run(
                    ["open", "-a", "Google Chrome", url, "--args", *CHROME_WATCH_ARGS],
                    stderr=subprocess.DEVNULL,
                ).returncode
                == 0
            ):
                return True
        except OSError:
            pass
    else:
        candidates = ["google-chrome", "google-chrome-stable", "chrome"]
        if sys.platform == "win32":
            candidates += [
                os.path.join(os.environ[root], "Google", "Chrome", "Application", "chrome.exe")
                for root in ("LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)")
                if os.environ.get(root)
            ]
        for candidate in candidates:
            executable = shutil.which(candidate)
            if executable and webbrowser.BackgroundBrowser(
                [executable, *CHROME_WATCH_ARGS, "%s"]
            ).open(url):
                return True
    return webbrowser.open(url)


def offline(magenta: bool = True) -> None:
    prepare_browser_assets()
    prepare_scene_assets()
    prepare_piano_assets()
    if magenta:
        from magenta_install import prepare as prepare_magenta

        prepare_magenta()


def create_server(
    website: str | Path = WEB,
    runtime: MagentaRuntime | None = None,
    *,
    browser_root: str | Path | None = None,
    port: int = 5092,
    packaged: bool = False,
    midi_bridge: MidiBridge | None = None,
) -> http.server.ThreadingHTTPServer:
    """Serve explicit read-only resources; mutable browser assets may be external."""
    active_runtime = runtime or MagentaRuntime()
    website = Path(website).resolve()

    class Handler(http.server.SimpleHTTPRequestHandler):
        server: http.server.HTTPServer
        extensions_map = {
            **http.server.SimpleHTTPRequestHandler.extensions_map,
            ".mjs": "text/javascript",
            ".js": "text/javascript",
            ".wasm": "application/wasm",
        }

        def do_GET(self) -> None:
            if not self.allowed_host():
                return
            if urlsplit(self.path).path == "/app/config":
                import json

                data = json.dumps({"packaged": packaged}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            if not active_runtime.handle(self):
                super().do_GET()

        def allowed_host(self) -> bool:
            if packaged and self.headers.get("Host") != f"127.0.0.1:{self.server.server_port}":
                self.send_error(403, "Application host required")
                return False
            return True

        def do_HEAD(self) -> None:
            if self.allowed_host():
                super().do_HEAD()

        def translate_path(self, path: str) -> str:
            translated = Path(super().translate_path(path))
            relative = translated.relative_to(website)
            if browser_root is not None and relative.parts[:2] == ("live", "vendor"):
                return str(Path(browser_root).joinpath(*relative.parts[2:]))
            return str(translated)

        def end_headers(self) -> None:
            if packaged:
                # Session startup cannot fall back to an external CDN. Workers
                # inherit this policy, including ONNX and MediaPipe fetches.
                self.send_header(
                    "Content-Security-Policy",
                    "default-src 'self' blob: data:; "
                    "script-src 'self' blob: 'unsafe-eval' 'wasm-unsafe-eval'; "
                    "style-src 'self' 'unsafe-inline'; connect-src 'self' blob: data:",
                )
            super().end_headers()

        def log_message(self, format: str, *args: object) -> None:
            # WebSocket URL contains a short-lived local launch token.
            if self.path.startswith("/magenta/"):
                return
            super().log_message(format, *args)

    handler: Callable[..., http.server.SimpleHTTPRequestHandler] = functools.partial(
        Handler, directory=str(website)
    )
    if midi_bridge is not None:
        from web.midi_bridge import midi_handler

        handler = midi_handler(midi_bridge, str(website), Handler)
    return http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--offline",
        action="store_true",
        help="prepare browser assets and optional native Magenta for offline use",
    )
    parser.add_argument("--port", type=int, default=5092)
    parser.add_argument("--phone", action="store_true", help="serve local HTTPS for iPhone Safari")
    parser.add_argument("--phone-host", help="laptop LAN IPv4 address (auto-detected by default)")
    parser.add_argument(
        "--setup-port", type=int, help="certificate setup HTTP port (default: port + 1)"
    )
    parser.add_argument(
        "--no-browser", action="store_true", help="print URLs without opening a browser"
    )
    parser.add_argument(
        "--without-magenta",
        action="store_true",
        help="omit optional native Magenta installation during offline setup",
    )
    args = parser.parse_args(argv)
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")
    if not args.phone and (args.phone_host or args.setup_port is not None):
        parser.error("--phone-host and --setup-port require --phone")
    if args.phone:
        args.setup_port = args.setup_port if args.setup_port is not None else args.port + 1
        if not 1 <= args.setup_port <= 65535 or args.setup_port == args.port:
            parser.error("--setup-port must be 1–65535 and different from --port")
    return args


def main(argv: list[str] | None = None) -> int:
    a = parse_args(argv)
    try:
        if a.offline:
            offline(magenta=not a.without_magenta)
        if a.phone:
            host = phone_host(a.phone_host)
            serve_phone(Path(WEB), Path(ROOT) / "output" / "phone", host, a.port, a.setup_port)
            return 0
        return serve_desktop(a)
    except KeyboardInterrupt:
        print("\nServer stopped.")
    except (OSError, RuntimeError, ValueError) as error:
        print(f"Could not start live server: {error}", file=sys.stderr)
        return 1
    return 0


def serve_desktop(a: argparse.Namespace) -> int:
    from web.midi_bridge import MidiBridge

    bridge = MidiBridge()
    runtime = MagentaRuntime()
    srv = create_server(runtime=runtime, port=a.port, midi_bridge=bridge)
    url = f"http://127.0.0.1:{a.port}/live/"
    print(url, flush=True)
    print("Press Ctrl+C in this terminal to stop the server.", flush=True)
    if not a.no_browser:
        print(
            "Chrome watch permissions: pair each watch once; "
            "previously paired watches reconnect automatically.",
            flush=True,
        )
        print(
            "If Chrome was already open, fully quit it and restart this command "
            "to enable remembered watches.",
            flush=True,
        )
        open_browser(url)

    def terminate(signum: int, frame: FrameType | None) -> None:
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, terminate)
    try:
        bridge.start()
        srv.serve_forever()
    finally:
        bridge.close()
        runtime.stop(shutdown=True)
        srv.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
