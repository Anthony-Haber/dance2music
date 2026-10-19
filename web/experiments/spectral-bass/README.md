# Spectral Bass

Spectral music with the body. One sustained bass note, and the movement
changes its **spectrum**: which partials sound and how strongly. The spectrum
is normalised to unit energy, so the body's shape changes the colour of the
sound, not its loudness; the loudness is the open hand. Clear hand strokes,
up or down, move the note a step; an optional groove gives it a place.

Online: `musicintelligencelab.com/dance2music/experiments/spectral-bass/`.
Locally: serve `web/` (e.g. `python -m http.server -d web`) and open
`/experiments/spectral-bass/`. Everything runs in the browser.

The body is measured by the Movement Dictionary's `measure.js` (MediaPipe
Pose, image and 3D world landmarks); `spectral.js` turns it into five controls
and the spectrum, `sound.js` plays it. Every constant is in `SP`
(`spectral.js`) and `SB` (`sound.js`).

## A predictable instrument: knobs and poses

Every synth parameter is a **knob** (0 to 1); every pose the Movement
Dictionary measures is a **source**. Each knob follows exactly one source, and
nothing else (no hidden state, no thresholds), so the same pose always gives
the same sound. The page shows each knob's value live; any knob can be routed
to another pose, reversed (⇄), or **held** at a slider value. The routing is
saved in the browser and written into each recording's CSV.

| Knob | What it does | Default pose |
|---|---|---|
| volume | −36 dB → 0 dB (off at the very bottom) | **hand openness**, the more open hand |
| brightness | partial n at n^−slope, slope 2.0 (−12 dB/oct) → 0.55 (−3.3 dB/oct) | hands' height (−0.1 → 2.0 torsos above the hips) |
| peak position | a resonant peak from 110 Hz to 3.5 kHz | hands apart (0.3 → 2.7 torsos) |
| peak sharpness | the peak from ×1, 0.8 octaves wide, to ×9, 0.2 octaves | lean back ↔ forward |
| octaves ↔ hollow | below the middle the odd partials above the fundamental fade (92%), an organ of octaves; above it the even ones (95%), a hollow, clarinet-like sound | lean right ↔ left (full at 24°) |
| stretch | partial n at f0·n·√(1 + B n²), B up to 0.0006: bell-like | spine curve (0 → 45°) |
| roughness | partials detuned up to ±28 cents (they beat) and flickering up to 55% | moving fast (0.8 → 6 body lengths/s) |
| LFO rate | 0.25 → 8 Hz, logarithmic (the middle is 1.4 Hz) | head down ↔ up (±30°) |
| LFO depth | how far the LFO swings its target | elbow to knee, same side (1.3 → 0.3 torsos) |
| pan | right ↔ left | head turn (±60°) |
| sub octave | a sine an octave below, up to 0.6 of the bass level | held at 0.3 |

Other sources: tilt in any direction, spine arch ↔ curl, elbow to the
opposite knee, arms reach (the breath of the Movement Dictionary), a hand
circling (its speed), and each hand's openness separately.

**The LFO** has one switch, what it moves: the peak (±0.3 of the peak knob, a
slow wah), the brightness (±0.4), the level (tremolo, down to silence at full
depth) or the pitch (vibrato, ±40 cents). Tremolo and vibrato run at audio
rate; the peak and brightness are moved once per video frame, so above about
5 Hz they step rather than sweep.

**Hand openness.** A full-body dancer's hands are small in the frame, so
the hand model (MediaPipe Hand Landmarker) runs on a crop around each wrist,
extended along the forearm, one hand per frame in turn (the kinesonic app's
method; crops found about half her hands on her clips, full frames 2%).
Openness r is the mean over the four fingers of |tip − wrist| / |knuckle −
wrist| in the hand's 3D landmarks, about 1.0 for a fist and 2.0 for an open
palm; the knob is its logarithm, ln(r / 1.05) / ln(1.9 / 1.05), so equal
changes of the hand are equal steps in dB. A hand not seen holds its value for
1 s, then glides to open, so losing it never silences the instrument by
surprise. "Hands: off" skips the model (and volume then stays at full).

48 partials, each its own sine oscillator, retuned every frame; partials above
9 kHz are silent. **Calibrate** standing upright: the lean, spine and head
sources are measured from that posture (uncalibrated, the pose model reads a
forward lean of about 16°, which pushes the sharpness up).

## Notes: hand strokes

A stroke is a wrist moving vertically faster than 4.5 body lengths per second
(the "Stroke needs" switch: 3, 4.5 or 6), with the vertical speed at least
1.5 times the horizontal; a sideways sweep does not count. Up steps the note up
the scale, down steps it down. After a stroke the hand must slow down (below
0.4 of the threshold) before it can stroke again, and at most one stroke (of
either hand) counts every 0.5 s. The scale is D dorian (D E F G A B C), from G1
to D3, starting on D2.

On three of her dance clips, free dancing (not aiming at strokes) stepped the
note 6 to 12 times in 25 s at the default; a deliberate stroke stands out.

## Accompaniment

A quiet groove at 92 BPM (kick on 1, the "and" of 2 and 3; snare on 2 and 4;
eighth-note hats) and an open fifth high above (D4, A4, E5: soft detuned saws,
low-passed at 1.4 kHz). D dorian sits on it whatever the bass does. With the
groove on, a stroke lands on the next eighth note ("Notes land: at once"
switches this off).

## Tests

`node --test tests/spectral_bass.test.mjs` (9 tests): the routing (a knob
follows only its source, ⇄ reverses it, held knobs sit on their value); volume
in dB and the LFO rate on a log scale; hand openness on a log scale; unit energy for any
body; hands up raise the centroid and hands apart move the peak; the lean
fades the even or the odd partials and keeps the fundamental; the spine
stretches the partials; the scale steps and range; a stroke up and down steps
once each and a sideways sweep does not.
