# Validation evidence: local Python instrument

Validated on 2026-10-05 in `C:\Code\Github Serious\dance2music`, branch
`anthony-explorations`. This is Stage 1 Python implementation evidence. Performer
acceptance is separate and remains pending.

## Resume audit and environment

The specification, plan, decisions, quickstart, runtime modules and 24 tests were
already present as uncommitted work. All task checkboxes were unchecked and this
evidence file was missing. The resume audit verified existing work rather than
rewriting it. Original first-failure logs for yesterday's test-writing tasks were
not retained; no claim is made that those logs were recovered. New regressions
were run and failed before the corresponding corrections in this session.

Prerequisites resolved `specs/001-anthony-instrument`. There was no checklist
directory or `.specify/extensions.yml`; no checklist gate or extension hook applied.
Windows execution policy required a process-scoped invocation:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .specify/scripts/powershell/check-prerequisites.ps1 -Json -RequireTasks -IncludeTasks
```

Python 3.14.0 in `.venv`; NumPy 2.4.1, OpenCV 5.0.0.93, MediaPipe 1.0.1,
sounddevice 0.5.6, pytest 9.0.2, Ruff 0.14.10 and mypy 1.19.1. Runtime and
development pins match the installed environment; the full Windows environment
is recorded in requirements-instrument-lock.txt. `pip check` passed. Tests, model
smoke, demo and replay used existing local resources without network downloads.

## Automated contracts

```powershell
.venv/Scripts/python.exe -m pytest -q
.venv/Scripts/ruff.exe check instrument tests scripts
.venv/Scripts/ruff.exe format --check instrument tests scripts
.venv/Scripts/mypy.exe
.venv/Scripts/python.exe -m pip check
```

Results: **28 tests and 11 subtests passed**; Ruff passed; all 15 scoped files were
formatted; mypy found no issues in 10 source files; no broken dependencies.
The final check process required an approved retry after the sandbox helper failed
to start. That retry passed with one pytest cache-write warning; it did not affect
test results. The earlier successful run had no warning.

- US1: lock/hold/reopen/unlock, fresh root dwell, quality changes while locked,
  startup/reacquired fists, flicker, unknown labels, low scores, timestamp gaps,
  reset, concurrent distant fists and staggered nearby split arbitration.
- US2: wrist midpoint/radius, hand anchors, conservation of split area and gain,
  absent-hand silence, persistent split/explicit merge, deterministic seeded
  rendering, finite bounded images, bounded particles and configured dead-zone guide.
- US3: all 72 chord symbols and intervals, root ring/dead zone, all **5,184**
  starting-to-target chord combinations, voice-count changes, bounded MIDI
  voicings, finite/silent audio, chunk continuity and note-transition continuity.
- Integration/failure: complete headless demo and JSONL export/replay, missing
  model errors, corrupt model rejection without network, tracking identity/body
  adaptation, nonfinite confidence rejection and malformed replay line context.

Five corrections were verified with failing regressions before implementation:

1. WAV exports previously applied the new observation across the preceding gap.
   A fixture at 0, 0.12 and 1.2 seconds exposed audible samples before the 1.2-second
   gain change. Output now remains exactly silent through sample 57,599 at 48 kHz;
   the new state starts at sample 57,600. Export chunks are bounded to one second.
2. The renderer's fixed 0.25-torso dead-zone guide now follows Config, matching
   the controller when the threshold changes.
3. JSON arrays and non-string gesture values now fail with replay line context.
4. Nonfinite handedness, gesture, visibility and presence scores are rejected.
5. Noninteger/nonfinite synth sample rates fail before numerical processing.

No coverage percentage was measured or claimed; the feature specifies observable
contracts rather than a percentage threshold.

## Scripted replay, rendering and audio exports

```powershell
.venv/Scripts/python.exe -m instrument --demo --headless --output output/anthony-instrument/2026-10-05-fire
.venv/Scripts/python.exe -m instrument --demo --headless --style light --output output/anthony-instrument/2026-10-05-light
.venv/Scripts/python.exe -m instrument --replay output/anthony-instrument/2026-10-05-fire/frames.jsonl --headless --output output/anthony-instrument/2026-10-05-replay
```

Inputs: deterministic 15-second demo, 30 fps, 960x720 image, 160-pixel torso,
default Config and renderer seed 0. Each run processed 450 frames. All 450 replay
state records exactly matched the original demo. The first fire export predates
the WAV correction; its observations/states remain valid. The light and replay
exports contain the corrected audio timing.

| Source | Controller p95 | Renderer p95 | Inference p95 |
| --- | ---: | ---: | ---: |
| Demo, fire | 0.0574 ms | 9.96 ms | 0 ms (synthetic) |
| Demo, light | 0.0583 ms | 9.91 ms | 0 ms (synthetic) |
| JSONL replay, fire | 0.0572 ms | 9.47 ms | 0 ms (synthetic) |

Controller p95 satisfies the specified **<5 ms** budget. These are measurements
on this workstation, not hardware-independent guarantees. Rendering/export runs
were concurrent; they are diagnostic measurements rather than an isolated benchmark.

| Time | Observable event |
| --- | --- |
| 1.3667 s | C -> G after region dwell |
| 2.6333 s | Lock G |
| 4.3667 s | Locked G -> Gm through quality gesture |
| 7.3667 s | Gm -> G as the right hand reopens with Open_Palm |
| 7.6333 s | Unlock G |
| 8.0000 s | G -> D after fresh dwell |
| 10.3667 s | Nearby fists split; reopening preserves split |

Visually inspected replay `first.png`, `minor.png` and final split PNGs in both
styles. The merged glow follows the wrist midpoint; Gm displays ROOT LOCKED;
the final D frame displays ROOT FREE / TWO BALLS with hand-centered glows. Fire
is orange, light follows the root color, sparks are visible, and the status/control
lines are readable. Root/hand labels can overlap the glow; this is a prototype
presentation limitation, not evidence of live tracking quality.

Corrected replay WAV: mono, 48 kHz, 720,000 samples (15 seconds), peak 0.0497,
RMS 0.0180 in normalized units. Automated continuity/silence checks passed.
These numerical checks do not establish subjective musical quality.

## Models, native window, camera/video and playback

```powershell
.venv/Scripts/python.exe -m instrument --model-smoke
.venv/Scripts/python.exe -m instrument --demo --mute --seconds 2
.venv/Scripts/python.exe -m instrument --headless --mute --seconds 2 --output output/anthony-instrument/2026-10-05-camera-smoke
.venv/Scripts/python.exe -m instrument --video output/anthony-instrument/2026-10-05-replay/preview.avi --headless --seconds 2 --output output/anthony-instrument/2026-10-05-video-smoke
```

- Both local models loaded and inferred two 640x480 blank frames: 55.4 ms total,
  zero false hand detections, successful cleanup. MediaPipe emitted nonfatal
  feedback-manager/projection warnings; no model download was needed.
- Native muted demo opened and exited normally: 60 frames, controller p95
  0.0850 ms, renderer p95 7.34 ms. This verifies the window boundary and exit path;
  saved-frame inspection above supplies the visual observations.
- Camera could not open inside the sandbox. An approved retry outside it succeeded:
  19 processed frames over the requested two-second source interval, controller
  p95 0.0615 ms, renderer p95 3.37 ms, inference p95 45.1 ms. No hands or torso
  were detected in this short run. It validates capture/inference and silence,
  **not** real gesture recognition or performer timing.
- Video smoke used the synthetic AVI (no person): 60 frames, inference p95
  26.7 ms, controller p95 0.0270 ms, renderer p95 2.04 ms; completed normally.
- A default sounddevice Playback stream opened, rendered C major at gain 0.3
  for 0.30 s, released for 0.15 s and closed without reported stream errors.
  Reproduce with Playback.update((48, 52, 55), 0.3), sleep 0.30 s,
  update((), 0), sleep 0.15 s, update((), 0), then close in finally.
  This verifies the hardware boundary; no subjective listening is claimed.

| Local model | Bytes | SHA-256 |
| --- | ---: | --- |
| gesture_recognizer.task | 8,373,440 | 97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482 |
| pose_landmarker_lite.task | 5,777,746 | 59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a |

## Remaining human acceptance

Anthony should try the documented camera sequence with shoulders, hips and both
hands visible: rearm, select a root, lock, move, choose each quality, unlock,
split, reopen, merge and reset. Review the deliberate approximately 0.60-second
fist response, recognition reliability, full-frame hand size and audio quality.
No threshold or approved mapping was changed without that review.

3D/depth, animator controls, spells, games, Ableton MIDI and JavaScript translation
remain outside this increment. All code and generated artifacts stayed local.
