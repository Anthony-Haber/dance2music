# Movement Dictionary

An experiment built from a dancer's notes after the first Music Intelligence
Lab session (October 2026): five things in a movement that she wants to hear.
Each one is a **study**: one measurement and one sound, so it can be tried and
judged on its own, and then all five together.

Online: `musicintelligencelab.com/dance2music/experiments/movement-dictionary/`.
Locally: `python live.py`, then <http://127.0.0.1:5092/experiments/movement-dictionary/>.
Everything runs in the browser; no video or data leaves it. A recording
downloads the view with its sound and a CSV of the measurements (no images).

## Anthony's body-turn experiment

On `codex/anthony-movement-dictionary`, choose **Body turns**, or open
`/experiments/movement-dictionary/#body-turns`. Start upright facing the camera,
step back to show your torso and hands or knees, then turn. Each **90° quarter turn**
counts once in the large counter. The separate **180° half-turn** count remains:
180° gives two quarters and one half; 360° gives four quarters and two halves.
**Reset turns** clears both counters.
Calibration still sets the other posture studies' neutral; turn counting itself
does not need calibration.

Shoulders and hips must rotate together. A quarter turn needs a fresh hand or
leg axis rotating with the torso; a half turn also needs an image-order swap.
At 90° the limbs may overlap in profile before swapping. Crossed arms or a
disappearing face alone cannot count. The display shows
progress, direction relative to your own body, speed, limb confirmation and weak
tracking. Face cues come from pose landmarks, not a separate face detector.
Mirroring does not reverse anatomical turn labels. Only Body turns shows these
diagnostics and uses the turn-to-pitch mapping below. Circles and Together retain
Bakarji’s circular-motion notes and original shoulder-spin stereo effect.

Each confirmed **90° body turn** now transposes the sustained choir: left moves
up one D-major scale degree, right moves down. The turn tonic begins at D4 and
continues D4–E4–F♯4–G4–A4–B4–C♯5–D5 across octaves, within D3–D6. Every voice
moves by the same semitone offset, so chord intervals stay intact (D major → E
major after the first left turn). The tonic follows the D-major scale; individual
chord tones are not independently forced into D major. **Turn tonic**, choir
notes and the absolute chord label show the resulting pitch. At a range limit,
turn the other way; the detector still counts turns but pitch holds at the limit.

A 180° turn changes pitch twice, 360° four times; only quarter-turn events step
pitch, so a half-turn event cannot duplicate the change. Repeated frames,
unconfirmed turns and tracking loss do not invent steps. Reset turns or Start
returns to D4. The other studies keep their original pitch; returning to Body turns
resumes its stored pitch, with no replay of turns made while disabled.
The Sound plays switch still gates audio. CSV recordings append turn_tonic_midi,
turn_transpose_st, turn_scale_steps and turn_pitch_limit.

This remains an experiment: real Safari camera trials are required to judge
MediaPipe's turn tracking. See [research, algorithm and limits](spin-research.md).
The original studies below retain their musical mappings. Spin diagnostics are
appended to recorded CSV columns; select fields by name when reading recordings.

## The five notes

| | Her note | What is measured | What you hear |
|---|---|---|---|
| 1 | **Spine: head and tail.** Movement starts from the head or the tail and travels between them. | The spine's curve (hips → shoulders → head); which end starts a movement (the one that speeds up first after rest) and how long it takes to reach the other. | The tenor: head-led, a bright sweep falls through the hum; tail-led, it rises; the travel time is the sweep's length. Curling bends the tenor a step down, arching a step up; curving makes the hum metallic. |
| 2 | **Head: independent.** Direction set by the eyes or nose, independent of the spine. | Head turn (yaw) and tilt (pitch) relative to the shoulders; fast turns. | The soprano: the choir sings the head's vowel (down "oo", level "ah", up "ee") and moves to the side it turns to; looking up or down bends the soprano a step; a sharp turn sounds a soft accent. |
| 3 | **Elbows and knees.** The distance and relationship between two points. | Four distances in torso lengths: left elbow to left knee, right to right, and the two crossed; contact. | The alto: folding an elbow to the knee on the same side moves the choir to the relative chord (I→vi), to the opposite knee to the other neighbour (I→iii), one voice changing. A touch strikes a note. |
| 4 | **Verticality.** Upright is a continuous base hum; tilting shifts it by its degree and direction. | Tilt of the hip-to-head axis from vertical, in any direction (left/right and forward/back, from the 3D landmarks). | The bass: upright, the choir sings the tonic over a steady hum. Tilt detunes, bends and opens the hum; a side lean pans it. A lean held to her left moves the choir to IV, to her right to V, one voice at a time; upright walks home. |
| 5 | **Circularity.** Speed, size and change of direction; one part or the whole body. | Each hand, the head and the hips: whether it travels in a circle, how fast, how big, which way, each quarter turn, reversals; the whole body spinning. | One chord note per quarter turn, travelling round in stereo. Faster circle = faster notes; small = high and quiet, big = low and full; reversing reverses the notes with an accent; a spin turns the whole sound. |

Two additions from the lab, not from her notes:

