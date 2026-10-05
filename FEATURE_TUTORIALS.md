# Feature Tutorials

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
