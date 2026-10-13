# Validation evidence: local Python instrument

## Direct held-chord Ableton synth input, 2026-10-12

- Anthony explicitly dropped Expressive Chords and selected direct synth input,
  **hold while ball is active; P pauses/resumes**. `--midi-chords` sends every
  existing voiced pitch on `dance2music - Chords to Ableton`. Single-root mode
  and its Notes cable remain available through `--midi`.
- Full suite: **184 passed, 2 optional skips, 242 subtests passed in 10.00s**
  (`.venv/bin/python -m pytest -q`). Twenty-three new cases cover all **300 chords
  at three registers** (900 voicings), locked quality changes, three/six-note
  transitions, identical reordered pitches, loss/recovery, persistent P, pitch and
  voice-count boundaries, partial Note On failure, failed Note Off recovery,
  named source/destination/channel selection, mode exclusion, exact exports,
  keyboard controls and Ctrl-C/loop/exit release. Existing root tests still pass.
  Ruff check/format (24 files) and mypy (12 sources) pass.
- macOS arm64 / Python **3.11.17** / python-rtmidi **1.5.8**; no dependency change.
  Real dedicated CoreMIDI source/receiver received exactly **38 messages** for
  C major → locked C minor → octave C minor → pause → latest G → loss → six-note
  Cmaj13 recovery → exit. Repeated frames/paused frames sent no duplicate notes.
  Source disappearance was confirmed after cleanup; existing IAC/hardware outputs
  were not selected. Script/result: `output/anthony-instrument/midi-chords/verify.py`
  and `coremidi.json`. Run from the normal desktop environment with
  `PYTHONPATH=. .venv/bin/python output/anthony-instrument/midi-chords/verify.py`.
- Thirty deterministic device-free demo repetitions (**13,500 frames**) measured
  controller-plus-chord-adapter p95 **0.00792ms**, below the **5ms** budget.
  `latency.json` records demonstration(30) and the transport boundary; preview seed is 0.
  This does not measure camera-to-Ableton audio latency.
- Real CLI: `.venv/bin/python -m instrument --demo --headless --midi-chords
  --seconds 15 --output output/anthony-instrument/midi-chords/demo` processed
  **450 frames in 14.993s**, with **31 messages** including three final Note Offs
  and All Notes Off. Log voicings: C (48,52,55) → G (55,59,62) → Gm (55,58,62)
  → Am (57,60,64) → A (57,61,64). Every old note releases before the replacement.
  MIDI update p95 **0.00621ms**, controller **0.0691ms**, renderer **3.9443ms**.
  Inspected the 960x1214 HUD with chord/name/full pitch list and P control, retaining
  the full 960x720 source below 450px HUD plus 44px MIDI row.
- Updated user tutorial, quickstart, vision, spec/plan/decisions/tasks and status.
  Work is on ableton; Anthony authorized commit/push on 2026-10-12. No website changes. Real
  performer/Ableton routing/listening, Windows/Linux MIDI and end-to-end audio
  latency remain unverified. Local AST refresh completed once: **1,550 nodes,
  2,799 edges, 154 communities**, no API cost.

## First held-root Ableton MIDI output, 2026-10-12

- Anthony chose the current root and hold-while-active behavior. Implemented the
  process-owned `dance2music - Notes to Ableton` source, plus explicit IAC/loopMIDI
  destination selection/listing, channel/velocity defaults, P pause/resume, MIDI HUD
  and byte logs. `dance2music - Chords to Ableton` is reserved and not created.
  No quality/chord tones or plugin mapping is sent in this first stage.
- **161 passed, 2 optional skips, 242 subtests passed** (`.venv/bin/python -m pytest -q`).
  Forty new cases cover held monophony and Off-before-On order, octaves, quality/
  lock/split/transfer independence, actual controller/ownership loss/recovery,
  channel/velocity/pitch boundaries, lazy/missing dependencies, exact/unique port
  names, listing, device failures, Ctrl-C/loop/Q cleanup, P persistence, headless
  timing, JSONL cleanup and renderer geometry. Core tests open no MIDI devices.
  Ruff check and format pass (24 files); mypy passes (12 sources); diff check passes.
