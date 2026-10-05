# Anthony's Vision for dance2music

Last updated: 2026-10-05. This is a living vision and planning document for Anthony to revise.
It records desired behavior, existing capabilities, accepted decisions, and possible design flaws.
Suggestions and open questions are not approved implementation choices.

## Project purpose and starting point

dance2music turns movement into music: pose tracking and cleaned motion provide meaningful control
over harmony, sound, and musical expression. The original work explores dance videos through
MediaPipe, kinematics, Laban Efforts, voice-led harmony, and synthesized comparisons.

Anthony's direction is to make this an instrument a musician can deliberately play with the body
and hands. A visible ball makes the relationship between movement and sound tangible. Chords are
chosen and transformed intentionally, with spell-like gestures and a beginner mode to teach them.
The same musical decisions can control Ableton instead of relying on the built-in synthesizer.

The existing Python analysis/rendering pipeline and JavaScript live app are distinct. In particular,
running `python live.py` starts a local web server; it does not run the live gesture logic in Python.
New live features therefore need a genuine local Python implementation before any web translation.

**Stage 1 implementation, 2026-10-04:** Ideas 0–2 now have a native Python prototype
in `instrument/`: persistent root locking, Joseph-inspired temporary 2D glow with
nearby-fist persistent split, and all 12 roots with six absolute quality gestures.
Anthony approved those provisional mappings and keyboard M merge during implementation.
See [quickstart](specs/001-anthony-instrument/quickstart.md),
[spec/tasks](specs/001-anthony-instrument/tasks.md),
[decisions for review](specs/001-anthony-instrument/decisions.md), and
[validation evidence](specs/001-anthony-instrument/evidence.md).
The original vision and design risks below remain relevant. Human gesture/listening
acceptance is still pending; 3D, extra finger-pattern modes, spells, game and MIDI
remain future work. The website has not been translated or changed by this feature.

| Area | Existing capability | Proposed direction |
| --- | --- | --- |
| Python | Recorded-video pose/motion analysis, harmony, sound rendering, MIDI-file workflows | Local live prototype for the new interactions and MIDI output |
| Live web app | Camera/video tracking, hand recognition, six chord regions, finger-count selection, synthesis and recording | Later translation of validated Python behavior, on explicit request |
| Ball | One visual ball from the 2D wrist midpoint and spacing; sphere-size sound mappings | Reuse Joseph's visual design in Python first; two-ball interactions and later 3D |
| Harmony | A predefined harmonic palette, dwell filtering, and voice leading | Independent root selection and gesture-driven chord-quality changes |
| Fist | Default chord hold while the fist is recognized | Persistent root-lock toggle, with quality gestures still active |
| Ableton | Existing offline MIDI described for the SWAM/rope workflow | A live single-note trigger per selected chord for Expressive Chords |

Source context: [README.md](README.md), [IDEAS.md](IDEAS.md), [live.py](live.py),
[web/live/live.js](web/live/live.js), [web/live/hands.js](web/live/hands.js),
[web/live/harmony.js](web/live/harmony.js), and [web/live/features.js](web/live/features.js).
These are references to current behavior, not instructions to modify the website now.

## Working stages

1. **Stage 1: local Python.** Implement and run the selected feature locally, establish observable
   behavior, test it, and review the interaction with Anthony. Camera input, gestures, musical state,
   MIDI output, and visual feedback belong here when required by the selected feature.
2. **Stage 2: JavaScript website translation.** Begin only when Anthony explicitly requests the port
   of a named feature or scope. Preserve the validated behavior and check browser-specific differences.

Completing Stage 1 does not start Stage 2 automatically. A local web port does not authorize a push,
deployment, or upload. Existing web behavior is useful reference material while Python is developed.

## Priorities and accepted decisions

