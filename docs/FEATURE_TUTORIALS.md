# Feature Tutorials

## Repository layout and moved commands

Run all commands from the repository root. Guides and ideas live in `docs/`;
feature specifications and evidence remain in `specs/`. The original pipeline
commands and `python -m instrument` keep their existing entry points.

The additional dependency files and model helper moved on 2026-10-05:

| Previous path | Current path or command |
| --- | --- |
| `requirements-dev.txt` | `requirements/dev.txt` |
| `requirements-instrument.txt` | `requirements/instrument.txt` |
| `requirements-instrument-lock.txt` | `requirements/instrument-lock.txt` (tested Windows environment) |
| `python scripts/setup_instrument_models.py` | `python -m instrument.setup_models` |

After activating your environment, install development tools with
`python -m pip install -r requirements/dev.txt`. For native instrument runtime
dependencies use `requirements/instrument.txt`. Model setup remains explicit;
`python -m instrument.setup_models --directory output/models` downloads and verifies
the models, and `--help` shows its options without downloading anything.

## Spec Kit on macOS and Windows

Invoke the same `$speckit-constitution`, `$speckit-plan`, `$speckit-tasks`, and other
Spec Kit skills on either platform. The shared skills select the official Bash helpers on
macOS/Linux and PowerShell helpers on Windows. macOS does not require PowerShell.

Both use `.specify/memory/constitution.md`, the templates under `.specify/templates/`,
and feature documents under `specs/`. Both helper sets were copied unchanged from the
installed `specify-cli` 1.1.0 bundle, keeping their logic at the same upstream version.
Do not maintain separate Mac and Windows copies of these documents.

The current feature is selected locally in ignored `.specify/feature.json`. This checkout
selects `specs/001-anthony-instrument`. Use repository-relative paths with forward slashes
for portability. Each checkout keeps its own selection while sharing feature documents.
The `script: ps` initialization metadata records how this project was originally installed;
the shared skills choose the native shell at execution time.

When upgrading Spec Kit, refresh both official helper sets together and preserve the skills'
platform selection and project amendments. Run `python -m unittest tests.test_speckit_scripts`
to check the helpers available on that machine. Preset-composition checks also need PyYAML,
which is included in the Specify CLI's own environment.

## Python environment on macOS

From the repository root, using Python 3.11:

```sh
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m pip check
```

Activate with `source .venv/bin/activate` in each new terminal; use `deactivate`
to leave the environment. On macOS, use `.venv/bin/python` in place of the
Windows `.venv/Scripts/python.exe` commands below. The native instrument's
separate requirements and model setup are documented in the quickstart.

## Start the Python instrument

Run from the repository root:

```powershell
.venv/Scripts/python.exe -m instrument --camera 0
# Scripted demo:
.venv/Scripts/python.exe -m instrument --demo
```

Keep shoulders, hips and both hands visible. Open your hands for at least
about 0.60 seconds before using fist controls (recognition plus rearming).
Add `--mute` to disable sound.
Whole-body joints are drawn, including visible legs and feet. The ball uses body
wrists even when palms face sideways. Detailed hand recognition uses wrist crops
for smaller hands; missing hand details do not hide a ball supported by body wrists.
Add `--volume 0.5` to halve playback and exported WAV volume.
Restart after code changes. Resize/maximize the native window to see the complete
camera frame; the controls are above the image. Camera mode requests 1280x720.
Use --camera-width / --camera-height to request another supported device mode.
Hand diagnostic text and root notes use larger, bold black lettering with a light
outline so they remain readable against the camera image and ball glow.
Fresh-machine setup: [quickstart](../specs/001-anthony-instrument/quickstart.md).

## 0 — Lock a chord root

1. Select a root using the ring below. Keep your hands apart.
2. Close either fist and hold about **0.60 seconds** to lock the root.
   The display confirms **ROOT LOCKED**; it stays visible when you reopen.
   Detection matches web/main's **far** mode: alternating wrist crops, a 0.5
   confidence threshold, and 0.35 seconds to confirm label changes. The first line
   under a hand is the confirmed gesture; **raw** below shows the classifier result.
   Brief raw None/fist alternation retains the last confirmed label. A new fist
   must first be consistently recognized for 0.35s. Joint shape does not override
   None. Missing detections are tolerated for 0.4s, then gesture actions cancel.
3. Reopen. Move freely or change chord quality; the root stays locked.
4. Close a fist again to unlock. Reopen between each toggle.

Nearby two fists toggle split/merge instead of root lock.

## 1 — Control and split the ball

- Move both hands: the ball follows their midpoint.
- Spread your hands: the ball grows and sound gets louder.
- Start with open hands for about **0.60 seconds**, then close both fists and
  bring them together. Keep wrist spacing within 0.6 times your shoulder-to-hip
  distance. Both fists must be confirmed for **0.35 seconds**; they can be
  recognized while apart and brought together afterward, even after root locking.
  The top panel confirms **TWO BALLS**. Spread your hands to see them clearly.
- Reopen: the two balls stay attached to your hands and share the chord.
- Repeat the same nearby two-fist gesture to **merge into one ball**. Reopen
  between gestures; holding fists produces only one change. The panel confirms
  **ONE BALL** after merging. Both directions preserve the chord and root lock.
- Press **M** to merge; reopen before another split. **S** switches fire/light appearance.

## 2 — Choose roots and chord qualities

Move your hands' midpoint toward a labeled root and hold **0.35 seconds**.
C is on the right; the 12 roots run clockwise. The central circle holds your root.

Hold a quality gesture for **0.35 seconds**:

| Gesture | Quality |
| --- | --- |
| Both palms open continuously for **1.5 seconds** | Major |
| Index pointing up | Minor |
| Right Victory / V sign + left open palm | Diminished seventh (dim7) |
| Left Victory / V sign + right open palm | Half-diminished seventh (m7b5) |
| Thumb up | Major seventh (maj7) |
| Thumb down | Minor seventh (m7) |
| Right thumb up + left thumb down | Minor-major seventh (m(maj7)) |
| Right thumb down + left thumb up | Dominant seventh (7) |

Quality works while the root is locked and stays selected until a new deliberate
gesture. A resting palm does not override the other hand. If two non-palm quality
gestures disagree, an explicitly mapped pair takes priority; otherwise the body
hand labeled **R** wins among supported single-hand shortcuts. Hand identity follows
the body, including when hands cross; it does not mean the right side of the screen.
Victory needs the opposite open palm. The love/heart sign is ignored entirely.
Brief reopening holds the
quality; both recognized palms held for 1.5 seconds explicitly return to major.

The current catalogue has eight qualities across 12 roots (96 chords). Five usable
chord signs per hand give 25 ordered pair slots, potentially 300 chords if every
slot is assigned a different quality. Those 25 distinct qualities are not implemented:
the remaining pair assignments need design decisions. Fists remain ball/lock controls.

## Save, replay or use video

```powershell
# Save observations, states, preview video, WAV and images:
.venv/Scripts/python.exe -m instrument --camera 0 --output output/instrument-session
# Replay those observations:
.venv/Scripts/python.exe -m instrument --replay output/instrument-session/frames.jsonl
# Track an existing video (replace the path):
.venv/Scripts/python.exe -m instrument --video videos/example.mp4
```

## Reset or quit

**R:** reset to C major, unlocked, one ball. **Q / Escape:** quit.
Body/wrist loss mutes sound; hand-detail loss preserves the body-driven ball and
audio. Reopen your hands after gesture tracking returns before another fist toggle.
