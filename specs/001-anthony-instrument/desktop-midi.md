# Desktop browser MIDI routing — 2026-10-13

The subsequent [Safari request](safari-midi.md), 2026-10-14, adds a same-Mac
localhost bridge for current IAC port selection. The direct-only limits below
describe the original desktop increment; native Web MIDI remains available.

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
- MIDI notes are held at a constant velocity, released before replacement, and
  restarted when the size-derived velocity changes, even for identical notes.
  Linear anatomical hand span controls velocity
  and expression CC11, as revised below.
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

## Linear span and continuous velocity, 2026-10-19

Anthony requested hands together = 0, maximum span = 127, linear expansion,
without capturing his reach. This supersedes the 2026-10-15 use of the curved
ball gain and pad/master multipliers. Reuse existing pose inference; no new
camera, calibration recording, telemetry endpoint or dependency.

Python `hand_span_gain` validates 33 consistent 2D/3D points. Sum lengths along
wrist 15 → elbow 13 → shoulder 11 → shoulder 12 → elbow 14 → wrist 16 for
maximum wrist reach. Let `near = shoulder_width * 0.25` (wrists stay apart with
palms together). Normalize `clamp((wrist_distance-near)/(maximum-near),0,1)`.
The browser prefers existing MediaPipe world coordinates, freshly confidence
gated by image landmarks and smoothed with the existing 40ms pose time constant.
Use the image skeleton when world coordinates are absent. Missing/invalid arms
return zero. The endpoint is anatomical model estimation, not measured personal
reach; projection/occlusion and pose errors remain limitations.

Pad/master boosts no longer raise MIDI velocity; positive audio levels affect
browser audio only. Zero master/pad or pad mute still silences MIDI. Ball-presence
and torso gates remain. `MidiSpan` captures normalized energy on hand transfer,
retains it through one-hand ownership/loss/recovery, and resumes live geometry on
merge. Split preserves the same normalized level. No native CLI behavior changes.

Evaluate every frame. Positive gain uses `max(1, round(gain*127))`; zero releases
owned notes and sends CC11=0. A quantized velocity change sends removed/refreshed
Note Offs before changed CC11 and new/refreshed Note Ons. Equal levels sustain.
MIDI 1.0 needs a new attack, so repeated envelopes/release tails remain possible.
Routing, root/chord modes, pause, loss/exit cleanup and Safari batching are preserved.

Validate Python before web translation; test 0/quarter/half/three-quarter/full
span, camera scaling, 3D rotation, missing/degenerate points, transfer and ordered
MIDI delivery. Verify real browser/HTTP bytes with a synthetic driver and routing
p95 <1ms. Actual performer/Ableton listening for this revised scale stays manual.

References: MDN requestMIDIAccess and browser-compat-data, Ableton Live 12
Routing and I/O, Ableton virtual MIDI network help. Firefox support is subject
to browser/site permission requirements; unsupported/denied MIDI remains
diagnosable without breaking browser playback.
