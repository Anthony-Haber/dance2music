# Project Context

dance2music turns dance and body/hand movement into music. The Python pipeline tracks pose with
MediaPipe, cleans motion, extracts kinematics and Laban Efforts, chooses harmony, and renders sound
and visual comparisons. The existing JavaScript app in `web/live/` uses a camera or video to drive
pose/hand gestures, chord selection, Web Audio synthesis, and a visible ball between the hands.
`live.py` serves that app locally; its live feature logic currently runs in JavaScript.
`instrument/` is the separate native Python Stage 1 prototype for Anthony's ideas 0–2.
Read `specs/001-anthony-instrument/quickstart.md` for commands and controls, and
`specs/001-anthony-instrument/decisions.md` for confirmed versus provisional decisions.

Anthony's vision is an expressive musical instrument with a future 3D ball, gesture-controlled chord
roots and qualities, three-move chord spells, beginner learning games, and single-note MIDI chord
triggers sent to Ableton's Expressive Chords through a virtual MIDI cable.
The initial Python prototype will reuse Joseph's glowing 2D ball design; depth/3D work is deferred.

- Read `README.md` for the existing pipeline and commands.
- Read `explanation.md` for the boundary between computer-vision models and project behavior.
- Read `ANTHONY_IDEAS.md` for the vision, priorities, accepted decisions, and possible design flaws.
- Follow `.specify/memory/constitution.md` for project governance. Develop and validate new features
  locally in Python first; translate them into the JavaScript website only on explicit user request.
- Keep project work local until explicitly authorized otherwise, ask the user about design dilemmas,
  and update `status.md` after each user-requested task.
- Add or update concise usage instructions in `FEATURE_TUTORIALS.md` for each implemented feature.

## Spec Kit platforms

Use the official helpers in `.specify/scripts/bash/` on macOS/Linux and
`.specify/scripts/powershell/` on Windows. Select the native command in each shared skill;
initialization metadata is not a requirement to use PowerShell on every machine.
Both platforms use the same constitution, templates, skills, and `specs/` documents.
Copy official upstream helpers when updating them; do not hand-translate their logic.
Keep related files together and justify new root-level files under constitution principle XII.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
