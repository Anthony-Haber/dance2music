# Browser recording bundles

In the live browser app, press **Record**, then **Stop recording**. The download
is one `dance2music-<UTC-time>-<session-id>.zip` containing:

- `recording.mp4`, `recording.webm`, or `recording.m4a`: the existing composited
  video and instrument output, or sound only.
- Optional `microphone.m4a` or `microphone.webm`: a separate microphone track.
- `manifest.json`: session identity, timing, effective configuration history,
  model provenance, artifact sizes, and SHA-256 checksums.
- `observations.jsonl`: one JSON object per processed video frame.

Recording always includes the body pose. Detailed hands are included when
enabled; off/near/far changes are preserved within the recording. Sound-only
recordings also include movement observations. All packaging stays in the
browser. Keep the tab open until the bundle is ready. The download link remains
available until another recording starts. If packaging fails, retry the ZIP or
download the recovery files before clearing the recording (including the
microphone file when captured). Recovery
manifests have `packaging_incomplete: true` and lack artifact checksums.

When **Scene** selects 3D Models or a percussion set for a live camera, its freshly rendered scene
layer is composited between camera video and existing overlays. Video includes
the same estimated depth occlusion, mirroring, and **Show surfaces** display as
the preview. Configuration history adds a `scene` field with selected/effective
state, exact model/runtime provenance, processing transforms, approximate camera
projection, accepted surfaces, and object transforms for each scan. It does not
store per-frame depth maps or masks, and does not change schema version 1.
When **Touch effects** is enabled, the video also includes the same glow,
particles, and ripples as the preview, and its audio includes chord-based contact
notes. `scene.touch` records interaction settings; Mix has an objects fader.
Percussion recordings add `scene.mode` (`percussion-kit`, `percussion-hand`, or
`percussion-metal`) and `instrument` identities on scan objects and touch events.
Their contact events include the estimated body region in `part` (or `body`
when no nearby pose landmark can identify it), plus synthesized voice identity,
stereo pan, and audio time in `sound`. Percussion sound metadata has no chord or
MIDI fields. The original shapes use `scene.mode: "models"`; disabled selection
uses `none`. All fields remain additive in recording schema version 1.
See [3D objects](3d-objects.md) for assumptions and scene validation.

Google Magenta recordings use `scene.mode: "magenta"` and add
`scene.magenta` with prompts, musical controls, requested/effective model,
conditioning latencies, and asset provenance. `analysis.magenta_weights` stores
the current spatial blend; `analysis.magenta_events` stores timestamped prompt
edits/encoding states, applied weights, note controls, phrase captures, tracking,
and fallback events. Their `timestamp_s` is relative to recording start.
Events pending after the final pose observation, including Stop's note release,
are retained in `manifest.final_analysis.magenta_events`.
Video includes the preview's prompt labels and influence meters. Main audio
contains the final Original/Magenta listening mix after master volume. Rolling
conditioning audio, full depth maps, and masks are not saved. The optional
microphone remains a separate artifact and never conditions the model. See
[Google Magenta](google-magenta.md) for the native input semantics and tests.

Mouse-dragged object positions appear in the composited video and configuration
snapshots. Moved objects have `placement: "manual"` with updated support, centre,
orientation, and surface; earlier snapshots keep their original transforms.
Mouse dragging itself emits no musical touch event.

This format preserves evidence for a future Zones importer. **It is not yet
directly loadable in `soniqflow-m5stack-python`'s `scripts/zones_app.py`.** This
change adds no importer and modifies no Zones source files.

Check **Record microphone separately** before pressing **Record** to include
microphone audio in either video or sound-only mode. The checkbox starts off on
every page load and is locked for the entire recording. The app requests the
system default microphone only when recording starts, using the browser's
default audio processing. There is no monitoring, device picker, or mixing with
the instrument output. While permission is pending, **Cancel recording** cancels
startup; any microphone stream that arrives later is released. Stopping the live
app also cancels pending startup.

