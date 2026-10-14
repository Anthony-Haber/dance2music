# Floor Piano

Stop, choose Floor Piano in Scene, then Start. This uses the same Chrome/WebGPU
camera and depth pipeline as 3D Models. Prepare once with
`python live.py --offline --without-magenta` (or `python piano_assets.py` if the
pose and scene assets are already prepared). No native helper is involved.

Keep people and obstacles out of the floor area during scanning. The complete
C4–C5 keyboard must fit a detected floor interior; tables, holes, and excluded
person pixels cannot support it. The layout has long white-key fronts, with
short black keys confined to about a third of its length. **Black keys toward
camera** is on by default: face the camera and step forward from the long white
ends to reach the black keys. Turn it off to put the black keys on the far edge.
This choice is remembered and can change while playing; held notes release and
fresh contact is required afterward. The whole layout flips front to back,
including contact regions and label positions, while size, floor placement and
left-to-right note order stay the same. Placement maximizes projected
playing area and requires at least 12 pixels per white key at preview width
640. Scanning counts down ten seconds so you can step out of view. If placement fails,
reveal more clear floor and Rescan. Dragging preserves
the full layout and finds the closest valid floor position. In the mirrored
player view, notes ascend from C4 on the left to C5 on the right. Turning off
the camera mirror shows the opposite camera viewpoint; notes stay attached to
their physical keys, and labels remain readable in either view.

The display compensates for common camera-exposure changes and stabilizes
clear floor depth near the fitted plane so small depth fluctuations do not
clip the keyboard. People and closer obstacles retain foreground occlusion.
Display stabilization does not alter the measured depth used for foot contact
or the 120 ms pose / 200 ms depth freshness limits.

Confident toes (heels as fallback) and foreground depth determine foot contact.
Feet must be close to the reconstructed floor; hands, knees and image overlap
alone cannot play. Two feet may own one key without retriggering it, or play two
different notes. Confirmation takes 25 ms; ordinary release debounce is 120 ms.
A confirmed lift bypasses that debounce so quick hops can replay the same key.
After depth establishes contact, lift detection follows foot pose independently
of the slower depth updates: a four-pixel rise at preview width 640, sustained
for 25 ms, releases the key. When the ankle is confidently visible it must rise
too. Short bounces can also rearm an established contact with a sustained
three-pixel ankle rise, even if the pose model leaves the toe almost stationary.
This allows heel bounces as well as full jumps. These thresholds do not grow
with keyboard size. Landing follows confirmed downward foot or ankle travel;
it does not require a return to the exact original image position.
It still requires fresh foreground depth captured after takeoff and another
25 ms of floor contact. The resting baseline follows the foot as it settles, so
subsequent short hops work too. Two distinct poses confirm a higher jump peak,
preventing a single tracking outlier from creating a false landing. Depth fluctuations,
single-frame pose outliers, toe/heel fallback changes and holding still do not retrigger. Boundary
hysteresis reduces jitter. Camera depth and foot contact remain approximate.

One entry triggers one sample. Holding does not loop or restart the sample.
Lift your foot or jump, then land on the same key to replay without stepping
sideways. Two feet on different keys can repeat a chord by jumping together.
A shared key stays held until both feet leave it. Lifting or stepping off damps
over 150 ms. Note events distinguish `lift-off` releases and `landing` attacks.
Stop, rescan, source
changes, hidden tabs, scene failure and dragging release held notes. A timer
also releases when pose exceeds 120 ms or depth exceeds 200 ms, including when
camera callbacks stop. Drag completion needs fresh pose/depth.

Listening persists separately from the mixer: Piano only is the default;
Piano + body music adds the existing movement layers. Changes fade the body
gain over 100 ms. Piano uses Objects, shared reverb, master, limiter and the
recording output. Its notes (MIDI 60–72) do not follow chord changes.

`web/live/piano-assets.lock.json` pins five MP3 sample roots (C4, D♯4, F♯4, A4,
C5), the upstream revision, sizes, SHA-256 hashes and the upstream README.
Preparation verifies and reuses valid files. The browser fetches only local
prepared assets for this scene, verifies their hashes and decodes them before
scanning. Missing/corrupt/undecodable samples stop startup with the preparation
command; there is no synthesized fallback.

Attribution: Salamander Grand Piano by Alexander Holm, distributed by Tone.js,
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). The
[pinned upstream notice](https://raw.githubusercontent.com/Tonejs/audio/869b6f8d9cddb47d966238c012041480b1ce517a/salamander/README)
is retained locally. Playback changes sample pitch for intervening notes and
adds the app's gain, damping and reverb.

Recording schema version 1 remains unchanged. Additive scene configuration
contains the keyboard placement/layout, `black_keys_near_camera` orientation,
Listening and sample provenance. Live orientation changes add configuration
snapshots and release held notes with reason `piano-orientation`.
`analysis.piano_events` stores note-on, note-off, ownership and Listening events;
note events include key, MIDI, current/previous feet, source, session, scan
generation and pose/depth/event times. Unconsumed shutdown events are retained
in `manifest.final_analysis.piano_events`. Audio is the final audible mix.

Run `python -m unittest discover -s tests -p 'test_piano_assets.py'` and
`python tests/test_browser_piano.py` with Playwright and Chrome installed.
The browser test blocks external networking and uses real prepared samples,
Web Audio, GPU rendering and recording with explicit camera/foot fixtures.
It also replays measured missed-jump traces to check shifted landings, ten
consecutive bounces per foot with nearly stationary toes, and held contact.
Interactive camera checks retain a complete numerical
contact trace under `/private/tmp/d2m-piano-validation` for diagnosing misses.
Physical white/black key contact, two-foot playing, step-off damping and
recorded-playback listening still require a person and a suitable camera view;
fixture tests do not certify those checks.
