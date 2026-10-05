# Run Anthony's Python instrument

From the repository root, on the tested Windows / Python 3.14 workstation:

```powershell
# The .venv and models were prepared locally during implementation.
.venv/Scripts/python.exe -m instrument --demo
.venv/Scripts/python.exe -m instrument --camera 0
```

The demo plays a scripted 15-second sequence; camera mode responds to your hands.
Add `--mute` to disable playback. Add `--style light` for chord-root-colored glow.
Camera input is mirrored before inference and display. Keep shoulders, hips and
both hands visible, with hands large enough in the image for reliable recognition.
This initial tracker uses full-frame recognition; the browser's far-hand crop mode
has not been adapted. Gesture and body confidence loss disables musical actions.

## Controls

- Start with recognized open/non-fist hands for at least 0.20 seconds to arm.
- Move the hands' midpoint into a root sector: C at screen right, then C#, D,
  Eb, E, F, F#, G, Ab, A, Bb, B clockwise. Hold 0.35 seconds. The center dead
  zone holds your root. Root labels are guides; sectors extend beyond the labels.
- Close either fist for 0.35 seconds; the controller waits another 0.25 seconds
  for a nearby second fist. One deliberate closure toggles root locking. Reopen
  stably before the next toggle. Root is captured at stable closure, not after
  the arbitration delay. Both distant fists count as one action in that window.
- Change quality: Open Palm = major, Pointing Up = minor, Victory = 7,
  Thumb Up = maj7, Thumb Down = m7, ILoveYou = m(maj7). Hold 0.35 seconds.
  The right model-labeled hand wins conflicting quality gestures. Root remains
  fixed while locked; quality stays editable. Open Palm reopening also selects major.
- Close both fists within 0.6 torso lengths to split. The split takes priority
  and preserves the lock state. Reopening keeps two balls. M explicitly merges.
- R resets; S switches fire/light; Q or Escape quits. Closing the window quits too.
- Tracking loss silences sound with a short fade, hides unavailable visuals,
  cancels pending actions, and preserves chord/lock/split. Reopen to rearm after loss.

The sphere gain follows wrist radius / torso length / 1.5, clamped to [0,1],
raised to exponent 1.5 (Joseph's gentle mapping). Split shares that gain, so it
does not double loudness. `--config` can override the dataclass defaults, e.g.:

```json
{"close_s": 0.35, "arbitration_s": 0.25, "split_torsos": 0.6, "gain_exponent": 3.0}
```

All durations are seconds; proximity/dead-zone values are torso lengths. Frame
gaps above 0.20 seconds reset gesture candidates, so slow inference may require
tuning `max_gap_s` and the dwell values together after a real performer trial.
The visible central dead-zone guide uses the same configured threshold as root selection.

## Headless validation and local exports

```powershell
.venv/Scripts/python.exe -m instrument --demo --headless --output output/anthony-instrument/demo
.venv/Scripts/python.exe -m instrument --replay output/anthony-instrument/demo/frames.jsonl --headless
.venv/Scripts/python.exe -m instrument --video videos/example.mp4 --headless --output output/anthony-instrument/video
.venv/Scripts/python.exe -m instrument --model-smoke
```

Headless mode never opens a display or audio device. Exports include frames.jsonl,
states.jsonl, preview.avi, chords.wav, representative PNGs and summary.json.
Only processed observations are replayed, not camera images. All artifacts remain
local and ignored by Git. CLI output reports separate controller, renderer and
inference p95 times. Inference is zero in synthetic replay because no CV model runs.
Diagnostic AVI uses fixed `--fps`; camera stalls can make it diverge from real
source timing. JSONL timestamps are authoritative; WAV applies an observation from
its timestamp onward and gives the final observation one nominal frame interval.
Irregular gaps retain the preceding observation until the next timestamp; a loss
observation with gain zero starts the normal release fade. Playback and exports
therefore cannot infer the exact moment that tracking disappeared between frames.

## Setup on a fresh machine

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements-instrument-lock.txt
.venv/Scripts/python.exe scripts/setup_instrument_models.py
```

The lock file reproduces the full tested Windows environment, including tools.
For just runtime dependencies use requirements-instrument.txt; add
requirements-dev.txt for development. Other Python/platform combinations require
separate validation. The model helper explicitly downloads two public artifacts
into output/models, verifies their recorded SHA-256 hashes, and records provenance.
It performs no project upload. Runtime never downloads models; you can provide
existing models with `--models PATH`. Subsequent runs work offline.

```powershell
.venv/Scripts/python.exe -m pytest -q
.venv/Scripts/ruff.exe check instrument tests scripts
.venv/Scripts/ruff.exe format --check instrument tests scripts
.venv/Scripts/mypy.exe
```

See [decisions.md](decisions.md) for provisional choices and [evidence.md](evidence.md)
for measured results and remaining human acceptance checks. This is Stage 1 only;
no browser port, true 3D, three-move spells, game or Ableton output is implemented.
