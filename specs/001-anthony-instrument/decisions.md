# Decisions made during ideas 0–2 implementation

## Opposite relative-root mappings, 2026-10-15

Anthony requested both left/right = fourth down/up and left-right/right-left =
equal/opposite steps. He corrected the proposed mixed-pair rule: keep the
horizontal direction fixed and flip only up/down, e.g. left-up ↔ left-down and
right-up ↔ right-down. Apply the rule whichever hand supplies the vertical
component. Retain both up/down octaves and the opposed tritone pair; all 12
notes remain reachable. The [revised map](relative-root.md) documents native IDs
and the website's transposed display labels. This supersedes the original
2026-10-12 interval assignments without changing quality/hand tracking or MIDI.


## Direct chord MIDI, 2026-10-12

Anthony requested chord work on ableton, then explicitly said to forget
Expressive Chords and use direct synth input. This supersedes the proposed
chord-to-trigger table and its unmapped-chord policy: send every existing voiced
note, not one plugin selector. He confirmed **hold while the ball is active;
P pauses/resumes**, rather than a latched chord that survives tracking loss.
Use `--midi-chords` and `dance2music - Chords to Ableton`; retain the earlier
single-root command/cable. Notes use the controller's current voicing and register;
the existing replacement contract releases the previous voicing before starting
the changed one. No continuous MIDI volume or plugin configuration is included.

## First Ableton MIDI stage, 2026-10-12

Anthony requested clear virtual cable names and one note before later chord work.
He chose the **current root note** over a fixed test note, and **hold while active**
over pulses. This makes interval/octave gestures directly playable on an Ableton
instrument and defers the Expressive Chords mapping until the chord stage.
Active source: `dance2music - Notes to Ableton`; reserve
`dance2music - Chords to Ableton` for later without opening it now.
The [MIDI contract](midi-output.md) defines channel/velocity defaults, active-ball
gating, replacement/release, P pause/resume, opt-in ports and cleanup. Optional
python-rtmidi is isolated at the device boundary. No full chords, plugin preset
assumptions, continuous CC volume, website translation or external publication.

## Persistent one-hand transfer, 2026-10-12

Anthony accepted persistent ownership and captured size/gain after requesting
fist + palm alongside split/merge. He then explicitly corrected the direction:
the ball must transfer **from palm to fist**, superseding the initial palm receiver.
After reopening to arm, a confirmed
fist opposite an open palm transfers the single ball to the fist's body hand ID.
This consumes the closure without toggling root lock. Keep the 0.35s closure and
0.25s arbitration window so nearby fists can still take priority. A changing or
lost transfer pair cancels the action; reopen before retrying.

Ownership persists after relaxing and across tracking loss. M restores the midpoint;
nearby fists merge the owned ball back to midpoint, just as they merge split balls.
Anthony explicitly confirmed this common return gesture: both fists must be closed
and within 1.0 torso length. From midpoint, the next nearby closure splits the ball.
Reset clears ownership. A transfer from split consolidates both balls into the
fist hand. Capture radius in torso units and gain at transfer, preserving apparent
body-relative size and loudness without requiring the other wrist. A missing owner
or torso hides the ball and mutes it; recovery resumes the same owner and values.
Fist + a recognized non-palm sign (or two distant fists) still toggles root lock.
Transfer preserves chord and lock; root and quality controls otherwise keep working.

Anthony explicitly confirmed area conservation for split-ball energy transfer:
add the two visible disc areas, not their radii. New radius is
`sqrt(receiver_radius² + donor_radius²)`; two radius-40 balls yield radius ~57.
The donor disappears, the receiver belongs to the fist, and shared gain is retained.
Capture once per deliberate closure; held gestures cannot repeatedly inflate energy.

## Relative root control and mode switch, 2026-10-12

