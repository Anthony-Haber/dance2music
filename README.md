# dance2music

Music Intelligence Lab: dance video → sound. Pose from MediaPipe, cleaned
velocity / acceleration / jerk, Laban Efforts, and simple synths and a
pose-driven ii–V–I, compared on one local page. Started Sep 2026 as a
tangent from the rope flow project (soniqflow-m5stack-python) for a dance
collaboration in the lab.

Code only in git: clips go in `videos/`, everything generated lands in
`output/` (both ignored).

    python dance_pose.py track videos/<clip>.mp4   # pose → output/<clip>/landmarks.npz
    python motion.py                                 # kinematics + Efforts for every tracked clip
    python harmony.py                                # how often each chord rule fires
    python synths.py                                 # render every demo for every clip
    python synths.py --serve                         # the page, http://127.0.0.1:5091/
    python live.py                                   # live from a camera, http://127.0.0.1:5092/live/
    python live.py --offline                         # same, with MediaPipe downloaded for a venue without internet

| file | what |
|---|---|
| `config.py` | paths; `ROPEFLOW_ROOT` points at the rope engine (only `dance_pose.py music` and `sonify.py` need it) |
| `dance_pose.py` | pose tracking, first rule-based labels, the rope engine on dance |
| `vocabulary.py` | her six shapes, discovered by clustering |
| `sonify.py` | shape → chord, no clock (SWAM MIDI) |
| `motion.py` | cleaned kinematics and Laban Efforts |
| `harmony.py` | pose → ii–V–I with voice-led voicings |
| `synths.py` | the demos: synthesis, overlay videos, stems, manifest |
| `web/index.html` | the comparison page (mixer, chord timeline, traces) |
| `web/methods.html`, `web/about.html` | the math of everything, as a drawer and as a standalone page |
| `web/live/` | the live tool: camera picker, causal features, pose chords, Web Audio synth, mixer |
| `live.py` | serves `web/` on localhost (the camera needs localhost or https) |
| `IDEAS.md` | ideas not built yet |
| `ANTHONY_IDEAS.md` | Anthony's project vision, priorities, design decisions, and possible design flaws |

---

# Dance → the rope's music engine

A tangent: the performance layer we built for the rope does not actually care
that it is a rope. It wants three things — **when** (a stream of accents),
**what** (a movement name at each accent) and **how much** (a slow energy) —
and a dancer on video can give all three through MediaPipe pose.

    python dance_pose.py all videos/<video>.mp4

Stages can be run separately (`track`, `signals`, `music`, `overlay`);
everything lands in `output/<video-stem>/`.

## How the dance becomes the three signals

**Pose** (`track`) — MediaPipe Pose per frame, keeping both the image
landmarks (where the body is on screen) and the **world** landmarks (metres,
hip-centred, camera-independent). 99 % of frames tracked on the Sep 21 studio
clip.

**When** (`signals`) — limb speed about the body, in torsos per second,
smoothed; its peaks are the accents, the way accelerometer peaks are the
rope's whooshes. On that clip: 139 accents in 107 s, median 0.55 s apart.
Dance is far less periodic than rope flow (period confidence ≈ 0), so the
clock leans on its own averaging rather than on the dancer being metronomic.

**What** — seven rule-based states, chosen so they can be read and argued with
rather than trusted blindly. Shape is tested before transition, because a
folded body is something you can see while turning is something the body
passes through:

| label | the rule |
|---|---|
| `reach` | a wrist more than half a torso above the shoulders, body upright |
| `low` | hips dropped toward the ankles, or the torso folded over |
| `turn` | the shoulder line rotating (world yaw, so it works side-on) |
| `travel` | the hips crossing the floor |
| `open` | hands far apart or far from the body |
| `close` | hands in, still moving |
| `still` | none of the above |

A state must be the majority of a half-second window to count, which took the
clip from 73 label changes a minute to 45.

**How much** — the same 3-second envelope the rope uses, normalised to its own
90th percentile.

## The music

`music` feeds those into the ordinary `PerformEngine` through a
`DanceContext` that stands in for a rope take, with a dance chord map
(one key, mostly triads: reach → G, open → C, close → Am, turn → Em,
travel → F, low → Dm) and a drum pattern per state. Everything downstream is
unchanged: the voice-led quartet, the top voice moving only when the chord
does, the drum loop on the rope clock.

`overlay` draws the skeleton, the current label and the energy on the video and
muxes the generated audio (the studio's own audio is dropped: two pieces of
music at once tells you nothing).

## What this is not

The labels are hand-written rules tuned on one dancer in one studio, not a
learned model — the rope's kNN bank took a night of guided recording to earn
its labels, and this had an afternoon. If the tangent is worth continuing, the
honest next step is the same one the rope took: record takes, name the states,
bank them, and let the classifier do what rules are standing in for.

## Her vocabulary, discovered (`vocabulary.py`)

    python vocabulary.py videos/VIDEO-*.mp4 --k 4 --sub 3

Windows of pose (1.6 s, hop 0.4 s: the length of a dance shape) from all
three clips at once → standardise → PCA → UMAP → k-means. Silhouette picks
**4**, which is the honest answer but a coarse one: 63 % of it is "upright",
and for music that is three different things. So the biggest cluster is split
again on the arms alone, giving six shapes that can be looked at and named:

