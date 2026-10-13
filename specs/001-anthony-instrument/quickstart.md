# Run Anthony's Python instrument

From the repository root, on the tested Windows / Python 3.14 workstation:

```powershell
# The .venv and models were prepared locally during implementation.
.venv/Scripts/python.exe -m instrument --demo
.venv/Scripts/python.exe -m instrument --camera 0
```

The demo plays a scripted 15-second sequence; camera mode tracks your whole body
and uses your wrists for the ball, plus detailed hand tracking for chord gestures.
Add `--mute` to disable playback, or `--volume 0.5` to halve the default audio level.
Add `--style light` for chord-root-colored glow.
Restart the Python process after code updates. Resize or maximize the native window;
it fits the entire frame while preserving its proportions. Controls occupy a separate
panel above the feed. Camera mode requests 1280x720 (the device may negotiate another
mode); override with --camera-width and --camera-height if needed. Diagnostics report
source_size_px and preview_size_px; the latter includes the 450-pixel controls panel.
Larger text uses a dark outline and shadow for readability over the camera feed.
The top LEFT HAND / RIGHT HAND readouts show confirmed gestures in large text;
Seeing shows each raw model result and confidence. UNKNOWN, wrist-only and NOT SEEN
states distinguish missing gestures from missing hands.
Camera input is mirrored before inference and display. Live hand labels and chord
controls swap the pose-side assignments: L uses wrist 16, R uses wrist 15, with
matching elbow crops. This follows Anthony's requested left/right correction;
crossing hands preserves their identities. Existing JSONL replays retain their
recorded L/R labels; record a new camera session for corrected hand assignments.
Keep shoulders, hips and
both hands visible, with hands large enough in the image for reliable recognition.
The skeleton shows available body joints, including legs and feet. Hand recognition
uses web/main far mode's alternating wrist-centered 256-pixel crops. Palms do not
have to face the camera for the ball or sound: reliable body wrists suffice. A 40ms causal position
filter reduces jitter; uncertain joints disappear immediately. Gesture recognition
still depends on visible finger details. Reliable shoulders and hips provide torso
scale; missing torso or either wrist mutes sound. No body pose is fabricated.

## Controls

- Start with open/non-fist hands for about 0.60 seconds to recognize and arm.
- **Interval mode is now the default. T toggles interval / midpoint mode.** Hold
  both wrists in the L CENTER / R CENTER circles for 0.20s, then hold a directional
  pair for 0.35s to move the current root once. Return both hands to center to rearm.
  Left hand left + right hand up = fifth up; both up/down = octave up/down.
  See the [full interval map](relative-root.md). Finger signs still choose quality;
  root lock freezes interval and octave changes. The top panel shows the candidate
  change and its progress. R resets register/chord while retaining the active mode.
- In **midpoint mode**, move the hands' midpoint into a root sector: C at screen right, then C#, D,
  Eb, E, F, F#, G, Ab, A, Bb, B clockwise. Hold 0.35 seconds. The center dead
  zone holds your root. Root labels are guides; sectors extend beyond the labels.
- Close either fist while the other hand shows a non-palm sign, or close both
  fists while apart, for 0.35 seconds; the controller waits another 0.25 seconds
  for a nearby second fist. One deliberate closure toggles root locking. Reopen
  stably before the next toggle. Root is captured at stable closure, not after
  the arbitration delay. Both distant fists count as one action in that window.
  The HUD shows ROOT LOCKING... while pending and ROOT LOCKED after confirmation;
  ROOT LOCKED stays visible after reopening until another deliberate fist toggle.
  Canned labels at confidence >=0.5 must persist for 0.35 seconds before a change
  is accepted, exactly as web/main. The confirmed label appears above the raw
  classifier result. Brief raw alternation retains the confirmed label; joint
  shape never turns None into a fist. This replaces the earlier joint fallback.