Anthony approved the [signed interval map](relative-root.md) as the default instead
of midpoint selection, while requesting a keyboard switch between both modes.
T toggles modes, preserving musical/lock/ball state. Both-up/down changes actual
register by +/-12, rather than wrapping pitch class. Fist lock freezes both.
Neutral rearming makes each pose apply once; torso-normalized separate-hand positions
provide distance-independent controls. Initial neutral/axis/timing parameters and
MIDI bounds are documented in the map; performer validation remains pending.
Anthony also requested a wider split distance: default 1.0 torso length replaces 0.6.

## Swap live hand assignments, 2026-10-12

Anthony reported his left hand appearing as right and requested flipping hand logic.
For mirrored camera/video input, L now follows pose wrist/elbow 16/14 and R follows
15/13. A shared mapping applies to both wrist geometry and gesture crops, so labels
and ordered chord controls agree. Assignments follow joints across crossed hands;
they do not depend on screen position. Recorded JSONL hand IDs are preserved, so
older recordings keep their prior interpretation. Live performer confirmation is pending.

## Complete 25-cell catalogue and fuller sound, 2026-10-11

Anthony approved the [25-cell ordered hand map](chord-map.md), including changed
left-hand shortcuts with right palm (Point = m6, thumb up = 6, thumb down = 6/9)
and both Victory signs = augmented. This yields 25 qualities across 12 roots,
300 selectable chord identifiers. Point means index up, other fingers curled and
thumb tucked. Body-side hand identity determines each cell, including crossed hands.

Both reliable non-fist signs are required; missing/unknown/low-confidence/fist/heart
pairs hold quality. This replaces all single-hand fallback and priority rules below.
The ordinary quality dwell remains 0.35s after model confirmation; both palms retain
the separate 1.5s major reset. Fists still control root lock and ball mode. Root
selection remains independent, so an unlocked root can change while quality is held.

Anthony chose fuller five/six-note voicings for extensions rather than compact
omissions. All explicitly defined tones sound; thirteenths include ninths and omit
the natural eleventh. Six persistent oscillator slots preserve smooth transitions.
Bounded assignment replaces factorial voice-leading search while retaining its
total-movement, maximum-movement and note-order priorities. No new gesture training,
threshold changes, dependencies, MIDI or JavaScript translation are included.
Earlier eight/six-quality and incomplete-pair shortcut decisions below are historical.

## Ordered hand chord selections, 2026-10-11

Anthony requested different meanings for left/right signs and all possible pairings.
He chose right thumb up + left thumb down = minor-major seventh, with the reverse
pair = dominant seventh. With the other hand open, right Victory = diminished seventh
and left Victory = half-diminished seventh. Explicit pairs take priority over existing
supported single-hand shortcuts; other unsupported pairs retain the existing supported
shortcut policy or hold quality. Two Victory signs currently hold quality. Body identity,
not image position or tuple order, determines left/right, including crossed hands.
Anthony excluded the love/heart sign because it did not work; ILoveYou cannot select
quality or rearm fist controls in Python. No model training or recognition thresholds changed.

The current catalogue is eight qualities x 12 roots = 96 chords. Five non-fist signs
per hand provide 25 ordered two-hand slots, potentially 300 chords only after all slots
have distinct assignments. The remaining assignments are not approved or implemented.
Fists remain reserved for lock and ball controls. The prior six-single-sign mapping below
is historical and superseded where it conflicts with this decision.

## Same gesture for split and merge, 2026-10-11

Anthony explicitly requested the same action that splits the ball to merge it again.
Nearby confirmed fists now toggle one ball into two or two into one. Each accepted
closure changes mode once; reopening rearms it. Both directions suppress pending
root-lock toggles and preserve the existing chord and lock. M remains a keyboard
merge shortcut. This supersedes the earlier separate/deferred merge gesture.
Confidence, dwell and proximity thresholds are unchanged.

## Split trigger correction, 2026-10-11

Anthony reported ONE BALL while both confirmed hand labels showed Closed_Fist.
The controller reproduced a failure when fists closed while apart and were brought
together after root-lock arbitration: their closure events had already been consumed.
Retain eligibility for the current recognized closure until reopening, gesture loss,
split, merge or controller reset. This implements the tutorial's bring-fists-together
interaction without requiring another closure at the proximity boundary. A later
split preserves the existing lock; nearby closures still suppress a pending toggle.
The recognition confidence, dwell and proximity values remain unchanged. Live
confirmation on Anthony's actual gesture is still required.