| | Addition | What is measured | What you hear |
|---|---|---|---|
| 6 | **Arms: the breath.** | Reach: each wrist's 3D distance from the trunk (the hips to shoulders segment), in torso lengths; 0.7 of the more open arm plus 0.3 of the other. Breath = (reach − 0.5) / 0.8, from 0 (arms by the sides) to 1 (wide open, forward or up). | How fully the choir sings, not what: level 0.25 + breath, a low-pass at 600·2^(4·breath) Hz (dark hum to bright), and breath noise through the vowel formants as the arms open. With the study off the breath stays at 0.75 (the choir as it was). |
| – | **Sound only on quick movement** (switch: "Sound plays"). | The second fastest of head, elbows, wrists, knees and hips, in body lengths per second (the body's largest visible segment: torso, 1.4 × shoulders, or a thigh), smoothed 0.05 s; jumps above 8 are ignored. Taking the second fastest means one landmark that glitches is not a movement. | Everything is silent until movement passes the "How quick" threshold (default 2 body lengths/s): it opens in 15 ms and closes over 0.2 s, full at 2.5 × the threshold. The reverb still rings after. On her clips her movement's median is 1.5 to 2, her quick moves 4 to 7. |

**Questions to try** (switches on the page, the dancer's open questions):
hum on when still, or fading; spine by which end starts, by curve, or both;
elbows and knees same side, crossed, or both; circles stop with you, or wind
down like a top.

**Calibrate**: stand upright, look ahead, press Calibrate; three seconds later
that posture is zero for the tilt, the spine's curve and the head.

## The choir (`harmony.js`)

The five notes play a four-voice choir in D major, and every chord change
happens **one voice at a time**, the way a choir moves: the common tones hold,
one voice steps (and swells a little), then the next. Each voice belongs to a
part of the body:

| Voice | Body | What it does |
|---|---|---|
| bass (the hum) | the axis | upright = **I** (D); a lean held 0.35 s past 22° to her left = **IV** (G), to her right = **V** (A); back under 10° = home |
| tenor | the spine | curling forward bends it a scale step down, arching back a step up, until she straightens (e.g. V with the tenor bent to G = A7) |
| alto | elbows and knees | an elbow folding towards the knee on the same side (under 0.75 torsos) = the **relative** chord: I→vi, IV→ii, V→iii; an elbow towards the opposite knee (under 0.95) = the **other neighbour**: I→iii, IV→vi, V→vii°. Both are one note away. A touch strikes the alto's note |
| soprano | the head | looking up past 12° lifts it a scale step, down past −15° lowers it: a suspension that resolves when she looks ahead |

The target chord comes from the lean and the pairs; the choir walks to it,
at most one voice every 0.35 s, the smallest step first and the bass last.
Circles arpeggiate whatever the choir is singing. On three short dance clips
the choir used I, ii, iii, IV, V, vi and vii° this way.

Voices: tenor, alto and soprano are two detuned saws each with vibrato
(5.2 Hz, ±14 cents) through three vowel formants, gliding 0.09 s to a new note;
the head's vowel (oo / ah / ee) shapes all three. The bass is the hum, an
octave below the bass voice.

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
  On Anthony's branch, [body turns](spin-research.md) replace the shoulder-only
  spin detector with fresh torso/limb evidence and half-turn counts.

## How it sounds (`sound.js`)

- **Hum**: 10 sine partials an octave below the bass voice, each doubled by a
  detuned copy. Tilt u = tilt/45° (capped at 1): detune 18u cents, bend 60u
  cents, low-pass 320·2^(3u) Hz, ×2^(1.2·forward); pan from the sideways lean.
  Spine curve c (curve/45°): partial n at f·n·√(1 + 0.0025·c²·n²).
  A lead: each partial is struck in turn from the leading end over the travel
  time (0.12 to 1.2 s).
- **Head**: the choir's three formants move oo (300, 870, 2240 Hz) ↔ ah (730,
  1090, 2440) ↔ ee (270, 2290, 3010) with pitch ±30°; the choir pans with the
  yaw (±60°); a sharp turn strikes the soprano's note an octave up.
- **Elbows and knees**: contact strikes a bar (partials 1, 2.756, 5.404, 8.933)
  on the alto's note.
- **Circles**: the choir's notes (tenor, alto, soprano, then an octave up) one
  per quarter turn, up for anticlockwise and down for clockwise; an octave up
  for small circles, down for big ones; panned round with the circle.

## Tests

`node --test tests/movement_dictionary.test.mjs tests/movement_dictionary_choir.test.mjs`
(16 tests). The choir tests check the tonic, IV and V by leaning, the relatives
by folding, that each step moves exactly one voice, and the bends. The
measurement tests check
the measurements on synthetic bodies: upright and leaning, forward, a curled spine, a head turn,
elbow–knee contact, the arms' reach (by the sides, out, forward), a quick
movement against a single landmark jumping, a circling hand with its rate, quarter turns and a
reversal, and a head-led movement with its travel time.

Anthony's additional checks:

```bash
.venv/bin/python -m pytest -q tests/test_body_spin.py
node --test tests/body_spin.test.mjs
.venv/bin/python -m pytest -q tests/test_turn_pitch.py
node --test tests/turn_pitch.test.mjs
```

The Node test uses the active `PYTHON` executable or `.venv/bin/python` (fallback
`python3`) to compare against the Python reference; install requirements/dev.txt
first. The optional real-page smoke test needs Playwright/Chromium and a running
local server: `node tests/web/body-spin-smoke.cjs` (default port 5094; override
`SPIN_URL` and `CHROME_EXECUTABLE` as needed). It supplies synthetic video/pose
data, including the 90° and 180° milestones and actual sustained oscillator
frequencies, without using the camera, downloading a model or touching a MIDI port.
