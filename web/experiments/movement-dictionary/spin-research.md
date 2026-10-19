# Anthony's body-spin experiment

Work belongs to `codex/anthony-movement-dictionary` in Anthony's fork. The branch
starts at the locally merged Joseph experiments; it does not change `main` or
`ableton`. Development and verification are local until publication is authorized.
Browser preferences use `md:anthony:` storage keys and can read Joseph's existing
`md:` values as initial defaults. Anthony's controls never write to Joseph's keys;
in particular, the added Body turns selection cannot break the original page's
study menu when the same Safari origin later serves a different branch.

## What exists

Joseph's `measure.js` derives yaw from the 3D shoulder line and smooths its
angular speed with a 0.2 s time constant. More than 90 degrees/s enables the spin
effect in Circles/Together. It does not count complete turns, check the hips,
use hand/leg ordering, or reject orientation jumps. Its general landmark store
retains previous points when a new point is invisible, so that store cannot
by itself distinguish fresh spin evidence from an old observation.

## Research reviewed on 2026-10-19

- [MediaPipe Pose Landmarker, official web documentation](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js):
  supplies 33 image and estimated 3D world landmarks plus visibility. It does
  not supply a completed-spin event. Existing pose wrists, knees and ankles
  can be reused without a new hand or face model.
- [BlazePose GHUM Holistic](https://arxiv.org/abs/2206.11678), Grishchenko et al.,
  2022: a real-time single-RGB-image 3D body estimation pipeline. Its estimated
  depth is useful evidence, not a measured motion-capture ground truth.
- [MEBOW](https://arxiv.org/abs/2011.13688), Wu et al., CVPR 2020:
  estimates body orientation directly from images; motivates a separate
  orientation model when ambiguous or occluded joints make a skeleton
  insufficient. This is a possible later experiment, not an installed model.
- [VideoPose3D](https://arxiv.org/abs/1811.11742), Pavllo et al., CVPR 2019:
  uses temporal convolutions over 2D keypoints to improve video pose estimates.
  It supports investigating temporal evidence; it does not validate our
  proposed lightweight spin-counting thresholds.

## Accepted experiment, 2026-10-19

Estimate torso yaw over time using shoulders and hips; check whether hands and
legs change horizontal ordering consistently with the torso's rotation. The
hands alone can cross without a turn; the legs can cross during a step. A
face becoming less visible can support an interpretation but cannot establish
a back view by itself: the dancer can look away, cover the face or leave frame.
Pose face-landmark visibility is not an independent face detector.

Anthony chose **combined torso + hands/legs evidence** and **180-degree half-turn
counting**. Requiring both hands and legs was rejected because either group may
be occluded. A 360-degree turn therefore counts as two half turns. No new model
or face detector is installed; face cues are only the existing pose model's
nose/eye landmark visibility, never a front/back classification.

Anthony subsequently requested **90-degree quarter turns as well**. The primary
display counts quarters, retains separate half-turn totals, and shows progress
to the next 90 degrees. Turning continuously through 360 degrees gives four
quarters and two halves. Quarter turns in opposite directions are independent
events; they cannot be combined to manufacture a half turn.

## Implemented contract

`instrument/body_spin.py` is the Python reference; `spin.js` is its browser
translation. A fresh shoulder axis and hip axis must both be available and
agree within 45 degrees. Their confidence-weighted circular mean gives yaw.
Wrapped consecutive differences accumulate rotation without a discontinuity at
±180 degrees. Heading is not derived from limb crossings.

For half-turn counting, at least one hand or leg pair must change image horizontal order,
hold that order for 50 ms, align with the world torso within 60 degrees, and
agree with the torso's image order. A 12%-of-image-torso separation dead zone
treats profile overlap as unknown. Knees are preferred, ankles are a fallback;
these are pose wrists/leg joints, not finger tracking. A pending limb swap may
wait up to 300 ms for the torso to emerge from profile. At least 45 degrees of
body rotation must already have occurred when accepting that evidence.

For a quarter turn, an image-order swap cannot be mandatory: at 90 degrees,
limbs can overlap in profile. Instead at least one fresh wrist or knee/ankle
axis must stay aligned with the torso and rotate at least 45 degrees from its
initial aligned heading in that half-turn segment. The torso must reach the
full 90-degree milestone. The same group must have a valid initial observation;
reappearing after more than 300 ms resets its baseline and cannot retroactively
confirm an unseen turn. Baselines also reset on direction reversal and at each
half-turn boundary. This is an experimental depth-based corroboration, subject
to the existing monocular pose limitations.

Each 90-degree milestone counts at most once despite jitter around the boundary.
If evidence arrives late, at most one currently corroborated quarter counts;
unobserved quarters are never filled in. The original half-turn swap rule stays
independent. Both counters reset with Reset turns/Start and persist across pose
loss; partial progress resets under the existing gap/reversal rules.

Every net 180 degrees produces one count/event when supported; otherwise it is
reported as unconfirmed and the next half-turn segment begins. Small backward
jitter cancels accumulated progress. A 20-degree reversal starts a new partial
turn from the previous extreme; opposite partial turns cannot be added together
as distance travelled. Counts persist through tracking loss; partial progress
resets after a 300 ms gap. Restart and Reset turns clear the counts.

Fresh image/world point coordinates must be finite, with visibility and presence
at least 0.5 where supplied. The algorithm never reads the dictionary's retained
landmark store. Missing torso observations pause detection without extrapolation.
Steps above min(75 degrees/frame, 720 degrees/s × elapsed time + 3 degrees) are
rejected and rebase the path, preventing a sudden 180-degree label swap from
counting. These thresholds are provisional engineering choices, not values
established by the cited papers. The browser compares its constants and outputs
against the Python reference in automated tests.

Speed is smoothed causally over 120 ms. Above 90 degrees/s, an aligned visible
limb enables the existing stereo movement. The stereo phase now uses measured
yaw rather than assuming 30 fps. Counting does not add a note/chord mapping.
Left/right turn labels refer to the dancer's own body; CSS mirroring only
changes the drawing. Body turns, Circles and Together show the new diagnostics.

Recording retains the previous CSV columns and appends spin_half_turns,
spin_progress_deg, spin_tracked, spin_hands_swap, spin_legs_swap,
spin_face_visible, spin_status, spin_left_halves and spin_right_halves. A `spin`
event appears once per counted half turn. Quarter turns append spin_quarter_turns,
spin_quarter_progress_deg, spin_left_quarters and spin_right_quarters; a
`spin_quarter` event appears once per counted quarter. Existing CSV consumers
should select fields by header name and tolerate appended fields.

## Validation and platform boundary

First implemented a device-free Python reference in `instrument/` and validated
synthetic turns, partial turns/reversals, crossed arms/legs, pose loss, timing,
confidence and label-flip failures. Then translated that validated contract to a
DOM-free JavaScript module for this explicitly requested Safari experiment.
The same synthetic sequences check cross-language agreement against a 5 ms p95
processing budget, excluding MediaPipe inference.

The existing choir, independent part studies and Spectral Bass must retain
their contracts. Add visible diagnostics and recording fields so a performer
can distinguish a completed turn from a guess or tracking loss. Synthetic
geometry proves the algorithm's rules; real Safari camera trials remain
necessary to evaluate how well MediaPipe follows a turning dancer. No webcam
capture, recording, model download or replacement is part of automated tests.

The browser smoke test (`tests/web/body-spin-smoke.cjs`) uses a generated video
and a substituted pose module in a fresh browser. It exercises the actual page
loop, half-turn counts, face absence, calibration enablement, mirror invariance,
reset, study switching, stream cleanup and mobile width. It never opens the
performer's camera. Test evidence and remaining camera trials are in status.md.

## Limits and next comparison

This is a pose-geometry heuristic, not a research-trained spin classifier.
Coordinated gradual left/right mislabelling, uncertain estimated depth,
self-occlusion, torso twisting, camera movement and a cropped dancer can still
cause misses or false counts. The model is not guaranteed to keep a face's
landmarks invisible in a back view. A face-only detector would still not prove
body rotation, because the head can turn independently.

Start upright facing the camera, with hands separated or knees/ankles in view.
Compare slow and quick half turns in both directions, a full turn (two counts),
crossed arms, stepping/crossed legs without turning, and a partial turn followed
by returning. Inspect the diagnostics before changing thresholds. If existing
pose estimates repeatedly fail these trials, compare a dedicated body-orientation
model such as MEBOW or a temporal 3D pose/mesh estimator as a separate experiment;
those systems would need model/runtime and browser-performance evaluation.
