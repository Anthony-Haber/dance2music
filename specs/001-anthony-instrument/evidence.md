# Validation evidence: local Python instrument

## Ordered hand chord mappings, 2026-10-11

- Verified Anthony's selected opposite-thumb meanings, paired-sign precedence,
  quality dwell, root-lock preservation, and independence from hand tuple order
  and screen position. Right Victory with left palm selects dim7; the reverse
  selects m7b5. Both Victory signs currently hold quality.
- Disabled love/heart for quality selection and fist rearming; low-confidence
  labels cannot form a mapped pair. A reliable individual thumb shortcut remains
  available when the opposite label is unreliable, under the existing policy.
- All 96 starting musical states can reach all 96 destinations, including the
  new diminished and half-diminished sevenths. Verified symbols, pitch classes,
  complete note counts and bounded voice leading for every root and quality.
- Final instrument suite: 62 passed, 20 subtests passed. Ruff lint/format and
  mypy passed. Existing audio, tracking, CLI/replay and visual tests remain passing.
- Synthetic 2400-frame 50Hz run across 12 roots and all eight mapped selections:
  controller p95 0.0193ms and chord-change p95 0.206ms, below the 5ms budget.
  Inputs/version/results recorded in output/anthony-instrument/ordered-hand-chords/summary.json.
- Performer camera and listening acceptance for these new mappings remains pending.
  No recognition model training or threshold changes. Catalogue/mapping changes
  use existing modules and data flow; no graph refresh under constitution VIII.

## Same fist gesture splits and merges, 2026-10-11

- Added tests for split -> reopen -> merge -> reopen -> split, exactly one event
  per held closure, chord/root-lock preservation, and gesture loss requiring
  reopening before a merge. The merge assertions failed before the implementation.
- Added integration coverage with alternating per-hand recognition, raw None
  flicker after confirmation, and exact JSONL replay equality including merge events.
- Final instrument suite: 58 passed, 16 subtests passed. Ruff lint/format, mypy and
  targeted Git whitespace checks passed. No cameras or model downloads required.
- Rendered/inspected output/anthony-instrument/fist-split-merge/comparison.png:
  TWO BALLS -> ONE BALL -> TWO BALLS with the updated nearby-fist control hint.
  Synthetic frames at 20ms intervals produce changes at 1.16, 2.96 and 4.76s,
  approximately 0.36s from each raw closure, under the existing dwell plus frame
  sampling. Controller p95 0.048ms (<5ms budget).
- Live performer acceptance remains pending. Model confidence and distance/dwell
  thresholds remain unchanged. This small mapping change does not change module
  relationships or data flow; no graph refresh is required by constitution VIII.

## Split after fist approach regression, 2026-10-11

- Reproduced before correction: recognize open hands, close both while apart,
  wait for root lock, then bring the held fists within 0.6 torso lengths. Both
  fists remain confirmed but split stays false. The new regression failed before
  the fix and passes afterward.
- Corrected closure eligibility persists through completed lock arbitration while
  the recognized fist is held. Tests cover alternating per-hand model observations,
  persistent two-ball output, lock preservation, merge/reopen, startup and gesture loss.
- All instrument tests: 55 passed, 16 subtests passed. Ruff lint/format and mypy
  passed. Initial sandbox replay tests were blocked from writing temporary files;
  the authorized rerun passed.
- Inspected the synthetic rendered comparison in
  output/anthony-instrument/split-after-approach/comparison.png: ONE BALL before
  approach and two distinct wrist-anchored balls after split and reopening, with
  ROOT LOCKED retained. Synthetic 20ms frame cadence; split occurs on the first
  nearby frame at 2.0s after prior fist dwell. Controller p95 0.041ms (<5ms budget).
- No live fist capture was performed; the controller fix does not establish model
  recognition accuracy. Restart and retest the live approach. This is a minor
  state correction, so the graph was not refreshed under constitution VIII.

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
is recorded in requirements/instrument-lock.txt. `pip check` passed. Tests, model
smoke, demo and replay used existing local resources without network downloads.

## Automated contracts

