#!/usr/bin/env python3
"""Serve the browser instrument locally; --phone adds trusted local HTTPS.

Python 3.14 is the tested project runtime. Normal mode binds localhost only.
Phone mode runs tracking and audio on the phone, with the laptop serving files.
"""

import argparse
import http.server
import sys
import urllib.request
import webbrowser
from pathlib import Path

from web.midi_bridge import MidiBridge, midi_handler
from web.phone_server import phone_host, serve_phone

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
VENDOR = WEB / "live" / "vendor" / "mediapipe"
MP = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/"
MODEL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_{m}/float16/latest/pose_landmarker_{m}.task"
)
GESTURE_MODEL = (
    "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/"
    "gesture_recognizer/float16/latest/gesture_recognizer.task"
)
FILES = ["vision_bundle.mjs"] + [
    f"wasm/vision_wasm{variant}_internal.{extension}"
    for variant in ("", "_module", "_nosimd")
    for extension in ("js", "wasm")
]


def offline() -> None:
    """Explicitly download pose/gesture assets; imports and normal starts do not download."""
    (VENDOR / "wasm").mkdir(parents=True, exist_ok=True)
    jobs = [(MP + name, VENDOR / name) for name in FILES]
    jobs += [
        (MODEL.format(m=model), VENDOR / f"pose_landmarker_{model}.task")
        for model in ("lite", "full", "heavy")
    ]
    jobs.append((GESTURE_MODEL, VENDOR / "gesture_recognizer.task"))
    for url, destination in jobs:
        if not destination.exists():
            print("get", destination.relative_to(ROOT))
            urllib.request.urlretrieve(url, destination)
    print("offline copy ready:", VENDOR.relative_to(ROOT))


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true", help="download browser model assets")
    parser.add_argument("--port", type=int, default=5092)
    parser.add_argument("--phone", action="store_true", help="serve local HTTPS for iPhone Safari")
    parser.add_argument("--phone-host", help="laptop LAN IPv4 address (auto-detected by default)")
    parser.add_argument(
        "--setup-port", type=int, help="certificate setup HTTP port (default: port + 1)"
    )
    parser.add_argument(
        "--no-browser", action="store_true", help="print URLs without opening a browser"
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
    args = parse_args(argv)
    try:
        if args.offline:
            offline()
        if args.phone:
            host = phone_host(args.phone_host)
            serve_phone(WEB, ROOT / "output" / "phone", host, args.port, args.setup_port)
        else:
            bridge = MidiBridge()
            try:
                handler = midi_handler(bridge, str(WEB))
                with http.server.ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
                    bridge.start()
                    url = f"http://127.0.0.1:{args.port}/live/"
                    print(url, flush=True)
                    if not args.no_browser:
                        webbrowser.open(url)
                    server.serve_forever()
            finally:
                bridge.close()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    except (OSError, RuntimeError, ValueError) as error:
        print(f"Could not start live server: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
