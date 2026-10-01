# Ideas

A dump for ideas that are not built yet. Newest at the top. When one gets
built, move it to the bottom under "Done" with the commit.

## The ball between the hands (Sep 30)

*First step built Oct 1:* a visible sphere (fire or chord-coloured light) at
the hands' midpoint, radius = half their distance, and an `instrument volume`
mapping that can follow its volume r³ (preset *Sphere*). Still open below:
holding/releasing, throwing with inertia, velocity as excitation.

The hands' midpoint is already computed (six-chord mode uses it). Make it a
visible object, a ball of fire or light, that she holds and floats around, and
make *the ball* the instrument rather than the body.

- **Position** of the ball (height, left/right) → pitch or chord region, brightness.
- **Size** = the distance between the hands → loudness, filter, grain density:
  hands close is a small, dense, quiet ball; hands wide is a big, open one.
- **Velocity** of the ball → excitation (a bowed or blown tone that sounds only while it moves).
- **Holding and releasing**: palms facing each other (hand landmarks) holds the
  ball; opening the hands releases it, and it keeps moving with its last
  velocity and some drag and gravity. The sound flies across the stereo field
  and fades as it goes. A throw becomes a musical gesture.
- **Visuals**: particles or a small shader (canvas 2D or WebGL) around the
  midpoint, radius = hand distance, colour = current chord, flicker = energy.
  Cheap to draw; the cost is already paid by pose and hand tracking.
- Why it matters: looking at yourself in the mirror view, a visible object
  between the hands makes the mapping readable. You see what you are playing.

## Percussion

- Drum voice per chord region or per limb, chosen in the mapping panel.
- Take the groove's downbeat from a specific move (a foot strike, a hip drop)
  rather than counting bounces.
- Patterns learned from her movement (the rope's kNN bank approach): record
  takes, label the grooves, let the classifier pick the pattern.
- Fix the ~40 ms late beat on asymmetric bounces (quick drop, slow rise): e.g. a
  learned bounce template in the observation model, done without letting it
  chase the phase estimate.

## Hands

- Custom gestures trained with MediaPipe Model Maker (her own vocabulary,
  not the seven canned ones).
- Hand tracking at a higher resolution: a second, zoomed camera, or 1080p crops.
- Palm orientation (facing camera, facing each other, facing down) as sources.

## Platform

- Installable web app (PWA): home-screen icon, offline cache, screen kept
  awake, full screen. About an hour.
- Native dance mode in SoniqFlow: Apple Vision body pose, the same feature math
  in Swift, and fusion with the IMU sticks (camera for position and shape,
  sensors for sharp acceleration).
- Bring the live mapping matrix to the offline renderer, so demos and live use
  the same mappings.

## Done

- Sphere between the hands + instrument volume ∝ r³; pad timbres (saw, strings, glass, organ, choir with vowel) — Oct 1
- Mapping matrix, integrated energy, rhythm detection, first percussion — `live: mapping matrix…`
- Six chords from the hands, voice-led — `Six chords from the hands…`
