# Project Status

## 2026-10-04 - Constitution: local work and task status

- State: Complete.
- Task: Keep all project work local until explicitly authorized by the user, and update this
  file after each user-requested task rather than after individual commands.
- Changes: Amended `.specify/memory/constitution.md` from version 1.0.0 to 1.1.0 with two new
  principles and a corresponding task handoff requirement. Created this task record.
- Verification: Resolved the active constitution template; confirmed existing principles and
  the original ratification date are preserved, version and amendment date agree with the
  amendment report, no unresolved placeholders remain, and the diff has no whitespace errors.
  No executable behavior changed, so application tests were not required.
- Local state: Working on `anthony-explorations`; this amendment is uncommitted. No external
  project actions were performed.
- Outstanding: No implementation work remains. Remove the temporary Sync Impact Report before
  committing the constitution amendment.

## 2026-10-04 - Constitution: graphify, design decisions, and project languages

- State: Complete.
- Task: Use graphify to search the codebase efficiently, prompt the user whenever a design
  dilemma arises, and clarify that the analysis code is Python while the web app is JavaScript.
- Changes: Amended `.specify/memory/constitution.md` from version 1.1.0 to 1.2.0. Added principles
  for graphify-first navigation and user decisions on design dilemmas. Clarified the language
  split and the scope of Python-specific requirements. Preserved all previous principles.
- Verification: Resolved the active constitution template; checked headings, version, ISO dates,
  unresolved placeholders, preservation of existing principles, and whitespace. No executable
  behavior changed, so application tests and a code graph refresh were not required.
- Local state: Working on `anthony-explorations`; both constitution amendments remain local and
  uncommitted. No external project actions were performed.
- Outstanding: No implementation work remains. Remove the temporary Sync Impact Report before
  committing the constitution amendments.

## 2026-10-04 - Anthony's vision and Python-first development

- State: Requested vision and governance documents complete; formal feature planning deferred.
- Task: Structure Anthony's six project ideas and first-priority fist toggle, document possible
  design flaws, preserve project context for future agents, and require Python validation before
  any explicitly requested JavaScript translation.
- Changes: Created `ANTHONY_IDEAS.md` with project context, current versus proposed capabilities,
  priorities, each idea's possible design flaws, open questions, and a feature-planning handoff.
  Added project/vision context to `AGENTS.md` and a vision-document link to `README.md`. Amended
  the constitution from version 1.2.0 to 1.3.0 with the two-stage development principle.
- Confirmed decisions: Persistent fist toggle; lock the root while allowing quality changes;
  split gestures suppress lock toggles; start with estimated-depth 3D control; recognize three
  spell moves in order; remain split after reopening, with a future separate merge gesture.
  Recorded future animator-supplied 3D assets and openness, rotation, and hold-time controls.
- Verification: Used graphify queries/explain/path followed by focused source reads; checked the
  README, current sphere/gesture/harmony implementation, and `live.py` server boundary. Resolved
  the constitution template and validated version, dates, placeholders, links, idea coverage,
  preservation of prior governance, and whitespace. No executable behavior was changed, so
  application tests and a code graph refresh were not required.
- Planning prerequisite: `setup-plan.ps1 -Json` failed because no active feature directory or
  `.specify/feature.json` exists. No formal `IMPL_PLAN`, research, data model, contracts, or
  quickstart was generated, and unresolved design choices were not treated as approved.
- Local state: Working on `anthony-explorations`; all documentation changes remain local and
  uncommitted. No Python feature implementation or website translation was performed.
- Outstanding: Specify the local Python fist root-lock feature and settle its remaining scope
  and design choices before formal implementation planning. Confirm the MIDI trigger map and
  plugin behavior before finalizing its adapter. Remove the constitution's temporary Sync Impact
  Report before committing. JavaScript translation remains explicitly deferred.

## 2026-10-04 - Commit vision and governance documents locally

- State: Complete.
- Task: Commit the reviewed vision and project governance changes locally.
- Changes: Removed the constitution's temporary Sync Impact Report and included the vision,
  constitution v1.3.0, project guidance, README link, and this status history in the local commit
  titled `docs: record Anthony's vision and Python-first workflow`.
- Verification: Checked the five-document commit scope and whitespace; verified the constitution
  version and removal of the review comment. Application tests were not required because this
  commit changes documentation only.
- Local state: Committed on `anthony-explorations`; nothing was pushed. Earlier entries retain
  the uncommitted state recorded at those tasks' handoffs; this entry supersedes that state.
- Outstanding: Formal Python fist-toggle specification/planning and its remaining design decisions
  remain future work. JavaScript translation still requires explicit user instruction.

## 2026-10-04 - Review Joseph's ball and defer initial 3D work

