# Tasks: Anthony's local Python instrument

**Input**: `specs/001-anthony-instrument/spec.md`, `plan.md`, `decisions.md`.
**Tests**: Explicitly required in spec.md. All work ends at Stage 1 Python.
**Format**: Checkbox, sequential ID, optional [P], story label for story tasks,
and exact repository file path. Checkboxes are updated after verified completion.

## Phase 1: Setup

- [X] T001 Create feature specification and plan in specs/001-anthony-instrument/spec.md and plan.md.
- [X] T002 Prepare isolated environment using requirements/instrument.txt and requirements/dev.txt.
- [X] T003 [P] Configure scoped pytest, Ruff and mypy in pyproject.toml.

## Phase 2: Foundational

- [X] T004 Define validated observations, timing configuration and output contracts in instrument/models.py.
- [X] T005 Add offline model setup and tracking boundary in instrument/setup_models.py and instrument/tracking.py.
- [X] T006 Implement deterministic replay inputs in instrument/replay.py.

## Phase 3: US1 — Persistent root lock (P1, MVP)

Goal: Root-only persistent locking with reliable closure/rearm and split priority.
Independent test: replay lock → reopen → move → quality change → close → unlock;
assert held/flickering/missing fists do not repeat and nearby paired closures do not lock.

- [X] T007 [US1] Write timing, dropout, lock and split-arbitration tests in tests/test_instrument_controller.py and observe initial failure.
- [X] T008 [US1] Implement closure/rearm, coalescing and pending arbitration in instrument/controller.py.
- [X] T009 [US1] Implement root-only lock, unlock fresh dwell and reset in instrument/controller.py.
- [X] T010 [US1] Validate lock and split conflict replay through tests/test_instrument_controller.py.

## Phase 4: US2 — Temporary glow and two-ball mode (P2)

Goal: Joseph-inspired Python glow with persistent hand-anchored split.
Independent test: compare midpoint/radius, split area, missing-hand geometry and
deterministic rendered frames without camera/audio. View saved examples.

- [X] T011 [US2] Write geometry/render/split-persistence tests in tests/test_instrument_visuals.py and observe initial failure.
- [X] T012 [US2] Implement renderer-independent merged/split geometry in instrument/controller.py.
- [X] T013 [US2] Adapt radial glow, fire/light flicker and bounded sparks in instrument/visuals.py.
- [X] T014 [US2] Render and inspect scripted merged/split examples using instrument/replay.py and record results in specs/001-anthony-instrument/evidence.md.

## Phase 5: US3 — Musical roots and qualities (P3)

Goal: All 72 root/quality combinations with local sound and visible feedback.
Independent test: exhaustively reach every catalogue state from every starting
state; check interval sets and locked-root quality changes; inspect/listen to replay.

- [X] T015 [P] [US3] Write catalogue, reachability and root-ring tests in tests/test_instrument_harmony.py and observe initial failure.
- [X] T016 [P] [US3] Write audio continuity/silence/finite-output tests in tests/test_instrument_audio.py and observe initial failure.
- [X] T017 [US3] Implement root ring, six quality definitions and bounded voice leading in instrument/harmony.py.
- [X] T018 [US3] Implement smoothed device-free synth and optional sounddevice boundary in instrument/audio.py.
- [X] T019 [US3] Integrate camera/video/demo/replay, merge/reset, output recording and feedback in instrument/__main__.py; validate in tests/test_instrument_cli.py.

## Phase 6: Polish and cross-cutting concerns

- [X] T020 Run tests/lint/format/types, model smoke and latency validation; record commands/results in specs/001-anthony-instrument/evidence.md.
- [X] T021 Document launch/setup/review choices in specs/001-anthony-instrument/quickstart.md, decisions.md, README.md, docs/ANTHONY_IDEAS.md, docs/explanation.md and status.md.
- [X] T022 Refresh graphify-out/graph.json with graphify update ., review local diff and commit completed work on anthony-explorations.

## Dependencies and execution order

Setup → Foundation → US1 → US2 → US3 → Polish. Geometry/sound can be tested
independently of live inference. T015/T016 are independent files and can run in
parallel once US1/US2 contracts exist; implementation runs sequentially here.
T003 is independent of dependency installation; it still needs validation later.

## Parallel examples per story

- US1: timing/recovery replay cases can execute together in pytest; controller edits share a file and remain sequential.
- US2: visual tests may run alongside controller tests after renderer implementation; geometry and renderer edits are separate files.
- US3: T015 catalogue tests and T016 audio tests use different files with no mutual dependency; T017/T018 become independent once chord contract exists.

## Implementation strategy

US1 is the suggested MVP. Validate its observable state transitions first, then
add US2 visuals and US3 harmonic reachability/sound. Keep controls provisional and
documented. No deployment, browser translation, external issues or pushes.

## Resume audit: 2026-10-05

Existing implementation and test files were verified against the feature before
checking their tasks. Yesterday's initial red-test logs were not preserved; current
checks and new regressions demonstrated to fail before correction are documented
in evidence.md. Engineering completion does not claim performer acceptance.