| Item | Direction |
| --- | --- |
| First implementation priority | Persistent fist root-lock toggle |
| High-priority integration | Ableton / Expressive Chords using one MIDI trigger note per chord |
| Remaining ideas | Preserve all ideas below; their relative implementation order is not yet agreed |
| Lock lifecycle | A fist closure locks; a later fist closure unlocks. Reopening alone does not unlock. |
| Locked harmony | Root selection stays fixed; chord-quality gestures remain active. |
| Two-fist conflict | Nearby closed fists split the ball and suppress the chord-lock toggle. |
| Initial ball scope | Reuse Joseph's glowing 2D ball design in the local Python prototype; defer depth/3D work. |
| Spell structure | Three moves recognized in a specific order. |
| Split lifecycle | Two-ball mode persists after the hands open; a separate merge gesture is still to be designed. |

These interaction decisions were explicitly confirmed by Anthony on 2026-10-04.
The initial ball scope was revised after reviewing Joseph's implementation: the temporary 2D
design supersedes the earlier decision to start with estimated-depth 3D. The future 3D vision remains.

## 0. First task: persistent fist root lock

**Vision.** Turn the existing fist hold into a toggle. The performer can select a root using a
region or another root-selection method, close a fist to keep that root, then move freely without
quadrant/region changes changing it. Closing a fist again unlocks root selection.

The lock affects the root, not every aspect of the chord. For example, a locked G root can still
become G minor or G dominant through the corresponding quality gestures. A closed fist held over
many frames is one deliberate action, not a stream of toggles. Nearby closed fists intended to split
the ball must not also change the root-lock state.

**Possible design flaws.**

- Recognition flicker can create repeated close events and accidentally undo a lock. The event
  needs a stable closure and a deliberate rearm condition; exact timing requires validation.
- Two hands closing in the same gesture can toggle twice and cancel the result. Hand assignment
  and treatment of simultaneous events need an explicit policy.
- A single-fist event may arrive before the second nearby fist is recognized. Detecting a split
  later must not leave an unintended lock change; gesture arbitration timing is a design decision.
- If region candidates keep changing while locked, unlocking can immediately jump to a region
  the performer did not intend. The unlock/dwell policy needs a deliberate choice.
- A persistent lock can be hard to remember. Visual feedback must distinguish the selected root,
  current chord quality, and lock state.
- Tracking loss, restart, and a missed unlock can leave an unexpected state. Recovery and a clear
  reset action must be specified before live use.

**Questions for design.** Which hand toggles the lock? How does the detector rearm? On unlock,
does a fresh dwell begin? Which reset action and tracking-loss policy are appropriate?

**Python validation direction.** Replay timestamped hand and root-selection events: lock, reopen,
move across regions, change quality, close again, and unlock. Include flicker, both-hand events,
tracking loss, and split gestures. The accepted behavior must be deterministic before a web port.

## 1. A 3D ball between the hands, with two-ball modes

**Vision.** Evolve the central ball into a 3D object the performer manipulates. In some modes,
finger patterns split it into two balls, one associated with each hand. The exact nearby-fist
split gesture is described in idea 5; other finger patterns and mode mappings are still open.

**Accepted starting point, revised 2026-10-04.** Reuse Joseph Bakarji's glowing 2D ball design
as the temporary visual in the local Python prototype. Defer depth control and true 3D rendering
until later. This replaces the earlier 3D-first starting point, while preserving the long-term
3D and animator-supplied asset goals. Root locking, musical gestures, and MIDI can be developed
without making the initial prototype depend on 3D.

**What Joseph implemented.** Commit `0c019b6` on 2026-10-01 added the ball in the JavaScript
live app: a 2D radial glow at the wrists' midpoint, radius equal to half their image-plane
distance, a fire or chord-colored light style, and flicker/sparks driven partly by motion energy.
The normalized sphere-size source can drive whole-instrument gain. The `Sphere` preset uses a
cubic size curve; `Sphere, gentle` uses exponent 1.5; `Sphere + vowel` also maps hands' height to
the choir vowel and sphere size to pad brightness. The same commit added five pad timbres.

