# Movement Dictionary

An experiment built from a dancer's notes after the first Music Intelligence
Lab session (October 2026): five things in a movement that she wants to hear.
Each one is a **study**: one measurement and one sound, so it can be tried and
judged on its own, and then all five together.

Online: `musicintelligencelab.com/dance2music/experiments/movement-dictionary/`.
Locally: `python live.py`, then <http://127.0.0.1:5092/experiments/movement-dictionary/>.
Everything runs in the browser; no video or data leaves it. A recording
downloads the view with its sound and a CSV of the measurements (no images).

## The five notes

| | Her note | What is measured | What you hear |
|---|---|---|---|
| 1 | **Spine: head and tail.** Movement starts from the head or the tail and travels between them. | The spine's curve (hips → shoulders → head); which end starts a movement (the one that speeds up first after rest) and how long it takes to reach the other. | The hum is the spine. Head-led: a bright sweep falls through its overtones; tail-led: it rises. The travel time is the sweep's length. Curving the spine stretches the overtones (pure → metallic). |
| 2 | **Head: independent.** Direction set by the eyes or nose, independent of the spine. | Head turn (yaw) and tilt (pitch) relative to the shoulders; fast turns. | A vowel filter on the hum: down "oo", level "ah", up "ee"; the voice moves to the side the head turns to; a sharp turn sounds a soft accent. |
| 3 | **Elbows and knees.** The distance and relationship between two points. | Four distances in torso lengths: left elbow to left knee, right to right, and the two crossed; contact. | Two voices per pair: touching = unison, close = slow beating, then a third, a fifth, an octave as they part. A touch strikes a note; a closing crossed pair adds a tense voice. |
| 4 | **Verticality.** Upright is a continuous base hum; tilting shifts it by its degree and direction. | Tilt of the hip-to-head axis from vertical, in any direction (left/right and forward/back, from the 3D landmarks). | Upright: a steady hum. Tilt detunes it, bends it up to a semitone at 45° and opens it; a side lean pans it, forward brightens, back darkens. A lean held past 25° for a second steps the harmony that way; upright returns home. |
| 5 | **Circularity.** Speed, size and change of direction; one part or the whole body. | Each hand, the head and the hips: whether it travels in a circle, how fast, how big, which way, each quarter turn, reversals; the whole body spinning. | One chord note per quarter turn, travelling round in stereo. Faster circle = faster notes; small = high and quiet, big = low and full; reversing reverses the notes with an accent; a spin turns the whole sound. |

**Questions to try** (switches on the page, the dancer's open questions):
hum on when still, or fading; spine by which end starts, by curve, or both;
elbows and knees same side, crossed, or both; circles stop with you, or wind
down like a top.

**Calibrate**: stand upright, look ahead, press Calibrate; three seconds later
that posture is zero for the tilt, the spine's curve and the head.

## How it is measured

MediaPipe Pose gives 33 landmarks per frame twice: in the image, and in 3D
"world" coordinates (metres, origin at the hips). Posture (notes 1 to 4) uses
the world landmarks, so leaning towards the camera is seen; motion (which end
starts, circles) uses the image scaled by the torso, because the world frame
moves with the hips. All code is in `measure.js`; every constant below is in
its `MD` object, and the sound's in `SD` (`sound.js`).

- **Body frame.** L = towards her left (along the shoulders, horizontal),
  F = forward, U = up. Directions are reported in it: 0° forward, 90° her left.
- **Tilt.** a = unit vector from hip centre to ear centre; tilt =
  asin(|(a·L, a·F)|), direction = atan2(a·L, a·F), minus the calibrated posture.
- **Spine curve.** The angle between hips→shoulders and shoulders→head; its
  forward (curl) and sideways (bend) parts are (up − low)·F and ·L.
- **Which end starts.** Head (nose) and tail (hip centre) speeds in torsos/s,
  smoothed 0.1 s. After 0.25 s below 0.35 torsos/s (rest), the first end to pass
  0.9 torsos/s leads; the other end's start, within 0.8 s, gives the travel time.
- **Head.** The nose relative to the ears: yaw = atan2(h·L, h·F), pitch from
  its vertical part, minus calibration (default level pitch −12°). A sharp turn:
  yaw rate (smoothed 0.04 s) above 160°/s, at most every 0.4 s.
- **Elbows and knees.** 3D distances divided by the torso length; contact
  below 0.28 torsos.
- **Circles.** Per point, the direction of travel (smoothed velocity, above
  0.6 torsos/s) is followed; if it turns by more than 0.7 of a turn within 1.2 s,
  the point is circling. Rate = turning per second, size = speed / turning rate.
  A quarter turn is each π/2 of accumulated turning; a reversal is the turning
  changing sign while circling, or restarting the other way within 1.5 s.
  A spin is the shoulder line's yaw changing faster than 90°/s.

## How it sounds (`sound.js`)

- **Hum**: 10 sine partials on D2, each doubled by a detuned copy. Tilt u =
  tilt/45° (capped at 1): detune 22u cents, bend 100u cents, low-pass
  380·2^(3u) Hz, ×2^(1.2·forward); pan from the sideways lean. Held lean past
  25° for 1 s: root up a fourth (her left) or a fifth (her right); below 10°:
  home. Spine curve c (curve/45°): partial n at f·n·√(1 + 0.0025·c²·n²).
  A lead: each partial is struck in turn from the leading end over the travel
  time (0.12 to 1.2 s).
- **Head**: two band-pass formants on the hum, oo (300, 870 Hz) ↔ ah (730,
  1090) ↔ ee (270, 2290) with pitch ±30°; panned with the yaw (±60°).
- **Elbows and knees**: per side, two triangle tones two octaves above the
  root; the second is above the first by 0 → 30 → 400 → 700 → 1200 cents at
  0, 0.3, 0.6, 0.9, 1.3 torsos. Contact: a struck bar (partials 1, 2.756, 5.404,
  8.933). Crossed: a sawtooth a minor ninth up, louder as the pair closes.
- **Circles**: the chord (root, third, fifth, octave …) one note per quarter
  turn, moving up for anticlockwise and down for clockwise; register two, one
  or zero octaves up for small, medium, big circles; panned round with the
  circle.

## Tests

`node --test tests/movement_dictionary.test.mjs` checks the measurements on
synthetic bodies: upright and leaning, forward, a curled spine, a head turn,
elbow–knee contact, a circling hand with its rate, quarter turns and a
reversal, and a head-led movement with its travel time.
