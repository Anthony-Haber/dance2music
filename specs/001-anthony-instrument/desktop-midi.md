# Desktop browser MIDI routing — 2026-10-13

Anthony explicitly authorized desktop Chrome/Edge/Firefox MIDI routing in the
web instrument. Phone routing is deferred. This supersedes the previous web
port's MIDI exclusion for this feature only. Work stays on
`codex/anthony-web-implementation` initially. Anthony subsequently requested
committing and pushing on `ableton`. The web implementation is merged into that
branch while retaining its native MIDI module; the Python browser reference is
named `midi_lifecycle.py` to avoid replacing native `midi.py`.

## Plan and governance

1. Validate a pure note/CC lifecycle locally in `instrument/midi_lifecycle.py` with pytest.
2. Translate that validated lifecycle to `web/live/midi.js`, then integrate it
   with Anthony mode and an explicit Connect MIDI button. No server MIDI bridge.
3. Test pure message behavior, permission failures, ports, lifecycle cleanup,
   native parity, browser controls, and existing web behavior. Update tutorials,
   decisions, evidence and status; refresh the local AST graph once.

All files reuse existing package/test/spec directories (constitution XII).
Python-first validation precedes JavaScript translation (X). New output behavior
does not change tracking, gesture dwell, chord selection or voice leading.
Anthony chose both modes under an Ableton section: full chord notes and one root
note. The latter currently preserves the root/register; quality gestures still
select the visual/browser chord, but do not change that trigger. Anthony explicitly
requested a future task to define their musical effect in single-note mode.

## Desktop contracts

- Default is browser sound; MIDI is opt-in, requested from a click without SysEx.
- A port is selected explicitly, never automatically on connection/reconnection.
- Channel is 1–16. The MIDI mode sends only the Anthony instrument chord.
- MIDI notes are held between observations, released before replacement, and
  never retriggered for identical notes. Ball gain controls expression CC11.
- Zero gain, invalid data, stale frames, tracking loss, stop, hidden tab, page exit,
  reset, mode/route/channel/port changes and disconnect release owned notes.
- Panic releases owned notes and sends sustain-off/all-notes-off on the selected
  channel. Never send SysEx or touch other ports/channels.
- New notes send immediately (no polling/network/scheduling buffer). A stale
  500ms observation watchdog (checked every 100ms) releases notes when
  camera/inference stalls; it adds no delay to normal message sending.
- Localhost is suitable for development; a public deployment needs HTTPS and
  must allow the `midi` permission policy. A static hosted app can use local MIDI.
- Browser recording captures browser audio, not Ableton output. MIDI-only audio
  therefore needs recording in Ableton.

Target: pure routing p95 <1ms on synthetic chord updates; browser sends without
an added scheduling buffer. Actual driver/Ableton/audio latency and listening
remain a manual acceptance test, not implied by message tests.

References: MDN requestMIDIAccess and browser-compat-data, Ableton Live 12
Routing and I/O, Ableton virtual MIDI network help. Firefox support is subject
to browser/site permission requirements; unsupported/denied MIDI remains
diagnosable without breaking browser playback.