- State: Complete.
- Task: Identify Joseph Bakarji's ball work, compare it with Anthony's planned design, and assess
  whether it can be used temporarily while 3D comes later.
- Findings: Git history and blame attribute the current ball to Joseph's `0c019b6` commit dated
  2026-10-01. It uses Canvas 2D, wrist midpoint/spacing, fire or chord-colored glow, sparks,
  motion-energy flicker, and sphere-size sound mappings. The same commit adds pad timbres.
  Depth, split/merge, rotation, and hold-time color interactions are not implemented by that ball.
- Decision: Anthony explicitly chose to reuse Joseph's design temporarily in the Python prototype
  and defer depth/3D work. This supersedes the earlier 3D-first starting point, while preserving
  the future 3D/animator-asset vision and the other confirmed interaction decisions.
- Changes: Updated `ANTHONY_IDEAS.md` with provenance, current behavior, reuse boundaries, new
  design risks, and the revised starting point. Updated `AGENTS.md` to preserve that decision.
- Verification: Used graphify followed by focused source reads, `git show`, and `git blame`;
  checked document consistency and whitespace. This was a source review, not a runtime visual
  or audio test. No executable behavior changed, so application tests and a code graph refresh
  were not required.
- Local state: Working on `anthony-explorations`; these documentation changes remain local and
  uncommitted. No feature implementation, website translation, or push occurred.
- Outstanding: Plan the Python adaptation and remaining gesture/MIDI details before implementation.
  A later 3D renderer and any depth-dependent behavior still need dedicated design and validation.

## 2026-10-04 - Explain code behavior and the computer-vision boundary

- State: Complete.
- Task: Create `explanation.md` explaining the existing code, what the CV models provide, and
  what the project implements or still needs to build.
- Changes: Added the explanation of the Python and browser paths, body/hand model outputs,
  project motion/gesture/harmony/audio/ball logic, third-party dependencies, and the separate
  vocabulary-clustering experiment. Included a responsibility table, a pipeline diagram, and
  a table distinguishing planned work from implemented features. Linked it from README and AGENTS.
- Verification: Used graphify queries/explain followed by focused reads of the relevant source;
  checked model/application boundaries, document links, planned versus current behavior, and
  whitespace. No runtime benchmark or effort measurement was performed, so no percentage of
  model versus project work is claimed. This is documentation only; application tests and a
  code graph refresh were not required.
- Local state: Working on `anthony-explorations`; these and the prior ball-roadmap changes remain
  local and uncommitted. No application source, feature behavior, or web translation changed.
- Outstanding: The Python feature specification, implementation, and relevant runtime validation
  remain future tasks. No documentation work remains for this request.

## 2026-10-05 - Resume Anthony's local Python instrument implementation

- State: Stage 1 implementation and engineering validation complete; performer acceptance pending.
- Task: Continue yesterday's `$speckit-implement` work in `specs/001-anthony-instrument`.
- Resume point: The full native prototype, feature documents and 24 tests were uncommitted;
  tasks were unchecked and evidence.md was missing. Earlier status entries predated that work.
- Changes: Verified and completed the existing root-only fist lock, split arbitration/persistence,
  Joseph-inspired fire/light glow, 72-chord catalogue, smoothed local synth, camera/video/demo/replay
  CLI, offline model setup and scoped development tooling. Corrected WAV event timing across
  irregular gaps, configurable dead-zone feedback, malformed replay diagnostics, nonfinite
  tracking-score handling and synth sample-rate validation. Added regression coverage, checked
  completed tasks, created evidence.md, reconciled README/vision/explanation and verified ignores.
- Verification: 28 tests and 11 subtests passed; lint/format/types and pip check passed. Exhaustive
  5,184 chord transitions passed. The 450-frame replay exactly matched demo state; controller
  p95 was 0.0572 ms (<5 ms). Inspected merged/locked/minor/split renders in fire/light styles.
  Both local models loaded; native window, default audio stream and synthetic video checks passed.
  Approved camera retry outside the sandbox processed 19 frames (inference p95 45.1 ms) with no
  hands/body detected. This does not establish gesture usability or subjective audio quality.
- Local state: This entry accompanies the task-plan's local implementation commit on
  `anthony-explorations`. Refreshed the code graph with graphify update . (AST only, no API cost)
  and reviewed the local diff. Code, evidence and generated graph stay local. Git staging/commit
  needed approved access because the sandbox restricts Git metadata writes. No web feature logic,
  push, upload or deployment.
- Outstanding: Anthony's live gesture/threshold and listening review. 3D, spells, games, MIDI and
  JavaScript translation remain separate future work. Prior dated graph snapshots and caches
  unrelated to this resume remain unstaged; no historical task records were removed.
