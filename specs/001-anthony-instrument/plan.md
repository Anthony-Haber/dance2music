# Implementation Plan: Anthony's local Python instrument

Branch: `anthony-explorations` | 2026-10-04 | [spec](spec.md)

## Technical context

Current MIDI addition: macOS arm64 / Python 3.11.17, optional python-rtmidi 1.5.8.
The approved [root/full-chord MIDI plan and contract](midi-output.md) extends this
instrument without changing root selection or local chord synthesis. Earlier
scope exclusions below refer to their original increments. Direct chord MIDI is
now approved; Expressive Chords trigger mapping was dropped by Anthony.

Python 3.14 on this Windows workstation, isolated `.venv`. Native OpenCV window;
MediaPipe Tasks GestureRecognizer and PoseLandmarker using explicit local `.task`
files; NumPy rendering/synthesis; sounddevice optional playback. Pure state logic
uses only the standard library. Model files and renders belong in ignored output/.
No web search, uploads, remote Git actions or changes to JavaScript are in scope.

New dependencies and tools are pinned in requirements/instrument.txt and
requirements/dev.txt. Pytest, Ruff and mypy apply to the new instrument and tests;
unrelated legacy files are left alone. Runtime imports never open devices/download.
An explicit setup helper downloads public model artifacts only when invoked.

## Structure

- `instrument/models.py`: validated observations, configuration, immutable output.
- `instrument/harmony.py`: roots, qualities, independent root ring and voicings.
- `instrument/controller.py`: causal dwell, closure/rearm and split arbitration.
- `instrument/visuals.py`: Joseph-style glow, particles and interaction overlay.
- `instrument/audio.py`: deterministic synth plus optional playback boundary.
- `instrument/midi.py`: optional named-port output and one held root-note lifecycle.
- `instrument/tracking.py`: local MediaPipe model/camera observation adaptation.
- `instrument/replay.py`: repeatable scripted interaction without devices.
- `instrument/__main__.py`: camera/video/demo/replay/headless CLI and cleanup.
- `instrument/setup_models.py`: opt-in download to output/models.
- `tests/test_instrument_*.py`: observable contracts and integration tests.
- `specs/001-anthony-instrument/`: spec, plan, tasks, decisions, quickstart, evidence.

The 2026-10-05 layout cleanup groups project guides in `docs/`, additional dependency
files in `requirements/`, and the explicit model helper in `instrument/`. The helper
is now invoked with `python -m instrument.setup_models`; its behavior is unchanged.

## Constitution check

Explicit typed Python; pure computations separated from I/O; centralized units
and thresholds; pytest numerical/event tests; failure and latency checks; pinned
isolated environment; documented commands; local-only Git commits; graphify-first
review and AST update; status.md handoff. Decisions prompted and answered above.
Only Stage 1 Python is authorized. Stage 2 JavaScript remains deferred.

## Implementation strategy

### Opposite root mappings, 2026-10-15

Follow the corrected rule and maps in [relative-root.md](relative-root.md).
Validate Python's table and controller round trips first, preserving neutral,
dwell, register limits and MIDI demo notes. Then update the already requested
website mapping; verify displayed L/R aliases, chart transpose, native replay
parity and the existing <5ms controller budget. No new files or dependencies.

### Safari local MIDI, 2026-10-14

Follow [safari-midi.md](safari-midi.md). Validate the Python MIDI/HTTP session
boundary before JavaScript integration, reuse the optional native port adapter,
and preserve the browser lifecycle. Normal live.py serves the loopback API;
phone serving stays static. Connect/refresh lists current IAC destinations, and
only an explicit selection opens a device. Test ordered delivery, liveness,
failures, same-origin boundaries, browser controls and real native loopback.
Website hand labels swap at rendering sites only, as Anthony requested.

### Direct sustained chord MIDI, 2026-10-12

Observe the controller's existing voiced notes through a polyphonic extension of
the MIDI adapter. Reuse active-ball gating, persistent P pause, channel/velocity,
ordered release/replacement, logging and endpoint cleanup. Track every attempted
Note On so partial send failures release all potentially sounding notes; attempt
every Note Off before reporting a release failure. `--midi-chords` selects the
Chords cable; `--midi` preserves single-root behavior, with mutually exclusive
flags. Identical pitch sets hold without frame/oscillator-order retriggers.
Validate all 300 chords at multiple registers, loss/recovery, locked quality
changes, partial failures and CLI/cleanup; verify real CoreMIDI delivery and
inspect the HUD. No new dependency, directory, trigger map or website work.

### Single-root Ableton MIDI, 2026-10-12

Follow [midi-output.md](midi-output.md): a lazy optional port boundary, a typed
monophonic adapter observing controller output, explicit CLI opt-in and named
source/destination selection, persistent P pause, visible status and cleanup/logs.
Validate without hardware, then check exact bytes through a dedicated CoreMIDI
loopback. Keep optional dependency in requirements/ and tests in the existing tests/
directory. Measure the controller-plus-adapter p95 against 5ms and inspect the HUD.
User selected the current root, held while active; full chords/plugin maps are deferred.
Document routing/listening as pending until verified in Ableton, update status and
refresh the AST graph once. Local Python only; no push or browser translation.

### One-hand transfer, 2026-10-12

