# Ableton MIDI output

Approved by Anthony on 2026-10-12: send **the current root note**, **held while
the ball is active**. He then requested chord output, explicitly dropped Expressive
Chords and chose **direct synth input**, again **held while the ball is active;
P pauses/resumes**. No chord-trigger table or plugin setup is needed.
This is an extension of the local native Python instrument; no website port.

## Contract and port names

- `dance2music - Notes to Ableton`: the single-root macOS/Linux virtual source. Start
  the instrument before selecting this input in Ableton. The process owns the
  endpoint and removes it on exit. No IAC bus is required for this default route.
- `dance2music - Chords to Ableton`: the direct full-voicing source, selected with
  `--midi-chords`. Only the selected mode creates its source.
- `--midi` explicitly enables output. `--midi-port NAME` also enables output to
  an existing IAC/loopMIDI destination. Exact names win; otherwise only a unique
  substring is accepted. Never choose the first available hardware port silently.
  `--midi-chords` also enables output; with `--midi-port` it selects full chords
  on that destination. `--midi` and `--midi-chords` are mutually exclusive.
- `--list-midi-ports` lists destinations without starting the camera, models,
  audio or instrument loop. These are destinations, not our virtual source.
- Channel defaults to 1 (user-facing 1–16); velocity defaults to 96 (1–127).
  MIDI pitches are numbers 0–127; initial root is 48. Octave names differ between
  applications, so the number is authoritative.
- Single-root mode has one active note at most. A ball with positive controller gain starts
  `root_midi`. Repeated frames, quality changes, splits, merges and transfers
  preserve that note when the root and active state are unchanged. A root/octave
  change sends Note Off before the replacement Note On.
- Chord mode sends the controller's existing `Output.notes`: three-to-six distinct
  voiced pitches, including quality and register changes. This covers all 300
  catalogue chords without a plugin mapping. Every old note is released before
  starting the changed voicing, including common tones. Identical pitch sets hold
  without frame/oscillator-order retriggering. Root lock only fixes the root;
  quality changes continue to send the resulting chord.
- Missing required body/wrists, zero gain, P pause or exit releases every active note.
  Gesture-detail loss alone can leave body wrists and sound active. Ownership
  uses the same controller gating as local sound. Recovery resumes the current root/chord.
  Pause persists across subsequent frames; resume starts the latest active voicing,
  rather than a snapshot. Tracking loss never keeps a latched chord sounding.
- P pauses/resumes MIDI independently of local synthesis; `--mute`/`--volume`
  control local sound only. MIDI velocity is constant; continuous volume CCs are
  deferred. Cleanup sends Note Off plus All Notes Off on the selected channel,
  then releases the native endpoint, also on Ctrl-C and loop failures.
  A partial Note On failure still tracks the attempted pitch for cleanup. Note Off
  failure attempts the rest of the chord, then All Notes Off, then closes the port.
- `--headless` with either MIDI mode sends MIDI and follows source timing. Headless runs
  without MIDI remain fast. `--output` also saves `midi.jsonl`, including cleanup,
  with source timestamps and exact bytes. Summary reports MIDI configuration/count
  and update p95, with mode `held_root` or `held_chord`. The timestamp measures
  emission scheduling, not Ableton sound. HUD shows chord name and emitted pitches.

## Implementation and validation plan

Use a lazy optional `python-rtmidi==1.5.8` boundary in `instrument/midi.py`,
installed through `requirements/midi.txt`. Keep root selection in the controller;
the adapter observes its outputs. Reuse existing CLI, renderer, tests and feature
documents; no new root-level files or directory are needed.
The chord adapter extends the same held-note lifecycle and named-port boundary,
with no dependency change or controller/synthesis change.

Automated fake-port tests cover monophony, octave changes, loss/recovery, ownership,
quality-only changes, pause/resume, invalid parameters, named destination selection,
missing dependencies, send failures and cleanup. CLI tests cover opt-in/listing,
headless pacing, logs and exception/exit release. Run the whole suite, Ruff and mypy.
Chord tests cover the full catalogue at three registers, locked quality changes,
six-note voicings, reordered identical sets, loss/recovery, pause, malformed pitches,
partial sends/release failures, separate cable names and CLI mode selection.
Measure synthetic controller-plus-MIDI work against the existing 5ms p95 budget.
Verify actual Note On/Off bytes and endpoint deletion with a dedicated CoreMIDI
loopback source/receiver, without targeting hardware. Inspect the MIDI HUD preview.
Performer/Ableton routing and listening acceptance remains a separate manual step.

Official integration references:
[RtMidi virtual ports and lifecycle](https://spotlightkid.github.io/python-rtmidi/classes.html),
[Ableton virtual MIDI buses](https://help.ableton.com/hc/en-us/articles/209774225-Setting-up-a-virtual-MIDI-bus),
[Ableton routing and monitoring](https://www.ableton.com/en/manual/routing-and-i-o/).