- Installed pinned **python-rtmidi 1.5.8** in existing macOS arm64 **Python 3.11.17**
  `.venv`. CoreMIDI creation in the restricted agent sandbox aborted with -10833;
  the authorized normal desktop check succeeded, listing existing ARIA_IN/ARIA_OUT
  destinations. They were not selected or renamed. Normal Terminal is the supported
  launch context; the optional native library cannot recover that sandbox abort.
- Real dedicated CoreMIDI loopback received exact Note On 48, Off 48/On 55,
  loss Off 55, recovery On 60, exit Off 60 and channel-1 All Notes Off. A repeated
  root sent no duplicate. The native source disappeared after cleanup. No hardware
  output or existing IAC destination received these test messages. Reproducible
  script/result: `output/anthony-instrument/midi-check/verify.py` and `coremidi.json`.
- Thirty device-free 15s demo repetitions (**13,500 frames**) measured
  controller-plus-MIDI p95 **0.00734ms**, below the **5ms** budget. Fixture is
  demonstration(30), renderer seed 0; `latency.json` records parameters. This is
  adapter/computation latency, not camera-to-Ableton audio latency.
- Real CLI: `.venv/bin/python -m instrument --demo --headless --midi --seconds 15
  --output output/anthony-instrument/midi-check/demo` processed 450 frames in
  **14.997s**. MIDI roots **48 → 55 → 57**, seven total messages including final
  Note Off/All Notes Off. MIDI update p95 **0.00221ms**, controller **0.0672ms**,
  renderer **3.981ms**. Preview 960x1214 retains all 960x720 source pixels below
  450px HUD plus 44px MIDI row. Inspected `midi-hud.png`: cable/channel/NOTE/P
  status is readable and occupies its own row. Logs match held-note lifecycle.
- Documentation includes the macOS command, automatic source names, Ableton Track/
  monitoring steps, demo, existing IAC route, pause and troubleshooting. Real
  Ableton routing/listening, live gesture latency, and Windows/Linux MIDI remain
  unverified; engineering checks do not establish those acceptance results.
  No website changes, commit or push. Local AST graph refreshed once: 1,522 nodes,
  2,699 edges, 155 communities; no API cost.

## Split-ball energy collection, 2026-10-12

- Anthony approved combining visible areas, preserving the existing split-energy
  rule. Current runtime already collects both split balls into the fist using
  `sqrt(sum(radius²))`; no new radius/gain behavior was needed.
- Added 8 public-gesture cases: both receivers at gaps 60/90/180/300px with a
  100px torso. Each starts with actual nearby-fist split and reopening, transfers
  palm → fist, verifies donor removal and exact combined squared radius, retains
  gain/notes, holds for 2s without repeated growth, then uses nearby fists to merge.
- Final suite: **121 passed, 2 optional skips, 242 subtests passed**. Ruff lint/format,
  mypy and whitespace checks pass. Both receiver previews inspected/generated in
  `output/anthony-instrument/energy-transfer/`: two radius-31.82 balls become one
  of radius 45.00; gain stays 0.465. This illustrates the approved area rule.
- Tutorial and design/spec/quickstart explicitly explain split-energy collection
  and radius-40 + radius-40 → radius ~57. Gesture-model and audio-device behavior
  are unchanged; live camera/listening acceptance remains pending. Local AST graph
  refreshed after the additional validation cases; no API cost or external actions.

## Root recheck and palm-to-fist correction, 2026-10-12

- Anthony requested clearer root tutorials and a complete verification, then
  corrected transfer direction to palm → fist. Updated receiver binding, symmetric
  ownership/loss/UI tests and all current usage/spec/decision references. Earlier
  hand-transfer evidence below records the superseded palm receiver behavior.
- Expanded Feature Tutorials with top navigation, the complete 16-cell position
  map, C3 → G3 → D4 example, signed downward/octave steps, rearming, T switching,
  recovery and one-hand-mode interaction. Checked all 16 published cells against
  the implemented map; they match. Design reference links back to this tutorial.
- Full final suite: **113 passed, 2 optional skips, 242 subtests passed**. Ruff
  lint/format, mypy and whitespace checks pass. New integration checks verify
  cumulative fifths/downward register changes and signed/octave/T/lock controls
  while the ball belongs to a fist. Existing cases cover all 192 pair/root cases,
  all 4,800 catalogue transpositions, real audio octaves, bounds, dropouts and T/t.
