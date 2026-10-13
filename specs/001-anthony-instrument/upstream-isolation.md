# Keep Anthony's branches separate â€” 2026-10-13

Anthony requested undoing Samir's imported work across `ableton`,
`codex/anthony-web-implementation` and `anthony-explorations`, explicitly retaining
Anthony's commits and features. This cleanup uses forward commits; existing
history remains recoverable, and upstream `main`/`ar` are not modified.

## Audit

The merge at `83433fc` imported Samir's `a648ca8` pose/observation ZIP export and
`6f55625` separate microphone recording, with model metadata/hash utilities,
recording libraries and an iOS audio-session helper. It also recorded upstream
Spec Kit commit `d94c2b0` in ancestry. However, tracked `.specify/` and `.agents/`
content remained identical to Anthony's pre-merge `1ee972f`; the merge retained
Anthony's constitution, skills and native PowerShell/Bash helpers. No uninstall
or removal of Anthony's Spec Kit is appropriate.

## Cleanup contract

- Remove only the newly imported recording/export/metadata/audio-session modules,
  libraries and associated upstream tests/docs. Restore the earlier standalone
  video/audio recorder; no raw-observation ZIP or separate microphone option.
- Preserve Anthony's independent Python instrument, controller/harmony/root/frame
  web modules, six-voice synthesis, ball/hand controls, HTTPS phone server, and
  desktop MIDI on the branches that already contain them.
- Shared web integration is adapted to remove references to the deleted modules.
  Model loading returns to MediaPipe asset paths while retaining local offline
  model selection. Ordinary recording still displays the current Anthony chord.
- Verify governance directories against `1ee972f`; preserve all existing commits.
- Require explicit authorization for specific future upstream imports; added that
  instruction to AGENTS.md. This request authorizes local cleanup, not deployment
  or a remote history rewrite.

Verification on the complete ableton app: 68 Node tests pass, including 4,020
native controller observations, all 90,000 voice-leading transitions, six-voice
audio, MIDI lifecycle and hand identity. Real-browser smoke uses synthetic
MediaPipe/camera/MIDI inputs and verifies gestures, loss, legacy modes, layouts,
MIDI routing and the restored media recorder. Physical performer/Ableton tests
remain separate acceptance work.
