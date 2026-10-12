# Automatic 3D objects

Enable **3D objects** before Start, using a live camera in Chrome on Apple
Silicon. The selection is remembered and locked until Stop. Video-file sources
disable it. Keep the camera stationary and leave some floor or tabletop visible.
No manual calibration or camera movement is required.

Start opens the camera, loads the models, and scans three sequential frames
before music starts. **Cancel** releases the scene worker and camera. Up to three
simple shapes are placed: one per accepted tabletop first, then separated floor
locations. Uncertain surfaces are rejected. **Show surfaces** displays accepted
boundaries and placement points; **Rescan** is optional. Objects remain anchored
when someone moves or leaves the view.

**Touch effects** is enabled by default and can be toggled during a session; the
selection is remembered. Shapes gently pulse at rest, brighten when a hand or
foot approaches, and release colored sparks, a surface ripple, and a short note
from the current chord on contact. Cube, sphere, and cylinder use mallet, bell,
and wood tones. Adjust or mute **objects** in Mix; master volume also applies.
Hold contact for a sustained glow; move away and return for another burst. Reach
slowly and keep the hand or foot visible. Touch is an approximate visual effect:
the monocular depth estimate cannot establish physical contact. It requires a
confident person mask and fresh, aligned depth near the shape, rather than only
overlap in the image. Fast swipes or uncertain depth may intentionally miss.

When no placement is possible, music starts with “No suitable surface found.”
The scan retries every 15 seconds. Persistent camera/background changes trigger
an automatic rescan, hiding invalid placements while music continues. Returning
from a background tab waits for fresh depth and validates the existing placements;
it rescans only if background alignment or scene-change checks fail persistently.
An interrupted startup scan restarts. Missing WebGPU, model errors, GPU loss, and
timeouts disable the scene and leave the music experience available.

Depth is approximate. This is a fixed-view visual effect, not room measurement,
physical collision detection, or a world-tracked AR system. Custom models,
physics, and Safari qualification are outside v1.

## Offline preparation

While connected, run:

```sh
python live.py --offline
```

This downloads the pose/gesture assets and about 138 MB of scene assets under
ignored `web/live/vendor/`. Keep that directory with the application at the
venue. The scene installer verifies SHA-256 and sizes, repairs corrupt files,
and writes its completion marker only after all files pass. It consumes every
file listed in `scene-assets.lock.json`, including external ONNX weight files
if a future pinned model uses them. The current pinned graphs are self-contained.
To prepare just the scene assets without opening a browser, run
`python scene_assets.py`.

A complete prepared installation uses local models, modules, and WASM, including
in a fresh browser profile with external networking blocked. Without that
installation the scene downloads the pinned assets and verifies/caches them in
Cache Storage. Do not rely on browser cache alone for a venue installation.
MediaPipe 1.0.1 may attempt an upstream telemetry request; blocked-network tests
block that request as well. No inference server receives camera frames.

Pinned dependencies and provenance:

