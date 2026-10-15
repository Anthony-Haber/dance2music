# Spectral Bass

Spectral music with the body. One sustained bass note, and the movement
changes only its **spectrum**: which partials sound and how strongly. The
loudness is held constant (the spectrum is normalised to unit energy), so the
dancer shapes the colour of the sound, never its volume. Clear hand strokes,
up or down, move the note a step; an optional groove gives it a place.

Online: `musicintelligencelab.com/dance2music/experiments/spectral-bass/`.
Locally: serve `web/` (e.g. `python -m http.server -d web`) and open
`/experiments/spectral-bass/`. Everything runs in the browser.

The body is measured by the Movement Dictionary's `measure.js` (MediaPipe
Pose, image and 3D world landmarks); `spectral.js` turns it into five controls
and the spectrum, `sound.js` plays it. Every constant is in `SP`
(`spectral.js`) and `SB` (`sound.js`).

## What shapes the sound

| Body | Control (0 to 1) | The spectrum |
|---|---|---|
| hands' height: the wrists above the hips, in torsos (−0.1 = by the sides, 2.0 = overhead) | brightness | partial n has amplitude n^−slope; the slope goes from 2.0 (about −12 dB/octave, dark) to 0.55 (−3.3 dB/octave, bright) |
| hands' span: the 3D distance between the wrists, in torsos (0.3 to 2.7) | peak | a resonant peak, ×4 at its centre and 0.45 octaves wide, travels from 110 Hz to 3.5 kHz |
| sideways lean (sin of the tilt to the side; full at 0.4, about 24°) | lean | to her left: the even partials fade (95%), a hollow, clarinet-like sound; to her right: the odd partials above the fundamental fade (92%), an organ of octaves. The fundamental stays |
| the spine's curve (0 to 45°) | stretch | partial n at f0·n·√(1 + B n²), B up to 0.0006: pulled sharp, bell-like |
| how fast the body moves (the Movement Dictionary's quick-movement speed, 0.8 to 6 body lengths/s) | roughness | each partial is detuned up to ±28 cents (they beat against each other) and its level flickers up to 55% |

48 partials, each its own sine oscillator, retuned every frame (gains glide
over 0.05 s, frequencies over 0.06 s); partials above 9 kHz are silent.

Note: with the hands low the spectrum is dark and the fundamental carries most
of the energy, so the lean (which works on the partials above it) is subtle;
it becomes strong as the hands rise.

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

`node --test tests/spectral_bass.test.mjs` (6 tests): unit energy for any
body; hands up raise the centroid and hands apart move the peak; the lean
fades the even or the odd partials and keeps the fundamental; the spine
stretches the partials; the scale steps and range; a stroke up and down steps
once each and a sideways sweep does not.