- Reproduced the previous receiver binding in an isolated copy of the controller:
  L fist used to produce R ownership, R fist L ownership; corrected code produces
  ownership of the closed fist in both cases. No working files were reverted.
- Two full 15-second native headless demos (20Hz) passed: interval ends at A3,
  midpoint at D3; lock/unlock/quality/split events occur. All **600 exported states**
  replay exactly with recorded configuration. Core p95 0.0304/0.0320ms, below 5ms.
- Corrected transfer replay: 380 frames/50Hz, events transfer:L, transfer:R, merge,
  split, merge; all states replay exactly. Owning-wrist-only WAV segments remain
  non-silent. Inspected corrected fist-owner and root/split previews. Artifacts
  are under `output/anthony-instrument/root-review/`; no audible acceptance claimed.
- Local model smoke passed (two blank frames 19.15ms, zero detected hands expected).
  This confirms model loading/inference, not camera gesture recognition. Live
  camera, comfort, end-to-end latency and listening acceptance remain pending.
- Local AST graph refreshed after the correction: 1,432 nodes, 2,449 edges,
  154 communities, no API cost.

## Persistent hand transfer and shared merge, 2026-10-12

- First ran existing nearby-fist split/merge cases: 7 tests and 3 subtests passed,
  covering 0.9/1.0 torso proximity, staggered confirmation, held fists approaching
  and repeated reopen cycles. Anthony then confirmed owned balls must use that
  same nearby two-fist gesture to merge to midpoint, rather than directly split.
- Final suite: **111 passed, 2 optional tests skipped, 242 subtests passed**.
  Transfer adds 20 cases for both identities, crossing/reordered observations,
  captured size/gain, missing other wrist, owner/torso loss/recovery, transfer back,
  preserved lock, M/reset, split consolidation, common merge and 1.0-torso boundary,
  one-action closures, changed/uncertain/lost pairs, gaps and both root-mode replays.
  Ruff lint/format, mypy and whitespace checks pass.
- Native CLI exported a 380-frame, 7.6-second replay at 50Hz, including right-only
  and left-only tracking. All exported output states replay exactly. Events are
  transfer:R, transfer:L, merge, split, merge; final state is unlocked midpoint C.
  AVI/WAV/frame/state exports and inspected pending/owner/merged/split previews
  are under `output/anthony-instrument/hand-transfer/`.
  Exported WAV remains non-silent during right-only tracking (1.25–1.55s, RMS
  0.1315) and left-only tracking (2.85–3.15s, RMS 0.1341); not manually listened to.
- Inspected 640px owner/midpoint previews: ownership and ready status remain
  readable, the owner ball stays visible with the other hand absent, and nearby
  fists return it to a single midpoint ball. Owner changes clear old spark trails.
- Pure controller benchmark: 30 repeats of the same 380 frames (11,400 total,
  no randomness), p95 **0.0078ms**, maximum **0.1461ms**, within the **5ms** budget.
  CLI export p95 core 0.0327ms and render 2.852ms; this excludes live CV inference.
  Python 3.11.17, NumPy 2.4.1, OpenCV 5.0.0; parameters/sequence/events/metrics are
  recorded in validation.json and export/summary.json in that artifact directory.
- Local AST graph refreshed once: 1,425 nodes, 2,439 edges, 155 communities, no API cost.
  Local implementation only. Automated tests establish gesture-label behavior;
  live camera recognition, performer comfort and listening acceptance remain pending.

## Relative root modes and wider split, 2026-10-12

- Approved behavior is recorded in [relative-root.md](relative-root.md): interval
  default, T mode switch, one step per neutral/dwell cycle, exact signed register
  movement, preserved quality/fist controls and 1.0-torso split/merge proximity.
- Final `.venv/bin/python -m pytest -q`: **91 passed, 2 skipped, 242 subtests passed**.
  Skips require optional Node and PowerShell. All instrument/test Ruff lint/format
  checks and mypy (11 source files) pass; whitespace check passes.