| shape | what it is | share |
|---|---|---|
| 0 | standing, arms down — rest | 31 % |
| 1 | both arms overhead — lift | 18 % |
| 2 | wide lunge, one arm out | 17 % |
| 3 | standing, one arm up — reach | 16 % |
| 4 | hands and feet on the floor — ground | 13 % |
| 5 | deep fold | 6 % |

**The three clips share this vocabulary**: overlap 0.77–0.88 (1 = identical use
of shapes), while DTW over limb trajectories barely beats a shuffled baseline.
Same shapes, same proportions, different order — which is what "the dances are
all the same" turns out to mean.

`sheet.png` shows four examples of each shape, `timelines.png` when they happen
and how much each clip uses them, `clusters.json` the per-window assignment.

## Sonifying from the vocabulary (`sonify.py`)

    python sonify.py videos/VIDEO-....mp4 --watch

No clock and no drums, because the dance has no pulse (period confidence 0.00).
Instead:

- **the shape sets the harmony** — a chord and a register per shape (rest → Am
  warm, lift → C bright, lunge → F, reach → G, ground → Dm warm, fold → Em
  warm), voiced by the rope's own `QuartetVoicer`, so the top voice steps when
  the shape changes and holds while it lasts;
- **the body works the sound, continuously** — CC lanes at 15 Hz;
- **a change is heard because the harmony moves**, not because a bar came round.

### For the Ableton side

`<stem>__sonify.mid` has four tracks, one per section, each with its own CC
lanes — drop them on the SWAM tracks as they are:

| track | MIDI ch (1-based) | plays |
|---|---|---|
| violin | 8 | top voice of the quartet |
| viola | 9 | alto |
| cello | 1 | tenor |
| bass | 6 | bass |

| CC | from the body | SWAM |
|---|---|---|
| 11 | hands high + speed | expression (loudness) |
| 1 | arms wide | vibrato depth |
| 2 | speed alone | bow pressure |

The `.wav` next to it is a General MIDI sketch: CC 11 comes through, CC 1 and 2
do not — those only mean something once it is SWAM.

## Motion, not pose: simple synths (`motion.py`, `synths.py`)

    python motion.py            # cleaned kinematics + Laban Efforts
    python synths.py            # 8 ideas × all clips → videos (~80 s)
    python synths.py --serve    # the comparison page on :5091

One rule for every idea: **moving makes the sound, the feature colours it**
(loudness always comes from a speed, so stillness is silence). One or two plain
sources per idea, and the video draws exactly the joints and signals that drive it.

| idea | what drives what |
|---|---|
| organ | each limb's speed → loudness of its own sine (C3 G3 E4 B4) |
| siren | each hand's speed → its pitch and loudness |
| wind | Weight → noise loudness + brightness; hips crossing → pan |
| plucks | Time: each limb's sudden acceleration plucks its string (Karplus–Strong) |
| fm | Flow (jerk relative to acceleration) → FM index; speed → loudness |
| space | Space (hand path straightness, 1 s) → pure fifth vs detuned drift |
| breath | Shape: body hull growing/shrinking → loudness; hull size → brightness |
| efforts | wind + plucks + fm + space, stems mutable in the page |

**Jitter**: visibility gate → Hampel glitch removal → gap fill (gaps > 0.3 s get
zero confidence) → zero-phase 5 Hz Butterworth → Savitzky–Golay derivatives →
per-limb resting-speed floor subtracted in quadrature. Controls reach the audio
through a one-pole glide (30–250 ms), so nothing zips. `_motion/cleaning.png`
shows raw vs cleaned speed.

**Honest caveats**: Weight and Time correlate ~0.94 on these clips (a strong
move is a fast-accelerating one), which is why Time is heard as discrete
sudden *events* rather than a second continuous layer. Flow as a ratio still
correlates ~0.7 with Time. Everything is 2D image motion in torso lengths;
motion toward the camera is invisible. Normalisation is pooled across the
three clips, so "strong" means the same thing in each.

## ii–V–I from pose (`harmony.py`, demos `twofive`, `twofive_alt`)

Pose picks the chord, the four Efforts play it. First rule that matches wins,
otherwise the chord holds; a reading must last 0.35 s to change it:

| chord | rule |
|---|---|
| V (G13) | both hands below mid-thigh |
| ii (Dm9) | both hands past the same side of both feet |
| I (Cmaj9) | each hand and foot on its own side of the hips' midline (body frame) |

Rootless voicings over a separate bass, chosen so every voice moves by at most
a step: Dm9 F A C E → G13 F A B E → Cmaj9 E G B D (G7alt F A♭ B E♭ is a half
step from both). Voices glide in pitch (0.25 s, bass 0.12 s). Layers: pad
(Space detunes it), FM bass on the root (Flow = harshness), plucks on the
limb's chord tone (Time), wind and wind-tuned-to-the-chord (Weight).
`twofive_alt` swaps in G7alt while Weight is high (≥ 0.5 s, hysteresis).
Rules fire ~8–12 chord changes/min on the Sep 21 clips, median chord ~5 s.
Thresholds are constants at the top of `harmony.py`.

Every demo now ships its layers as stems; the page mixes them live
(volume / mute / solo per layer, remembered by layer name).