If access or initialization fails, the main recording continues and the recording
status shows the reason. If the microphone disconnects or fails during capture,
the main recording and movement observations continue; available microphone
audio is saved and the download status reports the interruption. Microphone
tracks are released when capture ends. No microphone file is included when no
audio bytes were captured.

On Safari, the app switches the Audio Session to `play-and-record` before asking
for the microphone, and restores `playback` after capture ends, fails, or is
cancelled. Sound-unlock taps preserve this capture mode. A dedicated microphone
status beside the recording controls stays visible through packaging and the
completed download, including a warning when no microphone file is available.

## Version 1 contract

The manifest has `schema: "dance2music.recording"`, `schema_version: 1`, a UUID
`session_id`, UTC `created_at`, `duration_s`, `observation_count`, `timing`,
`coordinates`, `landmark_layouts`, `media`, `configurations`, and `artifacts`.
New recordings also include the additive `microphone` field described below;
older version-1 bundles may omit it.
An importer must dispatch on the schema and version, rather than file extension.
All JSON is UTF-8 and uses `null` for unavailable or nonfinite numbers. Numeric
zero is an observation, not a missing-value marker.

`artifacts.media` and `artifacts.observations` each declare `path`, `size_bytes`,
and lowercase hexadecimal `sha256` of the uncompressed file bytes. The manifest
also includes `artifacts.microphone` with the same fields when microphone audio
is available. Microphone bytes count toward the ZIP size bound and packaging
progress, and are retained for ZIP retries and recovery downloads. The manifest
does not checksum itself. Media is stored without additional compression;
JSON files are deflated. ZIP32 bundles exceeding the supported 4 GB size bound
fail with recovery downloads instead of producing an invalid archive. Recording
and final ZIP blobs still require browser storage/memory proportional to their
size; there is no persistent recording or recovery after closing the tab.

`media` records the actual MediaRecorder MIME type, audio-only selection,
encoded dimensions, nominal canvas rate (30 Hz), compositing and burned-in
overlays, instrument audio source, and any MediaRecorder error. `complete: false`
marks interrupted media; it does not turn previous valid observations into
missing values. An empty or very short take is allowed and does not imply
enough data for an embedding.

`microphone` contains `selected`, `outcome` (`disabled`, `unavailable`,
`complete`, `interrupted`, or `no_audio`), `error`, the actual `mime_type`, and
available audio track `settings` (`sampleRate`, `sampleSize`, `channelCount`,
`echoCancellation`, `noiseSuppression`, `autoGainControl`, `latency`). Unavailable
metadata is null; unavailable individual settings are omitted. Device identifiers
are not stored. `start_offset_s` and `end_offset_s` record capture start/stop
relative to `timing.performance_origin_ms`, using the same monotonic clock as
the main recording. They are null if microphone capture never started.
Offsets support later alignment, but independent browser recorders do not
guarantee sample-accurate synchronization. An interrupted file can contain less
audio than its timing interval if the browser dropped data at failure.

### Timing and configurations

Each observation contains:

| Field | Meaning |
|---|---|
| `frame_index` | Zero-based index of stored observations, not encoded media frames |
| `timestamp_s` | Monotonic inference-start seconds since recording start |
| `task_timestamp_ms` | Actual `performance.now()` timestamp supplied to the pose task |
| `source_timestamp_s` | Source video playback time, including resets on looping |
| `capture_timestamp_s` | Capture time relative to recording start when the browser supplies it |
| `expected_display_timestamp_s` | Browser's expected display time relative to recording start, when available |
| `presented_frames` | Browser video-frame callback counter when available |
| `source_segment` | Starts at zero; increments on source change or source-time regression |
| `source_discontinuity` | True on the first observation after such a change |
| `configuration_index` | Index into the manifest's configuration history |

Record timestamps strictly increase, including across video loops. Gaps remain
gaps; timestamps are not reconstructed from nominal FPS. Capture timestamps can
be negative for a frame captured just before recording began. The RAF fallback
skips unchanged `video.currentTime` values. A backgrounded tab can have large
gaps. Observations and the independently captured composited video have different
sampling rates: timestamp proximity is available, but frame-exact alignment is
not guaranteed. Hand inferences also preserve their own task timestamps, which
can differ slightly because each recognizer requires increasing times.