- Relative tests cover 16 pairs x 12 starting roots (192 cases), every pitch class,
  all 4,800 catalogue-chord/interval transpositions, exact signed note movement,
  held-pose suppression, neutral dwell, diagonal flicker, missing joints/wrists,
  long gaps, locked quality changes, actual octave oscillator frequency doubling,
  MIDI limits and old/new mode-aware replay. Original exhaustive midpoint catalogue
  transitions and zero-register voicing parity remain covered.
- Mocked native-window keyboard integration exercises both T and t, exports all
  three effective modes and reproduces their notes/register on replay. Three-second
  interval demo exports 90 frames; all 90 state records replay exactly. A separate
  midpoint demo completes successfully. No camera/model/audio device is needed.
- Wider-distance split regression failed at 0.9 and 1.0 torso lengths before the
  change and passes afterward. It verifies one split then one merge, no nearby
  root-lock toggle, and retained separated-fist locking at 1.2 torso lengths.
- Synthetic 5,760-frame run: controller p95 **0.0074ms**, maximum **0.349ms**, below
  the 5ms budget. Inputs are 10 rounds x 16 pairs x 36 frames, 40ms per frame, with
  no randomness. Python 3.11.17/macOS arm64; dependency versions and metrics are in
  `output/anthony-instrument/relative-root/summary.json`. This excludes CV inference.
- Inspected pending/applied/neutral previews at 640px and 1280px widths and the
  midpoint preview. The top panel displays signed targets/progress; both mode
  guides retain the whole camera image. Artifacts and scripted frame/state records
  are in `output/anthony-instrument/relative-root/`. `intervals.wav` contains C3
  major, fifth-up G3 and octave-up G4 for performer listening; it has not been
  listened to on the live system.
- Completed local AST graph refresh: 1,397 nodes, 2,355 edges, 148 communities,
  no API cost. All changes/artifacts remain local; no website translation or push.
- Performer camera/gesture comfort, new split threshold, live latency and listening
  acceptance remain pending. Automated geometry checks do not measure model accuracy.

## Complete 25-pair jazz catalogue, 2026-10-11

- Verified the approved 25 cells and independent interval definitions across all
  12 roots: 300 distinct chord identifiers, all 90,000 start/destination controller
  transitions, complete pitch-class sets, note counts and MIDI bounds. Every quality
  also changes correctly with a locked G root while incoming root navigation is ignored.
- Covered complete-pair dwell/cancellation, missing/uncertain/fist/heart input holding
  quality, both-palm 1.5s reset, ordered hand identity, alternating hand recognition
  with raw-label flicker and exact JSONL replay equality for all 25 cells.
- Compared the optimized voice leader with exhaustive permutations for 96 seeded
  random cases (seed 19, 24 cases each for three through six voices), preserving
  all three musical cost priorities. All 300 chords render finite, audible, bounded
  audio; six-voice chunk continuity and six-to-three slot release pass.
- Full instrument suite: **68 passed, 45 subtests passed**, in 12.88s:
  `.venv/Scripts/python.exe -m pytest tests/test_instrument_audio.py tests/test_instrument_cli.py tests/test_instrument_controller.py tests/test_instrument_fists.py tests/test_instrument_harmony.py tests/test_instrument_tracking.py tests/test_instrument_visuals.py -q -p no:cacheprovider`.
  Ruff lint/format and mypy pass. Temporary-file tests ran with authorized sandbox
  escalation; numerical and integration tests require no camera, network or audio device.
- Generated reproducible synthetic evidence with
  `output/anthony-instrument/jazz-catalogue/validate_catalogue.py`: 25 ordered pairs
  at root C, 25Hz, 2s major and 1.4s each other selection, 890 frames/35.6s,
  renderer seed 4, master volume 0.6, NumPy 2.4.1 and OpenCV 5.0.0. Each endpoint
  selects its exact quality. Exports: `frames.jsonl`, `states.jsonl`, `chords.wav`,
  `preview.avi`, `contact-sheet.png`, `first.png`, `minor.png`, `final.png`, `summary.json`.
  Inspected the 25-panel contact sheet and final C13 preview; chord text and six
  tones are present. A subsequent HUD wording correction says unknown holds quality,
  since unlocked root selection remains independent.