- [Transformers.js](https://huggingface.co/docs/transformers.js/custom_usage)
  3.8.1; its bundled ONNX Runtime 1.22.0-dev.20250409-89f8206ba4.
- [Depth Anything V2 Small](https://huggingface.co/onnx-community/depth-anything-v2-small/tree/4472b7362082ad9968fee890ca0f1e5aca36b93d),
  revision `4472b7362082ad9968fee890ca0f1e5aca36b93d`, FP32.
- [SegFormer B0 ADE20K](https://huggingface.co/Xenova/segformer-b0-finetuned-ade-512-512/tree/d3e5499fa8701ff0453ca940a8dfeae39b2f1504),
  revision `d3e5499fa8701ff0453ca940a8dfeae39b2f1504`, FP32.
- Three.js 0.160.1. Exact runtime, configuration, and weight hashes are in
  `web/live/scene-assets.lock.json`.

## Geometry and occlusion

The worker applies explicit whole-image stretch transforms to 518 × 518 depth
and 512 × 512 segmentation inputs, without cropping or padding. Input means/stds
come from the pinned processor configurations. Floating-point model outputs
are mapped back to a common source-aspect grid using those transforms. The
worker never reconstructs depth from a display-normalized image.

Surface reconstruction runs in the inference worker. Candidates use ADE20K probabilities for floor/rug and table/desk/coffee
table, person exclusion, boundary erosion, deterministic robust inverse-depth
plane fits, and agreement across three frames. Floor normals establish up; the
upright-camera prior conservatively rejects vertical sides/legs and uncertain
tabletops. A centered 60° vertical-FOV pinhole camera and one positive inverse-
depth normalization are fixed per scan. Units and projection are explicitly
approximate. Object footprints and their interiors must fit within a patch;
projected object volumes must also be clear of people and separated in the image.

During music, one depth request at a time targets 10 Hz. Robust affine alignment
uses unchanged, spatially distributed background pixels and excludes people.
MediaPipe person masks are copied during its callback; ambiguous silhouette
edges are suppressed, while confident person pixels retain depth-based ordering.
GPU masks are downsampled into RGBA8 before readback. This avoids the pinned
MediaPipe runtime's RED/FLOAT readback, which returns zero masks with an invalid
format error on the tested Chrome/ANGLE Metal backend. The conversion restores
MediaPipe's GL bindings, render state, and pixel packing before inference resumes.
Three.js renders object color and depth into a target, then composites against
aligned real-scene linear camera depth. This supports objects both in front of
and behind people and furniture.

Depth older than 200 ms or failed alignment hides affected objects. Motion and
uncertain silhouette edges suppress individual pixels, preserving the rest of
the shape instead of making the entire object blink. Rendering never waits for depth and does not delay
video/audio. Inference frequency decreases when pose throughput falls below
85% of a two-second pose-only reference taken after startup scanning. The worker
avoids main-thread inference, but still shares the GPU with pose/rendering.

The preview and recorder use the same fresh, unmirrored scene layer. Mirroring
is applied only for display/composition, and the scene sits between camera video
and existing overlays. Recording configuration adds `scene`: pinned provenance,
processing transforms, approximate projection, normalization, surfaces, object
transforms, scan generation/time/duration, and debug selection. Full depth maps
and person masks are never written per frame. Existing recording schema v1 is
unchanged.

## Touch effects

Pose wrist/index and ankle/heel/toe landmarks are copied with each depth input.
Small foreground neighborhoods near limb edges provide a robust depth median;
the raw aligned map is kept separate from display suppression. Contact runs at
pose speed, using the latest foreground depth for at most 200 ms and bounded
image motion. Projected object bounds have a small touch margin, while a separate
depth band rejects hands/feet clearly in front or behind. The band includes 15%
depth uncertainty, reflecting the monocular model's limits. Body-relative pose Z
is not used. Swept entry detects taps between depth frames; otherwise two pose
observations spanning 25 ms confirm contact. Release hysteresis is 120 ms and
cooldown 320 ms. Missing foreground support, incoherent depth, stale results, and
large tracking jumps still reject contact. Rescan, Stop, and disabling effects
clear state. **Show surfaces** adds target boxes and limb dots: cyan has valid
depth, yellow is waiting for it. Diagnostics give a contact count and reason.

Each object has a fixed pool of 56 particles (168 maximum), an emissive core,
transparent halo, and an expanding ring. Bursts last 1.8 seconds, with a minimum
7-pixel spark size and a minimum projected spread for distant shapes. Sparks
launch above and around the object so a shoe covering the contact point does not
hide the whole effect. No additional model, texture download,
physics engine, or bloom pass is needed. Effects use the same freshness/motion
suppression and real-scene depth as objects. Transparent fragments are also
occluded before blending, so sparks cannot reveal hidden geometry underneath.
Preview and recording use the same timestamp-based animation. Configuration
includes `scene.touch`; observations optionally include
`analysis.scene_touch_events` with object ID, hand/foot, approximate contact
position, scan generation, pose/depth timestamps, and played-note metadata.
Contact notes use the current harmony, pan with the mirrored display, and feed
the existing master, reverb, limiter, and recording output. A separate objects
fader keeps taps audible when movement-driven instrument volume is zero. Voices
are bounded to six and disposed after their envelopes finish or on Stop.

## Validation

With Google Chrome and Playwright installed in a test environment:

```sh
python tests/test_scene_assets.py
python tests/test_browser_scene.py
python tests/test_browser_scene.py --real-models
python tests/test_browser_scene.py --real-models --camera
python tests/test_browser_recording.py
```

Browser scene tests require prepared scene assets. `--real-models` also requires
MediaPipe assets from `live.py --offline`. Every scene browser run uses a fresh
context and blocks external network requests. Without `--camera`, Chrome's
synthetic live camera is used, including conservative rejection of its test
pattern. `--camera` uses the real camera with camera permission and saves local
validation evidence under `/private/tmp/d2m-scene-validation` (override with
`--output`). Evidence includes a preview, recording ZIP, scan metadata, timing,
and throughput; camera imagery is not committed to the repository.

Coverage includes synthetic floor/table geometry, table legs, uncertain/occluded
boundaries, invalid/constant depth, affine scale changes, footprint holes,
projection/mirroring, actual GPU depth ordering, stale/alignment suppression,
cancellation/restart, generations, bounded requests, mask ownership, automatic
rescan, tab visibility, empty-scene retries, worker/context failure, live controls,
and decoded video pixels for occlusion/mirroring. Existing recording/microphone
regressions pass. Installer tests cover corruption repair, external weight files,
and interrupted/invalid downloads.

Touch tests cover held/repeated contact, hand and foot entry, front/behind depth
rejection, missing/uncertain masks, stale/moving landmarks, oriented shape volumes,
generation resets, fixed particle pools, effect expiration/toggling, GPU occlusion,
and decoded recording pixels plus event metadata. Real GPU float-mask readback
is tested with supported RGBA8 conversion and restoration of MediaPipe's GL
state. Audio tests decode the recorded output and check the actual chord-note
frequencies, including when the movement instrument gate is zero. These are controlled tests;
touch accuracy in a particular room still depends on the camera and model depth.

On 2026-10-12, Chrome 147.0.7727.56 on the available Apple Silicon/Metal-3
Mac with a Logitech BRIO at 1280 × 720 and the full pose model produced:

| Check | Pose throughput | Median depth |
| --- | ---: | ---: |
| Feature off, camera baseline | 30.0 fps | — |
| Final touch path, moving person and working GPU masks | 30.1 fps | 41.5 ms |
| Continuous visual bursts on three shapes | 29.2 fps | — |

The foreground run sampled 10.25 seconds: 38 of 40 samples had nonzero person
masks, and 39 of 40 had fresh visible objects. This meets the 85% throughput
criterion. Scanning took about 0.7 seconds, separate from asset downloads and
model loading. The burst stress test deliberately injects renderer events to
measure load; it does not claim physical contact recognition.

The live diagnostic trace separately recorded 30 real contacts after the mask
repair, including hands and feet on the cube and feet on the sphere and cylinder.
The user heard the sphere's note, then confirmed the brighter cube note, glow,
sparks, and expanding ripple after the visual/audio adjustment. All three shapes
were subsequently restored. A live visibility-return check preserved their
transforms and recovered fresh depth without rescanning. Tabletop placement and
conservative rejection were also exercised during the original geometry checks.

The standalone camera benchmark first ran without a tracked foreground person:
recording, rescan, and throughput checks completed, but its new person-mask
presence assertion correctly failed. The foreground figures above come from the
subsequent live diagnostic qualification, not that unattended run. Earlier
throughput-only checks did not detect the zero-mask bug; the suite now verifies
actual GPU mask readback and requires foreground evidence for camera acceptance.

Controlled GPU, audio-frequency, lifecycle, and decoded-recording checks pass
with external networking blocked, along with the existing recording/microphone
regressions. Audio contexts remained running during the benchmarks. These checks
and the user's live feedback establish operation in this room; monocular touch
accuracy and occlusion remain approximate, particularly during fast movement.