```powershell
.venv/Scripts/python.exe -m pytest -q
.venv/Scripts/ruff.exe check instrument tests
.venv/Scripts/ruff.exe format --check instrument tests
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

## 2026-10-11 performer corrections

Anthony reported poor hand tracking, a front-palm-dependent ball, low volume, quality
reset on relaxation, None-labeled fists with visible finger lines, and an incomplete
camera view. He requested whole-body detection like the website and ROOT LOCKED
feedback. He chose both open palms held 1.5s to return to major and retained nearby
fist split priority. Decisions and usage are updated in the companion documents.

### Automated checks

```powershell
.venv/Scripts/python.exe -m pytest -q --ignore=tests/test_speckit_scripts.py
.venv/Scripts/ruff.exe check instrument tests
.venv/Scripts/ruff.exe format --check instrument tests
.venv/Scripts/mypy.exe
```

49 instrument tests passed, with 32 subtests. Ruff lint/format passed; mypy passed
for all ten source files. New coverage includes body-only ball/audio, missing-joint
clearing, crop padding/remapping and overlap rejection, causal position smoothing,
quality persistence and two-palm timing, complete 5,184 chord transitions, audible
RMS/headroom/continuity, full-camera pixel preservation below the panel, lock-label
confirmation, model cleanup, geometric fists/extended fingers/rotated hands, thumb
and point exclusions, None-label rearming without major selection, and replay flags.

An isolated copy of HEAD's instrument under ignored output reproduced all three
reported regressions with the new tests: a left minor gesture was overridden by the
right resting palm; ordinary spacing gave RMS 0.0098667 (-40.12 dBFS); a fist with
curled 3D joints retained the model's None label. Pre-fix rendering also overwrote the
upper camera rows. The corrected tests pass without changing the real checkout to
the baseline. No reset, stash, commit, push or branch switch was used.

The wider repository suite initially hit Windows' disabled PowerShell scripts. A
rerun allowing scripts only in that test process reached 46 passes and 2 skips, but
two existing Spec Kit tests failed on CRLF-versus-LF template strings. Those helpers
and tests are unchanged; this unrelated issue remains. Instrument checks were run
again after the later fist/full-view corrections, with the 49-test result above.

### Device and rendered evidence

- Native model smoke passed: both blank full-frame observations produced zero hands;
  the final run measured 45.5 ms for two observations. Models/versions are unchanged.
- Both real per-hand crop recognizers processed 20 blank observations with synthetic
  body geometry. Crop-pair p95 after two warmup frames: 23.34 ms. This verifies crop
  coordinates/model dispatch, not pose inference or gesture accuracy.
- The final 15-second headless demo exported 450 frames, ended D/unlocked/split,
  and retained the lock/unlock/split/chord sequence. Controller p95: 0.0836 ms
  (below the spec's 5 ms replay budget); renderer p95: 8.65 ms. Camera-space input
  was 960x720 and preview 960x830, preserving all input rows below the 110px panel.
- A four-second muted camera check passed on Windows DirectShow/MJPEG: 41 frames,
  actual capture 1280x720, preview 1280x830, controller p95 0.0646 ms, renderer
  p95 6.87 ms, inference p95 45.86 ms. Body results and two wrists were present
  in all 41 observations; reliable torso in 39. There were 16 detailed-hand
  observations and one joint-fist match. No ground-truth accuracy is inferred.
  The default Media Foundation backend had stopped supplying frames at the wider
  mode; DirectShow resolved that observed failure. Camera access required the
  authorized run outside the filesystem sandbox. Captures remain local and ignored.
- Ordinary 140px wrist spacing / 160px torso now has gain 0.44553, sustained RMS
  -19.29 dBFS, peak 0.27752: 20.83 dB above the pre-fix example. Maximum output
  remains bounded at 0.7 and silence/continuity tests pass. --volume 0.5 halves
  samples; zero master volume is silent. A sounddevice stream opened, rendered at
  reduced check volume, released and closed successfully; subjective sound is pending.
- Inspected synthetic body/wrist and confirmed geometric-fist/ROOT LOCKED previews.
  Body edges and root guides are visible, controls occupy their own panel, and the
  entire image remains beneath it. Native window sizing still needs performer review.

Generated evidence lives in ignored output/anthony-instrument/: usability-demo/,
body-tracking-smoke/, body-wrists-preview.png, fist-locked-preview.png,
usability-audio.json and usability-crop-smoke.json. Graphify was refreshed with local
AST extraction. The original browser and remote repositories were not modified.

### Remaining acceptance

Restart the Python instrument, frame shoulders/hips/wrists, and retest sideways
palms, open-to-fist closure, persistent ROOT LOCKED, nearby split, every quality,
two-palm major reset, larger/resizable view and listening volume. Landmark geometry
is conservative and model finger estimates can still fail under occlusion, crossing
or blur. The camera check has no ground-truth gesture sequence; unit tests and a
single joint-fist match do not establish performer acceptance. Two unrelated Spec Kit
newline failures remain outside this correction task.

## Subsequent fist retest: web/main parity (2026-10-11)

Anthony reported alternating closed-fist detection and requested web/main's method.
The geometric fallback has been removed. The Python filter now matches upstream
`origin/main` f40be3b's `web/live/hands.js` far-mode label confirmation, confidence
threshold, missing-detection grace and alternating body-wrist crops. The local
JavaScript source has no changes and matches that upstream version.

- Regression tests exercise confirmed fist / raw None alternation, low confidence,
  short and expired dropouts, one lock while held, deliberate reopening/unlocking,
  nearby split versus separated locking, and replay equality. A Node parity test
  executes the actual website Hand class over 150 observations and compares its
  seen state, accepted label/score and candidate label/time with Python. Node is
  optional; all other tests remain independent of JavaScript execution.
- `.venv/Scripts/python.exe -m pytest -q --ignore=tests/test_speckit_scripts.py`:
  51 passed, 16 subtests passed. Ruff checks and mypy passed. Unrelated existing
  Windows Spec Kit newline failures were excluded, as documented above.
- Native local model smoke passed: two blank frames took 24.04ms total. Real camera
  check produced 15 frames at 1280x720, preview 1280x830, body landmarks in all
  frames; inference p95 31.36ms, render 29.91ms, controller 0.0603ms (<5ms budget).
  The sandbox denied initial camera access; the authorized rerun passed. Only one
  frame had hand details, labeled None; this check contains no labeled fist trial
  and does not measure recognition accuracy. Python still uses CPU and Lite pose.
- Two-second headless demo: 60 frames, controller p95 0.0545ms, render 6.88ms.
  Inspected `output/anthony-instrument/web-fist-parity/diagnostics.png`: confirmed
  Closed_Fist and raw None are distinct, readable black labels, with ROOT LOCKED.
  Camera evidence is in `output/anthony-instrument/web-fist-camera/` (ignored/local).

The earlier geometric evidence is historical, superseded by this requested method.
Confirmed labels now need 0.35s stability before changing, rather than exposing each
raw classifier flip. A fist alternating continuously from its first appearance
can still remain unconfirmed, as on the website. Restart and perform a deliberate
open-to-fist trial to assess recognition on Anthony's actual movement. No push or
website feature changes were made.
