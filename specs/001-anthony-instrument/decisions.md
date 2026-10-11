# Decisions made during ideas 0–2 implementation

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