**Reuse boundary.** Reuse the visual concept, wrist geometry, and useful mappings. Its renderer
is browser JavaScript using Canvas 2D, so the Python prototype needs a Python rendering adaptation;
running `live.py` is not that adaptation. The current ball has no true depth control, split/merge
state, rotation-driven effect, hold-duration color behavior, or animator-asset interface.

For later planning, keep musical/gesture state independent of the drawing method so a future
3D renderer can display the same instrument behavior. Depth-dependent interactions will still need
their own validation when introduced; a 2D prototype cannot validate those by itself.

**Future animated asset.** Anthony may obtain a finished 3D animation from an animator. The
instrument should eventually drive that asset's expressive qualities, for example getting bigger
when the hands open, spinning when the hands spin, and changing color after being held for a
certain time. Finger/palm openness and distance between the hands are distinct controls; they
must not be silently treated as the same input. These examples do not yet define thresholds,
axis conventions, the meaning of "held," or the animator's asset format.

The ball should make musical control understandable: where it is, how it moves, and what the
hands do to it correspond to audible changes. The existing size-to-volume mapping is a starting
point, not a commitment that every new mode must use it.

**Possible design flaws.**

- A 3D-looking object and an object controlled with estimated depth are different designs.
  The current ball uses image-plane wrists; adding a shader alone does not add depth interaction.
- The temporary 2D ball is useful for validating gestures and musical control, but cannot prove
  that reach, depth collisions, or hand motion toward the camera work in a future 3D design.
- The existing glow is rotationally symmetric, so spinning it alone may be visually invisible.
  A rotation effect needs directional particles, markings, or a future asset with visible orientation.
- Camera-estimated depth can be noisy, especially when hands overlap or move toward the camera.
  Calibration, confidence handling, smoothing, and coordinate conventions need validation.
- Combining body and hand estimates without a shared frame can make balls drift or jump.
- Changing from one ball to two can abruptly double loudness or alter timbre. Visual size and
  musical energy need an explicit split/merge policy.
- Finger patterns already participate in chord selection. Reusing them for ball modes can make
  one gesture alter several unrelated musical controls.
- Rendering and inference compete for responsiveness. A visually convincing effect must not
  make musical control lag or hide the hands needed for tracking.
- A finished animation may have no exposed scale, rotation, color, hand anchors, or split behavior.
  An asset/control agreement with the animator is needed; arbitrary files cannot be assumed to
  support these interactions. Two-hand mode may require two instances or a supplied split animation.
- Hand rotation estimates can jump or reverse under occlusion, mirroring, or axis changes. Spinning
  a visual object and using that rotation as a musical gesture need consistent conventions.
- A hold-time color change can conflict with existing chord colors or reset unexpectedly on a
  short tracking gap. Timing semantics and distinct feedback roles need an explicit design.

**Questions for design.** What does each ball control musically? Which finger patterns select
which modes? What counts as holding the ball? What controls can a future animator's asset expose,
and which renderer/asset format supports those controls when the 3D stage is requested?

## 2. Musician-oriented harmony: roots and qualities

**Vision.** Make harmonic actions musically understandable and avoid being trapped in the current
fixed palette. From whichever chord is active, the performer should have a path to every chord
in the chosen musical vocabulary. Select a root through regions or another agreed method;
use gestures to change its quality independently.

Anthony's examples include G becoming minor, minor-major, or dominant. A possible interpretation
is G -> Gm -> Gm(maj7) -> G7; the meaning of "minor-major" and the exact extensions/voicings
must be confirmed before that catalogue is implemented. Root locking allows these transformations
without accidental region-driven root changes.

**Possible design flaws.**

- The existing six regions do not by themselves provide a route to every possible root and
  quality. The reachable catalogue and root-navigation mechanism must be explicit.
- A gesture that changes root and quality at once can make the instrument unpredictable. Keep
  those concepts distinct in the musical state, even if some future shortcuts combine them.