- Synthetic controller p95 **0.104ms**, chord-change p95 **0.145ms** and six-voice
  change p95 **0.303ms**, under the 5ms core budget. The isolated six-voice benchmark
  uses 12 roots × four six-note qualities × 30 changes. These are computational
  timings; camera inference and playback latency were not measured.
- Live gesture accuracy and subjective listening acceptance remain pending.
  No gesture model training or confidence changes. Completed one local AST graph
  refresh for the new voice-leading architecture and audio/harmony dependency:
  1,342 nodes, 2,206 edges, 150 communities, no LLM/API cost. The relative-path CLI
  invocation reported no files; retrying with the absolute repository path succeeded.
  No website translation or external publication is included.

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
## Authorized browser translation and iPhone server, 2026-10-13

Scope and decisions: [web-port.md](web-port.md). All work is local on
`anthony-explorations`; main recording/iOS fixes were merged at `83433fc` with
the current constitution/helpers preserved. No MIDI/Ableton, spells, game or
true 3D behavior was added. The user selected tracking and sound on the iPhone.

Validation used Python 3.14, Node 24.11.1, OpenSSL 3.4.0, Playwright 1.62.1 and
Chromium 151.0.7922.34. Native reference fixtures use seed 20261013 and include
4,020 frame observations across 48 scenarios. Every musical output/event, ball
geometry and gain matches Python within 1e-7 floating tolerance. Integer pitches
and events match exactly; displayed HOLD progress allows one percentage point
for Python/JS rounding. All 300 catalogue chords and all 90,000 root-position
start/target voice-leading outputs match the native SHA-256 digest.

- 56 Node tests pass, covering replay, tracking loss, joint identity/crossing,
  phone capture constraints, all timbres' six tones, unused-slot/resonator release
  and bass-register updates. Synthetic desktop controller p95 0.006ms and
  voice-leading p95 0.006ms are below the 5ms core budget. These exclude camera,
  model inference, rendering and physical audio output.
- Affected pytest suite: 123 passed, 240 subtests passed. This includes 10 phone
  certificate/TLS/CLI cases. Explicit Ruff lint/format and mypy checks pass for
  changed Python and fixture generation; configured instrument mypy also passes.
- Broader pytest run: 129 passed, 2 failed, 2 skipped, 242 subtests passed. The
  two failures are the already-documented Windows Spec Kit LF/CRLF fixture
  failures; `.specify/` helpers were not changed. The manual upstream
  `test_browser_recording.py` runner requires Python Playwright absent here, so
  it was excluded from pytest collection and its browser JS recording tests
  were run with the existing Node Playwright runtime instead. Repository-wide
  Ruff also reports 27 baseline issues in untouched upstream browser/zone test
  scripts; changed-source checks pass.
- Headless browser smoke passes with a synthetic camera/MediaPipe model: mobile
  defaults, Start/audio, neutral arming, transfer, common merge, split, augmented
  quality, root-mode switching, loss/recovery, recording ZIP, Stop, legacy modes,
  mobile overflow and desktop controls. The 13 existing recording test groups
  pass, including near/far/off freshness, model provenance, ZIP/checksums,
  real browser recording/playback, microphone refusal/disconnect/cancellation,
  Safari audio-session rejection regression and packaging recovery.
- Inspected phone ownership/split and desktop control screenshots. The phone
  previews retain the complete source frame and show distinct attached/split
  balls with readable status. Fixed stale canvas/badge after Stop found during
  that inspection. Browser OfflineAudioContext rendered native C13, all six
  pitches [48,52,55,58,62,69], at 48kHz: peak 0.27312, RMS 0.08752, all finite,
  unclipped. Subjective listening acceptance remains pending.

Artifacts are under ignored `output/web-port/`: browser-results.json,
recording-tests.json, audio-results.json, phone-owned-ball.png, phone-split.png,
phone-midpoint.png, desktop-controls.png and browser-native-C13.wav. Compressed
native fixtures and the generator live in `tests/web/`.

Outstanding: install/trust the local certificate on Anthony's iPhone, try the
camera in Safari and evaluate detection/FPS, thermal behavior, output volume,
listening and actual movement-to-sound latency. Browser latency estimates and
synthetic desktop timings do not establish any of those. No physical iPhone
or performer trial was claimed. The CLI does not modify system trust stores.

