# Relative root controls — revised 2026-10-15

Anthony approved separate-hand interval controls as the default and requested a
keyboard switch to the original midpoint selector. **T** toggles **INTERVAL** and
**MIDPOINT**, preserving chord, notes, register, root lock and ball mode. **R** resets
chord/register/lock/ball state but retains the active root mode. CLI
`--root-mode midpoint` or `--root-mode interval` overrides Config's startup mode.
Replay frame metadata takes precedence over startup mode. The authorized website
translation uses the same stored-ID map; its display aliases are described below.

## Symmetric interval revision, 2026-10-15

Anthony requested opposing gestures to reverse the same interval, explicitly
both left = fourth down and both right = fourth up. He corrected the initial
proposal: **left + up reverses with left + down**, and right + up reverses with
right + down. For mixed pairs, retain the horizontal direction and flip only
the vertical direction, whichever hand supplies it. Horizontal-only and
vertical-only pairs reverse both directions. Preserve octaves and all 12 pitch
classes; use ±1, ±2, ±3, ±4, ±5, ±6, ±7 and ±12 once each.

Python is validated first; then update the existing explicitly requested website
mapping and its chart. Tracking IDs, mirrored display aliases, neutral/dwell,
root bounds, quality gestures and MIDI lifecycle remain unchanged. Tests cover
all 16 pairs at all 12 roots, exact voicing round trips and Python/JS parity.
This is a table correction within the existing feature, with no new architecture.

## Approved native map

Each position is relative to that hand's own chest-height origin. Directions use
mirrored screen axes; hand identity follows corrected body joints across crossings.
Finger signs still select chord quality independently.
The full map and C → G → D walkthrough are also in
[Feature Tutorials](../../docs/FEATURE_TUTORIALS.md#relative-roots-and-switching-modes).
One-hand ball mode still needs both wrists for intervals; fist+palm transfers to
the fist and blocks interval input until both hands return to neutral.

| Left-hand direction / right-hand direction | Left | Right | Up | Down |
| --- | --- | --- | --- | --- |
| Left | Fourth down −5 | Whole step up +2 | Fifth up +7 | Fifth down −7 |
| Right | Whole step down −2 | Fourth up +5 | Half step up +1 | Half step down −1 |
| Up | Minor third down −3 | Major third up +4 | Octave up +12 | Tritone down −6 |
| Down | Minor third up +3 | Major third down −4 | Tritone up +6 | Octave down −12 |

The reference is the **current** root. C3 with left-left/right-up becomes G3;
repeat after rearming and G3 becomes D4. C3 with left-right/right-down becomes B2.
Both up shift every sounding note up exactly an octave; both down reverse it.
A fifth up (+7) and fourth down (−5) share a note name in different octaves;
a fifth down (−7) reaches a different pitch class. Signed ±1 through ±6 reach all
12 pitch classes from every root; fifth gestures add musical shortcuts.

## Website displayed-hand map

The website displays internal R as L and internal L as R. This is a writing-only
alias; backend handedness stays correct. Rows/columns in the following table use
those displayed names, matching the on-page interval chart:

| Displayed left hand / displayed right hand | Left | Right | Up | Down |
| --- | --- | --- | --- | --- |
| Left | Fourth down −5 | Whole step down −2 | Minor third down −3 | Minor third up +3 |
| Right | Whole step up +2 | Fourth up +5 | Major third up +4 | Major third down −4 |
| Up | Fifth up +7 | Half step up +1 | Octave up +12 | Tritone up +6 |
| Down | Fifth down −7 | Half step down −1 | Tritone down −6 | Octave down −12 |

For example, displayed left hand left + right hand up/down is a minor third
down/up. Displayed left hand up/down + right hand left is a fifth up/down.
The native C → G → D exercise above uses native labels, not these display aliases.

## Position, timing and recovery

Origins use the corrected shoulder x and torso-center y: L shoulder 12, R shoulder
11. Outlined **L CENTER / R CENTER** circles show the neutral positions. Skeleton-free
synthetic/older input uses x offsets ±0.3 torso lengths from torso center. If a
present skeleton lacks a required shoulder, its origin is unavailable.

- Hold both wrists in their center circles for **0.20s** to arm.
- Hold the same cardinal direction pair for **0.35s** to apply **one** step.
- Return both hands to center to rearm. Holding or changing directly to another
  pair never repeats. The top panel shows mode, root/octave, directions, target,
  dwell progress and return-to-center feedback.
- Fists, pending lock/split, root lock, missing required body points/wrists and gaps
  above 0.20s disarm and cancel pending intervals. Return to center after recovery.
  Finger-detail loss alone permits body-position controls; it cannot change quality
  or create fist actions.
- Neutral radius: **0.25 torso lengths** (`interval_neutral_torsos`). Outside it,
  one axis must exceed the other by **1.25** (`interval_axis_ratio`). Ambiguous
  diagonals cannot select a pair. Timing uses `root_dwell_s` and `interval_rearm_s`.

These initial thresholds require performer validation. Translation/camera distance
changes preserve directions when body geometry scales together. No depth or body
rotation compensation is claimed; smoothing/inference adds latency.

## Register and replay

The controller stores absolute MIDI root separately from pitch class. Each interval
transposes every sounding note by the exact signed amount. Quality changes use
octave-shifted bounded voice leading, preserving root register. Midpoint mode retains
the current register and original ring/voice-leading rules. Root lock freezes pitch
class and register in both modes.

Roots are bounded to MIDI **0–106**, keeping all catalogue extensions (maximum +21)
available. A step outside that root range or taking a sounding voice outside MIDI
0–127 is refused with **REGISTER LIMIT** until return to center. It never wraps or
clamps into a different interval.

Exports record effective `root_mode` per frame, reproducing T switches on replay.
Older JSONL without this field uses midpoint behavior; explicit null leaves startup
mode intact. Recorded L/R identities stay as saved. Custom thresholds require the
matching replay `--config`; summary.json records initial configuration. Independent
keyboard resets/merges retain the previous replay limitation: observations alone do
not reconstruct them.

## Wider split/merge proximity

Anthony requested increasing the distance after reporting split failure. Default
`split_torsos` is **1.0**, formerly 0.6. Both fists still require confirmed closures,
reopening to rearm and reliable tracking. The same threshold applies to split/merge;
farther-apart closures retain root-lock arbitration. This changes proximity rather
than gesture-model accuracy.

## Validation

See [evidence.md](evidence.md) for final checks and synthetic artifacts. Tests cover
all signed pair/root combinations and catalogue chords, audible octave frequencies,
dwell/rearming, diagonal flicker, missing/gapped tracking, quality/register, MIDI
bounds, mode keys, old/new replay and wider split/merge. Live gesture, camera and
listening acceptance remain pending. The website/MIDI extensions are recorded in
web-port.md and desktop-midi.md; publication remains unauthorized.