- Change quality with both hands using the approved 25-cell table in
  [chord-map.md](chord-map.md) or [Feature Tutorials](../../docs/FEATURE_TUTORIALS.md).
  Point = index finger up, other three fingers curled, thumb tucked. With left palm,
  right Point = minor, right thumb up = maj7, right thumb down = m7, right V = dim7.
  Left V + right palm = m7b5. Right up + left down = m(maj7); reversed thumbs = 7.
  Left Point + right palm now = m6, left thumb up + right palm = 6, left thumb down
  + right palm = 6/9; both V signs = aug. These replace the old redundant shortcuts.
  All 25 pairs have different qualities (300 chords across 12 roots); extensions
  play fuller five/six-note voicings. Love/heart is disabled. Hold 0.35 seconds
  after gesture recognition (about 0.70 seconds total).
  Both recognized non-fist signs are required. Unknown/low-confidence/missing
  signs or fists cannot select a quality; they hold the previous quality.
  Crossing hands preserves their body identities. The quality
  persists through relaxed hands, unknown gestures and tracking loss. To return
  to major, hold BOTH recognized Open Palms continuously for 1.5 seconds.
  Root remains fixed while locked; quality stays editable.
- Close both fists within 1.0 torso lengths to split. The split takes priority
  and preserves the lock state. Fists confirmed while apart can also be brought
  together afterward to split, including after root locking. The HUD says TWO BALLS;
  spread your hands to see both. Reopen, then repeat the same nearby two-fist
  gesture to merge: the HUD returns to ONE BALL. Holding fists changes mode once;
  reopening alone preserves it. Both directions preserve the chord and root lock.
  M also merges and requires reopening before another split or transfer.
- **Fist + open palm transfers from palm to fist** after closure/arbitration,
  without toggling root lock. The ball stays attached after relaxing; the HUD
  identifies its owner. Size (in torso units) and loudness are captured at transfer.
  Reopen and reverse the pair to transfer back, including collecting split balls.
  In split mode the fist absorbs the palm ball's area: two radius-40 balls become
  one of radius ~57. Shared gain is retained; held gestures cannot repeatedly grow it.
  **Both closed fists within 1.0 torso length merge an owned ball to midpoint**,
  using the same merge gesture as split mode. M returns to midpoint; R resets.
  Missing owner/torso hides and mutes the ball; the other wrist is optional.
  Pair changes/loss during arbitration cancel transfer; reopen to retry.
  Older recordings using fist+palm for root lock now replay as transfers;
  record fist/non-palm or distant two fists for lock/unlock with this version.
  Saved old state logs can therefore differ even though frame files remain readable.
  The receiver is now the fist; recordings made with the earlier palm receiver
  likewise replay with the corrected ownership direction.
- T switches root mode; R resets; S switches fire/light; Q or Escape quits. Closing the window quits too.
- With MIDI enabled, P pauses/resumes MIDI and its extra 44px HUD row shows the
  named cable, channel and active note/chord pitches. Pausing releases every note.
- Body/wrist loss silences sound with a short fade and hides unavailable visuals.
  Hand-detail loss retains the last detection for up to 0.4 seconds, as in web/main,
  then cancels pending gesture actions while body wrists can keep the ball/sound active.
  Both preserve chord/lock/ball mode/owner. Reopen to rearm after gesture loss.

The sphere gain follows wrist radius / torso length / 0.75, clamped to [0,1],
raised to exponent 1.5. The smaller reference radius and higher synth level make
ordinary hand spacing about 21 dB louder than the original prototype. Closing the
hands still fades toward silence in midpoint/split modes. Split shares the gain
and does not double it. One-hand mode retains the captured gain.
`--volume` scales both playback and WAV exports in [0,1]. `--config` can override
the dataclass defaults, e.g.:

```json
{"major_dwell_s": 1.5, "gain_radius_torsos": 0.75, "gain_exponent": 1.5}
```

All durations are seconds; proximity/dead-zone values are torso lengths. Frame
gaps above 0.20 seconds reset controller gesture candidates, so slow inference may require
tuning `max_gap_s` and the dwell values together after a real performer trial.
The visible central dead-zone guide uses the same configured threshold as root selection.

## Direct chord Ableton output (macOS)

```bash
.venv/bin/python -m pip install -r requirements/midi.txt
.venv/bin/python -m instrument --camera 0 --midi-chords --mute
.venv/bin/python -m instrument --demo --midi-chords --mute
```

