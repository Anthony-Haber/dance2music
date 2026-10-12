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
- Anthony's approved complete 25-cell ordered hand map and fuller voicings are
  defined in chord-map.md, superseding the earlier single-sign shortcuts below.
  Both reliable non-fist signs are required for quality selection; incomplete,
  unknown, low-confidence, heart or fist pairs hold quality. Root navigation is
  independent and remains active unless locked. Both palms retain the 1.5s reset.
- Both Open Palms held for 1.5 seconds = major (Anthony's 2026-10-11 revision).
  Pointing_Up = minor, Thumb_Up = major seventh, Thumb_Down = minor seventh.
  Right Thumb_Up + left Thumb_Down = minor-major seventh; the reverse = dominant seventh.
  Right Victory + left Open_Palm = diminished seventh; the reverse = half-diminished seventh.
  Ordered pairs override supported single-hand shortcuts. Love/heart is disabled.
- Fist + non-palm (or distant two fists) toggles root locking; fist + palm
  transfers ownership from palm to fist. Nearby two fists split midpoint balls,
  or merge split/owned balls to midpoint. All require closure/rearm safeguards.
- Ball mode persists after reopening. Keyboard M also merges.
- Stable reopening rearms; tracking loss requires reopening before another toggle.

Record implementation choices separately in `decisions.md`. These defaults are
reviewable and configurable rather than new permanent constitution rules.

2026-10-11 performer feedback adds whole-body display and body-wrist ball control
matching the website, pose-guided hand crops, audible ordinary-spacing volume,
persistent gesture-selected quality, and explicit ROOT LOCKED confirmation.
Follow-up feedback requires the complete camera frame in a resizable window with
controls outside the image. Subsequent retesting found alternating fist detection and
explicitly requires web/main far-mode canned labels and temporal stabilization,
superseding the earlier joint fallback. Show raw and confirmed labels separately.

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

The approved 2026-10-12 extension adds persistent one-hand transfer: a fist opposite
an open palm assigns the single ball to the fist hand, including from split mode.
It captures body-relative radius and gain, and leaves chord/root lock unchanged.
Only the owning wrist and torso are needed to render/sound; loss hides/mutes and
recovery restores ownership. Nearby two closed fists merge ownership to midpoint,
using the same merge gesture as split mode. M/reset also clear ownership. Changed,
uncertain or lost transfer pairs cancel pending actions. Reopen before retrying.
Acceptance includes both body identities/crossings, one action per closure,
split priority, nearby-fist owned merge, captured size/gain, loss and exact replay.
Split transfer adds visible areas: squared receiver radius equals the sum of both
prior squared radii. It removes the donor ball, retains shared gain and does not
repeatedly accumulate energy while held. Anthony confirmed this rule on 2026-10-12.

As a performer I see a glowing ball centered between tracked hands, sized by
their separation, with fire/light styles, energy flicker and bounded sparks.
Closing both fists near each other toggles one ball into two, or two back into one.
Reopening preserves the mode and rearms the next gesture; holding fists toggles once.
Both directions preserve the chord and root lock; M also merges.
Geometry is independent of the renderer.
Fists confirmed while apart remain eligible for split/merge when brought together
after root-lock arbitration. That approach preserves the current lock state.
Startup or reacquired fists require reopening; M clears eligibility until reopened.

Acceptance: midpoint/radius match wrist geometry, split conserves combined disc
area, lost body/hand wrist positions hide their visuals and silence output,
loss of detailed finger recognition alone leaves body-driven geometry/audio active,
reacquisition preserves
mode. No depth or true 3D is claimed. Render and inspect deterministic examples.

## US3 — Reachable roots and musical qualities (P3, idea 2)

As a musician I can reach every one of 12 roots and 25 qualities (300 chords)
from every starting chord, using signed interval controls or midpoint-region dwell
and absolute quality selection. The [approved interval map](relative-root.md) is
the default; T switches to the original midpoint mode without changing musical state.
Intervals apply once after neutral rearming and pair dwell; both up/down transpose
every sounding voice by an octave. Root lock freezes pitch class and register.

Acceptance: symbols and tone sets match the complete map in chord-map.md, including
6, 6/9, 9, 11, 13, suspended, augmented and altered qualities. Every tone in the
chosen three-to-six-note voicing sounds; 13ths include 9 and 13 and omit natural 11.
Quality choices never move a locked root; ordered hand pairs replace conflict priority.
The prototype sounds chords locally and exposes
the selected chord clearly. It does not send full chords to Expressive Chords.
An open palm is an explicit member of the ordered pair, so left and right shortcuts
can differ. A non-palm pair must stay unchanged for quality dwell to select it.
Brief reopening, neutral/unknown hands and tracking loss preserve quality. Returning
to major requires both reliable open palms continuously for the configured 1.5s dwell.

## Required validation

Automated tests are explicitly required by this spec for timing/state transitions,
all 300 musical states, missing/invalid data, render geometry, and silent device-free
audio generation. A scripted native replay must exercise all three stories without
camera/models/audio hardware; local model smoke validation must run separately.
Measure core update latency (p95 < 5 ms on replay frames); record camera/model
performance separately rather than claiming a hardware-independent latency.
Manual camera/gesture usability and listening remain acceptance observations,
not facts that can be inferred from unit tests.
