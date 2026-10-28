# Safari desktop MIDI through the local server — 2026-10-14

Anthony requested Safari support for the website's Ableton section, listing the
Mac's current virtual ports through the IAC driver. This authorizes a Python
localhost bridge and its browser integration on ableton, superseding the earlier
desktop contract's direct-Web-MIDI-only boundary. Phone MIDI stays deferred.

## Contract

- Connect/refresh enumerates the current native destinations. Selection is exact
  and explicit; listing/page load never opens a port or sends messages. No IAC
  driver configuration, creation, rename or automatic destination selection.
- Browsers with requestMIDIAccess retain their existing native path. Safari uses
  same-origin `/api/midi/` on the normal loopback `live.py` server. A denied native
  permission does not silently bypass that denial through the bridge.
- Reuse browser note/CC semantics from `instrument/midi_lifecycle.py`: held common
  chord tones, removed-note release, root/chord and channel selection, expression
  CC11, sustain-off/all-notes-off panic. Camera/gesture/harmony logic is unchanged.
- Deliver ordered bounded batches, including tracking-loss/stop/panic. A sequence
  and per-selection session prevent stale batches reaching a newly selected port.
  Partial native sends track attempted pitches; cleanup tries all owned notes and
  selected channels, then disposes the endpoint even when individual releases fail.
- Browser heartbeat every 200ms while selected; unchanged notes do not retrigger.
  The existing 500ms frame watchdog remains. The server independently closes a
  connection after 750ms without contact, checked every 100ms. Selection is required
  again after expiry; no replay or automatic reconnect. HTTP timeout is 500ms and
  pending batches are bounded, so a slow connection fails rather than accumulating
  an unbounded delayed performance.
- Loopback peer, loopback Host and same-origin POST checks; JSON bodies at most
  16KiB and 64 three-byte messages. Only notes, CC11 and sustain-off/all-notes-off;
  no SysEx/system messages or CORS access. Phone/LAN serving does not expose MIDI.
- One bridge session per destination. Optional python-rtmidi stays lazy and pinned
  through requirements/midi.txt; normal server startup opens no MIDI devices.

## Implementation and validation

Implement/validate the Python session/device/HTTP boundary in web/midi_bridge.py
first. Then connect web/live/midi-local.js to the existing MidiOutput and selectors.
Reuse live.py, tests/ and spec/docs directories; no new root files/dependencies.
Device-free tests cover exact selection, ordered bytes, invalid payloads, partial
failures, stale sessions, driver removal, HTTP boundaries and cleanup. Node tests
cover Safari fallback selection/refresh, batching, liveness, native parity and races.
Real CoreMIDI verification uses a temporary destination, listing but never playing
into existing IAC buses. Target localhost round-trip p95 below 10ms on synthetic
inputs; report camera/driver/Ableton listening separately. Browser UI smoke uses a
synthetic IAC driver and disables Web MIDI; actual Safari listening remains a trial.

## Display-only hand label correction

Anthony also requested swapping displayed left/right text for the normal mirrored
view while preserving the correct backend logic. Website labels, owner/transfer
text, neutral guide letters and chart row/column headings swap L/R; controller
IDs, ordered quality/direction values, tracking, voicings and MIDI do not change.
Native Python labels and saved/replay IDs retain their existing meanings.

Usage: [Safari tutorial](../../docs/FEATURE_TUTORIALS.md#safari-on-macos-iac-midi).
References: [MDN compatibility](https://github.com/mdn/browser-compat-data/blob/main/api/Navigator.json),
[RtMidi port lifecycle](https://spotlightkid.github.io/python-rtmidi/classes.html),
[Ableton IAC/routing](https://help.ableton.com/hc/en-us/articles/209774225-Setting-up-a-virtual-MIDI-bus).