- Treating transformations only as relative steps can strand some chords or depend on the route
  taken. Check reachability from every supported starting chord and provide clear state feedback.
- Quality names can hide different intentions: a minor triad, minor seventh, and minor-major
  seventh are distinct. Extensions, inversions, register, and voicing must not be silently chosen.
- Voice leading is relevant for local synthesis; the plugin's configured chord voicings may differ.
  A label alone does not guarantee that both outputs sound like the same intended harmony.
- Broad harmonic access conflicts with a small, memorable gesture vocabulary. Expert freedom and
  beginner restrictions may need distinct modes rather than a single crowded mapping.

**Questions for design.** What is the initial root/quality catalogue? How are roots beyond the
current regions reached? Are quality gestures absolute selections or relative transformations?
How are missing Expressive Chords mappings reported?

## 3. Chords as three-move magic spells

**Vision.** Offer an alternative to region-based chord selection: a combination of three moves
acts as an incantation that activates a chord. Spells should be learnable, intentional, and
usable from any current musical state, with enough feedback to know what was recognized.

**Accepted rule.** The three moves are performed in order. Each partial sequence needs a visible
progress state, and only a complete recognized spell activates its intended musical action.

**Possible design flaws.**

- Ordered moves need clear start/completion boundaries, time windows, and release/rearm rules.
  A held pose must not be counted as multiple successive moves without an intentional rule.
- Natural dancing can accidentally contain a spell. Recognition needs a clear distinction between
  deliberate input and ordinary movement without making performance cumbersome.
- Partially matching spells can overlap. Prefixes, timeouts, cancellation, and mistakes require
  an explicit recognition policy.
- A three-move command takes time. The performer needs predictable timing for when the chord
  changes; musical anticipation or quantization must be a deliberate mode choice.
- Generic confidence/timing thresholds may exclude different bodies, tempos, or mobility ranges.
- Locking, splitting, and spell recognition share the same hands. A gesture must have a defined
  role in the active mode rather than accidentally trigger several systems.

**Questions for design.** What movement vocabulary forms a spell? Does a spell choose a full
chord, a root, or a quality? How are partial spells shown, canceled, or timed out?

## 4. A beginner game that teaches the magic chords

**Vision.** Spawn objects or challenges around the performer that they touch or defeat using the
movement vocabulary. The game teaches the same spell/chord relationships used by the instrument,
so skills learned during play transfer to free musical performance.

**Possible design flaws.**

- Attractive visuals can turn the interaction into target chasing without teaching harmonic intent.
  Each challenge needs a recognizable musical lesson and feedback about the chord produced.
- Collision checks, gesture recognition, and camera calibration can disagree about a successful
  action. The game must explain misses rather than appear arbitrary.
- Tracking failure can punish the player unfairly. Distinguish uncertain sensing from incorrect
  musical or movement choices.
- Targets can be out of reach or force uncomfortable movements. Difficulty needs to account for
  space, body size, mobility, and camera framing.
- Game gestures that differ from the instrument vocabulary make learning fail to transfer.
- Rendering and game timing can add delay or distract from listening. Musical feedback needs to
  remain clear while the beginner learns the movements.

**Questions for design.** What does the first lesson teach? Does a player touch, strike, cast a
spell at, or otherwise defeat a target? Which harmonic freedoms are introduced at each level?

## 5. Nearby closed fists split the central ball

**Vision.** Closing both fists near each other splits the ball in the middle into two balls,
one attached to each fist/hand. This is the concrete split gesture for the mode in idea 1.

**Accepted rule.** The split gesture suppresses the chord-lock toggle. It must not silently
change the locked root or chord quality. Two-ball mode remains active after the hands open;
a separate merge gesture will be designed later. Reopening alone does not merge the balls.

**Possible design flaws.**

- Nearby hands occlude each other, which can make the split condition hardest to recognize
  at the exact moment it is needed. The system needs useful feedback when confidence is low.