Add persistent owner/captured normalized radius/gain to the pure controller, and
append owner/pending-transfer metadata to outputs. Use the fist as receiver, per
Anthony's direction correction. Arbitrate fist+palm against nearby fists using
existing timing, cancel changed/lost pairs, and consume
each closure once. Keep geometry and gain usable with only the owning wrist;
M/reset/nearby-fist merge clear ownership. First verify existing two-fist split/merge;
then cover owned-to-midpoint with the same gesture. Display owner/progress in the HUD
and clear particle trails on owner changes. Test both identities, split/lock
priority, loss/recovery, captured geometry, replay and rendering; measure p95
against the 5ms core budget and inspect previews. Update usage/status/evidence and
refresh the local AST graph once. No new top-level files or website changes.

### Approved expansion, 2026-10-11

The [approved 25-cell map](chord-map.md) supersedes earlier six/eight-quality
shortcuts. Keep catalogue intervals, symbols, ordered pairs and maximum voice
capacity authoritative in instrument/harmony.py. Require both reliable non-fist
signs through existing controller dwell; retain the separate 1.5s palm reset and
independent root/fist controls. Expand audio to six persistent oscillator slots
with the existing smoothing and headroom. Use bounded bit-mask assignment costs
for voice leading, preserving total movement, maximum movement and note-tuple ties.
Validate all 300 states/90,000 transitions, exhaustive-search parity, stabilized
gesture replay, locked roots and all chord audio; measure against the 5ms core budget.
Keep artifacts under output/anthony-instrument/jazz-catalogue and design records
under this spec. Refresh the graph once after completion. No web port or MIDI work.

Establish contracts and replay first. Deliver US1 lock/arbitration, US2 visuals,
then US3 full harmony and sound. Integrate native tracking and CLI, run tests/checks,
model smoke tests and scripted rendering/audio evidence, update graph/docs and commit.
Additional animator controls, MIDI and three-move spells are outside this increment.

## Timing and recovery choices

The [2026-10-12 relative-root increment](relative-root.md) supersedes midpoint-only
root input: add a pure root-control module for body-relative zones and one-step
rearming; keep the controller authoritative for mode/register/lock. Use exact signed
transposition for interval changes and register-aware bounded voicing for quality
changes. Append mode metadata to frame/replay contracts; CLI T switches modes and
exports effective mode. Show neutral guides and pending intervals in the native HUD.
Retain original midpoint behavior for old recordings and explicit midpoint mode.
Increase split proximity to 1.0 torso length per Anthony's request. Test all signed
pairs/roots/catalogue chords, audio octave ratios, recovery, keyboard/replay and
wider split arbitration; inspect previews and measure controller p95 <5ms. Refresh
the AST graph once after completion. No new top-level files or website changes.

Initial dwell: closure 0.35 s, quality 0.35 s, root 0.35 s, reopen 0.20 s.
Delay a single-fist action by 0.25 s to arbitrate a nearby second fist. Pause/cancel
pending root toggles when a nearby raw pair appears; require both stable before
toggling split/merge. A held pair changes mode once; reopen to rearm. Both directions
preserve the chord and root lock. M remains an explicit merge shortcut.
Dropouts and frame gaps > 0.20 s disarm gates and cancel pending actions while
preserving chord/lock/mode. No extrapolated closure events. Split distance <= 0.6
torso lengths, ring dead zone 0.25 torso lengths. Configuration exposes thresholds.
The resulting deliberate fist latency is approximately 0.60 s plus frame sampling;
this is a prototype safety/usability tradeoff, recorded for Anthony's review.

## 2026-10-11 usability corrections

Preserve the existing root-lock/split arbitration, with Anthony's explicit confirmation.
Separate body wrist geometry from gesture labels; retain 33 optional body points for
skeleton display and backward-compatible JSONL replay. Adapt the website's wrist crops
locally in Python and measure camera inference separately from controller latency.
Use website-filtered finger labels for actions, including its 0.4s missing-detection
grace, and a causal 40ms body position filter. Ball geometry uses fresh body wrists.
Persist quality after reopening; require both reliable palms for Anthony's chosen 1.5s
major reset. Increase ordinary-spacing audio, retaining gain/pitch smoothing and peak
headroom, with a master volume option for playback and export.

Verify reported regressions against pre-fix HEAD, synthetic body/crop/replay boundaries,
lock feedback, complete 300-chord reachability, audio RMS/bounds/continuity, native model
loading, camera and playback boundaries, and representative rendered output. Tests and
docs stay in their established directories. Read-only official model documentation may
be consulted; all project changes and generated evidence stay local.

An initial retest introduced 3D-joint fallback decisions. Subsequent retesting
supersedes them: port web/main far-mode stabilization and alternating crops,
with raw/confirmed diagnostics and replay metadata to avoid double fist dwell. Put
controls in a separate 110px panel, preserve every camera pixel and use a resizable
window. Request widescreen capture with optional width/height overrides; verify the
Windows DirectShow/MJPEG boundary after Media Foundation rejects the wider mode.
## Authorized JavaScript translation plan

Anthony's 2026-10-13 request starts Stage 2 for the implemented native controls.
The [web-port plan](web-port.md) identifies Python behavior to preserve, browser
adaptations, iPhone HTTPS setup, file placement and the validation approach.
Native source behavior remains authoritative; its replay and catalogue outputs
provide JS parity evidence. MIDI/Ableton and unbuilt future ideas are excluded.
The new HTTPS boundary was first implemented and tested in Python. All work
remains local on `anthony-explorations`; device/listening acceptance is pending.