Use **dance2music - Chords to Ableton**, channel 1, Track enabled and a monitored
polyphonic synth. All current chord tones hold while the ball has positive gain;
quality/root/register changes replace the entire voicing. P pauses/resumes;
tracking loss and exit release all notes. Resume uses the latest active chord.
This is direct synth input; no Expressive Chords mapping is involved. The cable
exists only while running. Use `--midi-chords --midi-port "exact name"` for an
existing IAC/loopMIDI destination. Full
[tutorial](../../docs/FEATURE_TUTORIALS.md#play-sustained-chords-in-ableton).

## Single-note Ableton output (macOS)

```bash
.venv/bin/python -m pip install -r requirements/midi.txt
.venv/bin/python -m instrument --camera 0 --midi --mute
# No camera/models needed for this connection test:
.venv/bin/python -m instrument --demo --midi --mute
```

The active source is **dance2music - Notes to Ableton**, channel 1, velocity 96.
It is created automatically and removed at exit. Select that input in Ableton,
enable Track and monitor/arm a MIDI track with an instrument. One root note holds
while the ball has positive gain; root/octave changes replace it, loss releases
it, recovery resumes it, and quality changes leave it held. Use `--midi-chords`
instead for full voicings. See [setup and troubleshooting](../../docs/FEATURE_TUTORIALS.md#play-one-root-note-in-ableton)
and the [contract](midi-output.md). `--midi-channel` / `--midi-velocity` override defaults.
`--list-midi-ports` lists existing destinations; `--midi-port "exact name"` enables
that route instead of the automatic source. Windows needs a named loopMIDI cable.
`--mute` and `--volume` affect local audio only. Tested MIDI dependency: RtMidi 1.5.8
on macOS arm64/Python 3.11.17; other platforms require validation.

## Headless validation and local exports

```powershell
.venv/Scripts/python.exe -m instrument --demo --headless --output output/anthony-instrument/demo
.venv/Scripts/python.exe -m instrument --replay output/anthony-instrument/demo/frames.jsonl --headless
.venv/Scripts/python.exe -m instrument --video videos/example.mp4 --headless --output output/anthony-instrument/video
.venv/Scripts/python.exe -m instrument --model-smoke
```

Headless mode never opens a display or audio device. Explicit --midi/--midi-chords opens
a MIDI port and follows source timing; device-free headless runs remain fast.
Exports include frames.jsonl,
states.jsonl, preview.avi, chords.wav, representative PNGs and summary.json.
MIDI-enabled exports also include midi.jsonl with exact bytes and source timestamps,
including cleanup. Summary reports MIDI port/channel/velocity/count/update p95.
Only processed observations are replayed, not camera images. Optional pose_landmarks
contains 33 pixel points, with null for unavailable joints; older replays without
that field remain valid. Camera hands store confirmed gesture/confidence plus
raw_gesture/raw_confidence and gesture_since (candidate start, elapsed seconds),
so replay does not apply closure dwell twice. Older raw-label replays still work;
obsolete fist_closed/fingers_open flags are ignored, so old joint-only None
closures intentionally no longer cause actions.
All artifacts remain
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
.venv/Scripts/python.exe -m pip install -r requirements/instrument-lock.txt
.venv/Scripts/python.exe -m instrument.setup_models
```

The lock file reproduces the full tested Windows environment, including tools.
For just runtime dependencies use requirements/instrument.txt; add
requirements/dev.txt for development. Other Python/platform combinations require
separate validation. The model helper explicitly downloads two public artifacts
into output/models, verifies their recorded SHA-256 hashes, and records provenance.
It performs no project upload. Runtime never downloads models; you can provide
existing models with `--models PATH`. Subsequent runs work offline.

```powershell
.venv/Scripts/python.exe -m pytest -q
.venv/Scripts/ruff.exe check instrument tests
.venv/Scripts/ruff.exe format --check instrument tests
.venv/Scripts/mypy.exe
```

See [decisions.md](decisions.md) for provisional choices and [evidence.md](evidence.md)
for measured results and remaining human acceptance checks. This is Stage 1 only;
true 3D, three-move spells and games remain deferred. Native root/chord MIDI
and the browser translation are implemented; live acceptance remains pending.
# Browser translation

The implemented native controls are also available in the JavaScript app by
Anthony's explicit 2026-10-13 request. Run `python live.py`, select **Anthony
instrument**, and Start. For iPhone tracking and sound, use `python live.py --phone`
and follow its local certificate setup URL. See the
[browser/iPhone tutorial](../../docs/FEATURE_TUTORIALS.md#play-anthonys-instrument-in-the-browser)
and [port contract](web-port.md). The native commands below remain supported.

For desktop Ableton output, use the browser's **Ableton / MIDI** section, connect
your virtual MIDI port, choose all chord notes or one root note, and select MIDI
only or Browser + MIDI. See the
[desktop MIDI tutorial](../../docs/FEATURE_TUTORIALS.md#desktop-browser-midi-to-ableton).
