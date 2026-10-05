# Implementation Plan: Anthony's local Python instrument

Branch: `anthony-explorations` | 2026-10-04 | [spec](spec.md)

## Technical context

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

Establish contracts and replay first. Deliver US1 lock/arbitration, US2 visuals,
then US3 full harmony and sound. Integrate native tracking and CLI, run tests/checks,
model smoke tests and scripted rendering/audio evidence, update graph/docs and commit.
Additional animator controls, MIDI and three-move spells are outside this increment.

## Timing and recovery choices

Initial dwell: closure 0.35 s, quality 0.35 s, root 0.35 s, reopen 0.20 s.
Delay a single-fist action by 0.25 s to arbitrate a nearby second fist. Pause/cancel
pending toggles when a nearby raw pair appears; require both stable before splitting.
Dropouts and frame gaps > 0.20 s disarm gates and cancel pending actions while
preserving chord/lock/mode. No extrapolated closure events. Split distance <= 0.6
torso lengths, ring dead zone 0.25 torso lengths. Configuration exposes thresholds.
The resulting deliberate fist latency is approximately 0.60 s plus frame sampling;
this is a prototype safety/usability tradeoff, recorded for Anthony's review.