- A fixed pixel-distance threshold behaves differently with body size and camera distance.
  Proximity should be evaluated in an agreed calibrated or body-relative frame.
- The first recognized fist may toggle the lock before the complete split gesture is recognized.
  Single-fist and two-fist events require coordinated arbitration, as described in idea 0.
- Without separate entry and exit rules, the ball can flicker between one and two modes.
- Hand identities can swap during crossing or occlusion, causing the two balls and their controls
  to exchange roles unless identity handling is stable.
- Splitting changes how musical energy is distributed. Two visuals must not imply two unrelated
  chord triggers unless that is explicitly designed.

**Questions for design.** What gesture merges the balls again? Do both balls share a chord or
have distinct musical roles? What happens if one
hand leaves the frame? The exact distance, dwell, and merge policy remain open.

## 6. Ableton / Expressive Chords through a virtual MIDI cable

**Vision.** Send musical decisions from the local Python prototype to Ableton through Anthony's
virtual MIDI cable. Anthony already knows how to connect the cable; the work is the instrument's
output and its mapping to the existing plugin setup.

**Required output model.** Each configured chord is triggered by one MIDI note in Expressive Chords,
as Anthony described. Send that chord's configured trigger note; do not send all the constituent
notes of a voiced chord. Trigger-note pitch identifies a plugin mapping and must not be assumed
to be the harmonic root. Local synthesis can still use a full voicing independently.

**Possible design flaws.**

- The Python chord catalogue and the plugin's configured trigger map can drift apart. Each
  chord identifier needs a matching, inspectable mapping to a port, channel, and note number.
- Sending a note on every camera frame retriggers a chord repeatedly. Musical state changes and
  deliberate retriggers need an explicit event model.
- Note-off behavior depends on how the plugin is configured. Short triggers, held notes, latch
  behavior, and changing chords must be tested with Anthony's actual setup before choosing a policy.
- A stuck note or an interrupted MIDI connection can leave unwanted sound. Stop, error recovery,
  and a manual panic/reset need a defined cleanup contract.
- Root-lock quality changes still represent different chords and may need different trigger notes.
  The lock must not accidentally suppress those musical changes.
- A broad root/quality catalogue can exceed the available configured trigger mappings. Catalogue
  size and any bank/channel scheme need agreement; unlimited chord access cannot be assumed.
- Output latency and jitter affect playability. Measure gesture recognition through chord decision
  to MIDI emission, then evaluate the audible result in Ableton separately.

**Questions for design.** What is Anthony's configured chord-to-trigger-note table? Which port and
channel should be used? Does the plugin expect a held note or a pulse? How should a repeated same
chord and an unmapped chord behave? These details need confirmation, not a guessed plugin preset.

## Implementation boundaries and next review

The active feature is [001-anthony-instrument](specs/001-anthony-instrument/spec.md).
Its specification, plan, tasks, confirmed/provisional decisions and quickstart exist.
Ideas 0–2 have a native Python implementation. On 2026-10-05 the resumed work passed
28 automated tests, lint, formatting, types, offline model loading, native window
and audio-stream smoke checks, and deterministic replay. Core replay p95 remained
below the specified 5 ms budget. Details and limits are in
[evidence.md](specs/001-anthony-instrument/evidence.md).

The short camera smoke exercised capture and inference with no hands or torso detected;
it does not establish live gesture usability. Performer timing, all six gesture mappings
and subjective listening still need Anthony's review. The thresholds and choices in
decisions.md remain provisional. The original questions above describe risks and future
choices; the current feature's confirmed answers are recorded in its spec and decisions.

Ableton MIDI remains a high-priority next feature, after agreeing on the chord trigger
table, port/channel and note lifecycle. Spells, the game, extra finger-pattern modes
and 3D need their own specifications and decisions. Website translation requires
Anthony's explicit instruction; no browser feature code changed in this implementation.