2026-10-04. This file separates Anthony's answers from implementation defaults.

## Confirmed by Anthony

- Python first; no JavaScript translation or pushes.
- Persistent root-only toggle; nearby split suppresses toggle; split persists.
- Joseph-inspired 2D visual temporarily; true 3D and animator assets deferred.
- During this task: all 12 roots, six absolute gesture-quality mappings listed in
  spec.md, either hand locks, M merges, stable reopen rearms after tracking loss.

## Agent choices, provisional and open to revision

| Choice | Reason / consequence |
| --- | --- |
| Native OpenCV window, MediaPipe Tasks, NumPy and optional sounddevice | Uses existing technology; avoids browser port and new GUI framework. |
| Ring C at screen right, chromatic roots clockwise, 0.25-torso central dead zone | Every root reachable; denser than six regions. Screen is mirrored before inference/display, so ring and display agree. |
| 0.35 s closure/quality/root dwell, 0.20 s reopen, 0.25 s arbitration, 0.20 s maximum frame gap | Reduces accidental actions; fist response around 0.60 s is intentionally slower and needs human tuning. |
| Nearby means wrist separation <= 0.6 torso lengths | Scale independent but a provisional threshold. |
| Right-labeled hand wins conflicting non-palm quality selections | Deterministic; either hand works, with an ordinary open palm treated as neutral. Pose-guided crops use body side IDs. |
| Unknown/low-confidence gestures never rearm or select quality | Avoids flicker triggering extra toggles; deliberate recognized non-fist is required. |
| Startup fists do nothing until reopened; loss preserves chord/lock/split but cancels pending actions | Avoids phantom toggles; R resets to C major/unlocked/merged. |
| No audio while both reliable hand positions and torso are unavailable | Prevents stale musical output. Split with one hand missing shows only the present ball but stays muted. |
| Split radii are merged radius / sqrt(2), with shared spacing gain | Conserves visual area and avoids doubling loudness. No separate music per ball yet. |
| Six qualities only, minor-major means minor-major seventh | Covers the explicitly approved mapping; arbitrary extensions and inversions remain future catalogue work. |
| Triads have three voices, sevenths four; root at MIDI 48–59 initially | Small predictable local synth; voicings stay 48–83 and move minimally where possible. Plugin voicings are not assumed. |
| Both recognized open palms held 1.5s select major; brief reopening only rearms | Anthony's 2026-10-11 revision prevents an ordinary resting palm from resetting quality. |
| Demo, replay, video and camera modes share the same controller | Makes state behavior testable without hardware and permits deterministic reproduction. |

Direct dependency/model downloads are setup, not web research, and upload no
project content. No runtime downloads occur. Tests do not need model files.
Any unexpected limitations found during validation will be recorded in evidence.md.

## Resume validation, 2026-10-05

The existing choices above were retained. Corrections enforce the existing contracts:
WAV events start at their observation timestamps, the configured root dead-zone guide
matches selection, invalid/nonfinite tracking scores are rejected, malformed replay
input reports its line, and sample rates must be valid integer Hz. Audio export uses
bounded chunks even across long frame gaps. No new gesture or musical mapping was chosen.

Automated and device-boundary validation is recorded in evidence.md. The camera smoke
had no visible hands/body; live gesture usability and subjective listening are still
human acceptance checks. Thresholds are unchanged pending that review.

## Performer feedback and decisions, 2026-10-11

Anthony reported that the prototype showed only hands, required front-facing palms
for the ball, tracked hands poorly and sounded too quiet compared with original main.
He requested whole-body tracking like the website, persistent chord choices and
ROOT LOCKED feedback on deliberate fist closure. This comparison is recorded here;
it is a performer observation, not a measured comparison of model accuracy.

