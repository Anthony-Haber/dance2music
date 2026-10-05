# Feature Tutorials

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
0.20 seconds before using fist controls. Add `--mute` to disable sound.
Fresh-machine setup: [quickstart](specs/001-anthony-instrument/quickstart.md).

## 0 — Lock a chord root

1. Select a root using the ring below. Keep your hands apart.
2. Close either fist and hold about **0.60 seconds** to lock the root.
3. Reopen. Move freely or change chord quality; the root stays locked.
4. Close a fist again to unlock. Reopen between each toggle.

Nearby two fists trigger split instead of lock.

## 1 — Control and split the ball

- Move both hands: the ball follows their midpoint.
- Spread your hands: the ball grows and sound gets louder.
- Bring both fists close together and hold **0.35 seconds** to split.
  Keep wrist spacing within 0.6 times your shoulder-to-hip distance.
- Reopen: the two balls stay attached to your hands and share the chord.
- Press **M** to merge; **S** to switch fire/light appearance.

## 2 — Choose roots and chord qualities

Move your hands' midpoint toward a labeled root and hold **0.35 seconds**.
C is on the right; the 12 roots run clockwise. The central circle holds your root.

Hold a quality gesture for **0.35 seconds**:

| Gesture | Quality |
| --- | --- |
| Open palm | Major |
| Index pointing up | Minor |
| Victory / V sign | Dominant seventh (7) |
| Thumb up | Major seventh (maj7) |
| Thumb down | Minor seventh (m7) |
| “I love you” sign | Minor-major seventh (m(maj7)) |

Quality works while the root is locked. If hands disagree, the hand labeled **R**
wins. Reopening with an open palm also selects major.

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
Tracking loss mutes sound; reopen your hands after tracking returns.