Each configuration entry contains `timestamp_s` and `settings`. It records the
effective source ID/type/dimensions, pose model, hand mode/loading/requested
mode/model identities, crop and association policies, mirror settings, and
existing musical mapping, sensitivity, mix, and gesture-action settings.
Changes during model loading continue to identify the model actually producing
observations. Sources have fresh IDs when reopened; file metadata uses only
the file name, size, and last-modified time, not local paths or camera device IDs.
The source file itself is not copied or hashed; the composited recording is.

Detector provenance includes the actual model bytes' SHA-256 (the same byte
buffer given to Tasks), detector family, delegate, thresholds, running mode,
and pose/hand count limit. CDN runtime identity is pinned to the app's Tasks
package version. A local runtime has a recorded relative module path and
`version: null`, `origin: "local_unverified_version"`; its version is not guessed.
Do not assume different runtimes or model hashes produce interchangeable results.

### Body pose

`pose` contains `status` (`detected`, `not_detected`, or `error`), `error`,
`detected`, `pose_count`, and these arrays in MediaPipe's standard 33-point order:

| Field | Shape | Coordinates |
|---|---|---|
| `image_landmarks` | `[33,3]` | Raw normalized image XYZ |
| `world_landmarks` | `[33,3]` | Raw detector world XYZ in metres |
| `visibility` | `[33]` | Actual detector values when supplied |
| `presence` | `[33]` | Actual detector values when supplied |

No detection retains the same shapes with null values. Pose data is copied
inside the Tasks callback, before smoothing or display mirroring.

### Detailed hands

`hands` contains its effective `mode`, a `status`, optional `reason` or `error`,
and `inferences`. Status distinguishes `disabled`, `skipped`, `completed`, and
`error`. Skip reasons include model loading, missing usable pose, missing wrist,
and pose inference failure. A completed inference can contain no detections.

Each inference records `task_timestamp_ms`, `attempted_side` (`L`/`R` in far
mode, null in near mode), `crop_px: [x,y,width,height]`, `input_size`, detection
status, browser `associations`, and ordered `candidates`. Each candidate has:

- `candidate_index` in the original detector result.
- `detector_image_landmarks`: `[21,3]`, normalized in the detector input.
- `image_landmarks`: `[21,3]`, mapped into full source-image coordinates.
- `world_landmarks`: `[21,3]`, unchanged detector world coordinates in metres.
- All returned `handedness` and `gestures` categories, with original index,
  category/display names, and scores. Absent scores remain null.

For crop `(x,y,w,h)` in a `W × H` frame, the image transform is
`[(x + u*w)/W, (y + v*h)/H, z*w/W]`. Black padding and coordinates outside the
source image remain explicit; nothing is clamped. World coordinates are not
translated or scaled by this transform. Near mode uses the full frame.

Far mode alternates wrists: **only the attempted hand is a new observation**.
The other hand is not filled with its previous displayed pose. Near mode keeps
candidate order even when the UI assigns candidates to wrists. `associations`
is a record of the existing browser heuristic, not authoritative anatomical
identity; its current heuristic can associate one candidate with both wrists.
An importer must resolve identity independently using the preserved evidence.
There are no fabricated hand visibility/presence arrays.

The application does not mirror inference inputs. Preview and recorded-video
mirroring are recorded separately. Whether a camera driver or an input file
already mirrored its pixels is unknown; downstream anatomical interpretation
must not infer that from the preview switch.

### Optional analysis outputs

`analysis` preserves existing numeric features and their events, displayed hand
state with each hand's last observation time, retained bounce state, current
chord, mapped sound controls, drum/gate/hold state, and gesture transitions.
These fields describe application state and may be smoothed or retained; they
are not fresh raw detector evidence. Feature functions are omitted. Feature
`t` and `lastOnset` use the app's feature clock: add `feature_clock_offset_s`
to express them on the recording clock. Bounce tracker timestamps are on the
performance clock; subtract `timing.performance_origin_ms / 1000`. These are
optional analysis aids, not a promise of exact audio synthesis replay.
An `analysis_error` records downstream failures separately, preserving any raw
detector evidence already captured for that frame.

