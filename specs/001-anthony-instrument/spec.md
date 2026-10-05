# Feature: Anthony's local Python instrument, ideas 0–2

Date: 2026-10-04. Branch: `anthony-explorations`.

## Scope and decisions

Implement a native Python instrument, not a server for the existing website.
Anthony confirmed a temporary Joseph-inspired 2D glow instead of initial 3D;
true depth, animator assets, spells, games and Ableton MIDI remain separate work.
The minimum split interaction is included because idea 1 and lock arbitration
depend on it; additional finger-pattern ball modes remain undefined.

Anthony confirmed the following provisional mappings during this task:

- All 12 roots through a 12-region ring; independent absolute quality gestures.
- Open_Palm = major, Pointing_Up = minor, Victory = dominant seventh,
  Thumb_Up = major seventh, Thumb_Down = minor seventh, ILoveYou = minor-major seventh.
- Either hand toggles root locking; nearby two fists split instead of toggling.
- Split persists. Keyboard M merges until a merge gesture is designed.
- Stable reopening rearms; tracking loss requires reopening before another toggle.

Record implementation choices separately in `decisions.md`. These defaults are
reviewable and configurable rather than new permanent constitution rules.

## US1 — Persistent root lock (P1, idea 0)

As a performer I select a root, close a fist once to lock it, reopen and move
without changing it, change its quality, and close again to unlock it.

Acceptance:

1. A held fist produces one action; a short flicker produces none.
2. Reopening does not unlock. Root stays fixed while quality remains editable.
3. Concurrent far-apart closures coalesce into one toggle; a nearby pair takes
   precedence, including a second closure arriving within the arbitration window.
4. Startup/reacquired closed hands cannot toggle until reliably reopened.
5. Unlock starts a fresh root dwell. Loss preserves musical state but mutes sound;
   reset is available and visible lock feedback is always displayed.

## US2 — Joseph's temporary ball and persistent split (P2, idea 1)

As a performer I see a glowing ball centered between tracked hands, sized by
their separation, with fire/light styles, energy flicker and bounded sparks.
Closing both fists near each other places two balls on the hands. Reopening
keeps split mode; M explicitly merges. Geometry is independent of the renderer.

Acceptance: midpoint/radius match wrist geometry, split conserves combined disc
area, lost hands hide their visuals and silence output, reacquisition preserves
mode. No depth or true 3D is claimed. Render and inspect deterministic examples.

## US3 — Reachable roots and musical qualities (P3, idea 2)

As a musician I can reach every one of 12 roots and six qualities (72 chords)
from every starting chord, using region dwell and absolute quality selection.

Acceptance: chord spelling/intervals match major, minor, 7, maj7, m7 and m(maj7);
quality choices never move a locked root; conflicting hand qualities have a
documented deterministic policy. The prototype sounds chords locally and exposes
the selected chord clearly. It does not send full chords to Expressive Chords.

## Required validation

Automated tests are explicitly required by this spec for timing/state transitions,
all 72 musical states, missing/invalid data, render geometry, and silent device-free
audio generation. A scripted native replay must exercise all three stories without
camera/models/audio hardware; local model smoke validation must run separately.
Measure core update latency (p95 < 5 ms on replay frames); record camera/model
performance separately rather than claiming a hardware-independent latency.
Manual camera/gesture usability and listening remain acceptance observations,
not facts that can be inferred from unit tests.
