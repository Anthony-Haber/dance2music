"""Explicitly fetch public MediaPipe models; never called by instrument imports."""

import argparse
import hashlib
import json
import urllib.request
from pathlib import Path

MODELS = {
    "gesture_recognizer.task": (
        "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/"
        "gesture_recognizer/float16/latest/gesture_recognizer.task"
    ),
    "pose_landmarker_lite.task": (
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
        "pose_landmarker_lite/float16/latest/pose_landmarker_lite.task"
    ),
}
MODEL_HASHES = {
    "gesture_recognizer.task": "97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482",
    "pose_landmarker_lite.task": "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a",
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=Path("output/models"))
    args = parser.parse_args()
    args.directory.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, dict[str, str | int]] = {}
    for name, url in MODELS.items():
        target = args.directory / name
        if not target.exists():
            temporary = target.with_suffix(".partial")
            print(f"Downloading {name} from its public model URL", flush=True)
            try:
                with urllib.request.urlopen(url, timeout=120) as response:
                    with temporary.open("wb") as stream:
                        while chunk := response.read(1024 * 1024):
                            stream.write(chunk)
                if temporary.stat().st_size < 1024:
                    raise ValueError(f"Downloaded {name} is unexpectedly small")
                temporary.replace(target)
            except (OSError, ValueError) as error:
                temporary.unlink(missing_ok=True)
                parser.exit(1, f"Model download failed for {name}: {error}\n")
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        if digest != MODEL_HASHES[name]:
            parser.exit(
                1, f"Model checksum mismatch for {target}; replace it with the pinned model.\n"
            )
        manifest[name] = {
            "url": url,
            "sha256": digest,
            "bytes": target.stat().st_size,
        }
        print(f"Ready: {target}", flush=True)
    (args.directory / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