Graphify code refresh completed once, locally with AST extraction and zero API
cost: 1,675 nodes, 3,006 edges, 164 communities. Module CLI invocation used the
installed interpreter because the launcher trampoline failed. Final particle
cleanup on tracking loss/topology changes is a minor drawing fix with unchanged
module relationships; it does not warrant another graph refresh under VIII.
Instrument near-mode association also now requires one distinct detection per
hand, preventing a single detected sign from manufacturing a two-hand quality
pair. This is a tested correction within the existing tracker boundary.
# Desktop MIDI routing — 2026-10-13

Stage 1 preceded JavaScript: `instrument/midi_lifecycle.py` was validated locally with
16 pytest cases before translating it to `web/live/midi.js`. Generated
`tests/web/midi-reference.json` from that Python sender; Node compares exact
message bytes/order. No hardware driver or native MIDI dependency is needed
for these tests; importing either computational module starts no devices.

Commands (existing Windows Python 3.14 venv and Node runtime):

```powershell
.venv/Scripts/python.exe -m pytest -q -p no:cacheprovider tests/test_browser_midi.py tests/test_instrument_controller.py tests/test_instrument_harmony.py
node --test tests/web/instrument.test.mjs tests/web/audio.test.mjs tests/web/midi.test.mjs
.venv/Scripts/ruff.exe check instrument/midi_lifecycle.py tests/test_browser_midi.py
.venv/Scripts/ruff.exe format --check instrument/midi_lifecycle.py tests/test_browser_midi.py
.venv/Scripts/mypy.exe
# Existing Playwright 1.62.1 + Chromium 151, configured as in the web-port evidence:
node tests/web/browser-smoke.cjs
```

Results: 47 Python tests + 32 subtests; 68 Node tests (12 new MIDI cases);
changed Python lint/format and configured mypy (12 source files) pass.
Routing p95 ~0.0022ms over 4,000 alternating six-note updates against a 1ms
budget; native controller/voice-leading checks and all 90,000 transitions pass.
Browser smoke uses synthetic camera/MediaPipe and MIDI ports with real browser
audio/recording APIs. It covers explicit port selection, both sending modes,
root sustain, MIDI-only audio fade/browser restore, tracking loss, background
release, panic, stop, existing instrument controls and 13 recording groups.
`output/web-port/browser-results.json`, `recording-tests.json` and
`desktop-midi.png` preserve local results/preview. Inspected the desktop controls.

The first Python invocation used an unused tmp_path fixture that hit Windows
sandbox temp permissions; removed the unnecessary fixture. Browser localhost
network access was blocked in the sandbox, then passed using approved escalation.
An initial silence assertion used exact zero while the existing 30ms master
fade was still running; the corrected integration assertion waits for amplitude
below 0.001 and confirms the browser output is restored afterward.

Real loopMIDI/IAC output, Chrome/Edge/Firefox permission prompts, Ableton
instruments/CC11 mapping, listening and movement-to-sound latency are not tested
by these mocks; T074 retains that acceptance work. No phone transport, hosting,
new device driver installation or publication was performed. MIDI-only browser
recordings cannot capture the external Ableton audio. A failed physical link or
browser crash can prevent note-offs reaching the receiver despite cleanup attempts.

## Integration into ableton before commit/push

Anthony explicitly requested moving this work to `ableton` and pushing it to his
fork. Merged the web prerequisite at `5db8ff8`, retained the existing native
`instrument/midi.py` and `tests/test_instrument_midi.py` unchanged, and named
the independent browser-reference files `instrument/midi_lifecycle.py` and
`tests/test_browser_midi.py`. Documentation conflicts retain both native and
browser instructions. Browser tasks use T065–T076 after native T051–T064.

Revalidated the combined branch: 118 pytest cases + 38 subtests, 68 Node tests,
browser/recording smoke, Ruff check/format and mypy (13 modules) pass. Pytest's
initial failures were Windows sandbox temporary-file permissions; an approved
unsandboxed retry passed. No MIDI hardware was used. Refreshed the AST graph
for the integrated native/browser module relationships before committing.