`analysis.scene_touch_events` contains newly detected approximate 3D contacts,
when any occur: `object_id`, `part` (hand or foot), `position` in arbitrary scene
coordinates, `generation` of the scan, and `approximate: true`. `timestamp_s`
uses the recording clock and identifies the contact pose; `timestamp_ms`,
`depth_timestamp_ms`, and `effect_timestamp_ms` use the performance clock for
the pose, supporting depth input, and effect onset. `sound` records the played
chord, MIDI note, frequency, timbre, stereo pan, and AudioContext time (or null
when audio is unavailable). An input captured just before recording begins can have a negative relative
timestamp when its effect starts during recording. Contacts are application
estimates rather than measured physical collisions. Held contact does not emit
repeated events. Depth maps and masks remain excluded.

## Mapping to Zones v0.2

Inspected on 2026-10-12: branch `v0.2`, HEAD
`ee3ef0fd6edcc0d3be8a81938b9d405267e0d46f`, **with uncommitted camera/hand work**.
The pose contract is `soniqflow.pose-take` v1. The unfinished hand contract is
`soniqflow.camera-take` v1 from feature `008-hand-landmark-training`; the commit
alone does not identify that working-tree contract.

Body data maps to the pose contract's `image_landmarks`, `world_landmarks`,
`visibility`, `presence` (float32), `detected` (bool), `timestamps_s` (float64),
`frame_index` and `task_timestamp_ms` (int64). Convert nulls to NaN. The JS task
clock is floating-point milliseconds; an importer must convert to strictly
increasing integer task timestamps without changing the scientific seconds.
For each point, confidence is the minimum of finite visibility and presence,
the sole finite value if only one is present, or zero if both are absent.
`landmark_valid` requires detection, finite image XYZ, and confidence >= 0.5.
Model/source changes must be segmented before creating single-model native takes.

The test-only adapter in `tests/validate_zones_pose.py` proves these arrays can
pass the local pose cache validator. It creates temporary artifacts, not usable
Zones sessions or a production importer, and does not claim provenance validation.

Hands require an importer adaptation, not just renaming arrays. Zones currently
expects a CPU Hand Landmarker, two candidate slots, confirmed pixel mirroring,
its own identity/barrier policies, and simultaneous evidence for combined
frames. The browser uses a Gesture Recognizer, can run on GPU, uses lower
thresholds, follows one body, and alternates cropped wrists in far mode.
Do not relabel this as native extraction, manufacture missing hand observations,
or bypass Zones' strict cache checks. A future importer must support this
provenance and asynchronous sampling explicitly, or re-extract from suitable
source footage under the native policy. Saving these complete observations
keeps custom offline analysis possible without repeating browser inference.

## Verification

Install `playwright` in a test environment with Google Chrome available, then:

```sh
python tests/test_browser_recording.py --zones-root /path/to/soniqflow-m5stack-python
```

Omit `--zones-root` to run just the browser and ZIP tests. The Zones check uses
that checkout's `.venv/bin/python`. Tests use synthetic detector results and
real browser canvas, audio, MediaRecorder, ZIP worker, and media playback.
They cover missing values, raw hand freshness, async mode loading, crop/depth
transforms, configuration changes, timing/loops, audio-only capture, retry, and
Python ZIP/checksum/array validation. Real camera/model inference and Safari/
Firefox still require platform smoke checks.
Microphone tests also cover default-off permission behavior, separate playable
audio in both modes, denied/missing devices, initialization failures,
disconnects/errors, pending permission cancellation and late-stream cleanup,
track ownership, locked controls, and microphone ZIP retries/recovery.
The Chrome suite also simulates Safari's Audio Session restriction, including
sound-unlock taps and restoring playback after cancellation and failures.