Anthony chose BOTH open palms held continuously for 1.5s to return to major. Other
quality signs retain their 0.35s dwell; a resting palm cannot win over a special sign.
He explicitly retained nearby-fist split priority: either fist or two separated fists
toggle the root lock; nearby paired fists split. Reopening does not clear the lock.

Implementation uses the website's wrist/forearm crop geometry and 0.3 hand-model
detection/presence/tracking thresholds with separate video recognizers per hand.
Body wrists control geometry independently of finger recognition. Current body
positions use a causal 40ms filter with immediate missing-joint clearing. There is
no stale gesture hold or inferred fist when hand recognition disappears.

Volume tuning is provisional: full sphere gain at 0.75 torso radii instead of 1.5,
and synth summed oscillator amplitude 0.7 instead of 0.18, retaining smoothing
and headroom. --volume in [0,1] scales playback and exported WAVs. No dependencies,
model artifacts or browser feature logic changed. Live acceptance remains required.

During the same retest Anthony confirmed that closed fists showed None while finger
joint lines remained visible. A conservative 3D joint fallback now recognizes four
curled compact fingers with a tucked thumb. Four clearly extended fingers can rearm
the fist gate when the canned label remains None, without selecting major. Raw model
labels/scores remain available; no classifier confidence is fabricated. Fresh geometry
flags are recorded for replay. Point/thumb signs and uncertain/missing joints cannot
silently become a fist. Existing dwell and split arbitration still apply.

Anthony also requested the full camera view. The 110px controls panel now sits above
the image, instead of obscuring its upper rows; a resizable window preserves the whole
frame's proportions. Camera mode requests 1280x720 with width/height overrides. On
Windows, DirectShow/MJPEG replaced the default Media Foundation capture after the
latter failed to provide frames at the wider mode; the actual camera check then passed.
Coordinates remain in source-camera pixels; exported previews include the added panel.

### Subsequent retest: match web/main fist detection (2026-10-11)

Anthony reported alternating fist detection and explicitly requested web/main's
method. This supersedes the preceding geometric fallback. Python now ports
`web/live/hands.js` far mode: one alternating 256px wrist crop per frame,
1.1 torso crop size, 0.35 forearm reach, model detection/presence/tracking minima
of 0.3, and pose-assigned sides without the extra nearest-wrist rejection.
Canned confidence >=0.5 and a continuous 0.35s candidate confirm label changes,
including None. Missing detections retain hand state for 0.4s. Finger geometry
does not classify fists or rearm unknown hands. The same public gesture task is
used; Python remains CPU/VIDEO with the Lite body model.

Confirmed closure's candidate start counts toward controller dwell, avoiding a
second 0.35s delay. Anthony's persistent lock, nearby-fist split priority, sticky
quality and two-palm major reset remain the musical controls. Confirmed/raw labels
are shown separately in bold black. Fresh body wrists remain necessary for ball
geometry, even with cached hand details. New replay metadata preserves these
labels and candidate time; legacy geometry flags are ignored. Performer acceptance
is pending.
# Authorized web translation, 2026-10-13

Anthony explicitly requested all implemented native instrument behavior in the
JavaScript web app, excluding Ableton/MIDI, with work remaining local on
`anthony-explorations`. Relevant main updates may be merged into this branch.
He selected tracking and sound on the iPhone; the laptop serves the website.
The [web-port contract](web-port.md) records preserved Python behavior and
browser adaptations. Future spells, games and 3D were not included as implemented
features. Existing thresholds/maps remain authoritative and unchanged.

## Desktop MIDI authorization, 2026-10-13

Anthony now requested desktop Chrome/Edge/Firefox routing and chose both
**All chord notes** and **One root note** under an Ableton section. This supersedes
the preceding exclusion for desktop MIDI only; phone MIDI is deferred. The
[desktop MIDI contract](desktop-midi.md) records Python-first validation,
browser adaptation, explicit permission/port selection and note release behavior.
Root-only currently ignores quality changes in MIDI; Anthony explicitly requested
T075 to define their future musical effect. All-note mode preserves native voiced
pitches, but uses discrete MIDI pitch changes rather than Web Audio glides.
