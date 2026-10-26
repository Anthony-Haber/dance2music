# Browser recording bundles

In the live browser app, press **Record**, then **Stop recording**. The download
is one `dance2music-<UTC-time>-<session-id>.zip` containing:

- `recording.mp4`, `recording.webm`, or `recording.m4a`: the existing composited
  video and instrument output, or sound only.
- Optional `microphone.m4a` or `microphone.webm`: a separate microphone track.
- `manifest.json`: session identity, timing, effective configuration history,
  model provenance, artifact sizes, and SHA-256 checksums.
- `observations.jsonl`: one JSON object per processed video frame.
- `imu_data.csv`: every valid watch notification received during capture.
- `metadata.json`, `recording_meta.json`, `sensor-assignments.json`: Python and
  Soniqflow assignment metadata, included even in takes without watches.

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
Repeated taps carry `reason: repeated-strike`; scene touch settings record the
pull-back/return detection thresholds and minimum interval between strikes.
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

The updated `soniqflow-m5stack-python/scripts/zones_app.py` imports these bundles
with **Import ZIP…** (Import browser recording ZIP). Browser pose JSON remains
original evidence; it is not relabelled as a native Python pose/hand cache.

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

Watch artifacts also have `path`, `size_bytes`, and `sha256` entries under
`artifacts.imu`, `artifacts.metadata`, `artifacts.recording_meta`, and
`artifacts.sensor_assignments`. They count toward size limits and recovery files.

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

## Four-watch setup and Zones review

Use a browser exposing Web Bluetooth, such as desktop Chrome, over HTTPS or
localhost. Unsupported browsers show a watch explanation and keep normal
recording available. Each **Connect watch** click opens one device chooser, as
required by [Web Bluetooth's user-gesture rule](https://developer.chrome.com/docs/capabilities/bluetooth).

Firmware advertises `M5StickC-IMU-<pair>-L/R`, including on T-Watch hardware.
Arms default to pair `00`, legs to `01`; legs can be disabled. These preferences
persist locally. Assignments are locked during connection/startup/capture and
cannot share a pair. Device IDs are left/right arm `0/1`, left/right leg `2/3`;
the firmware role stays `0` for L and `1` for R, independently of limb ID.
Indicators show name, connection/streaming state, battery, and recent Hz.
Two seconds without valid notifications produces “connected · no stream”.
Battery bytes `0` and `255` mean unknown. Errors remain visible on the slot.

**Show live graphs** displays a scrolling plot for each limb below the camera
view as soon as a watch is selected. No camera or recording needs to be running.
Choose acceleration XYZ, acceleration magnitude, or gyroscope XYZ, with a 5, 8,
or 20 second window. Axes use a common automatic scale across limbs; acceleration
includes gravity (roughly 1 g magnitude at rest). T-Watch gyro fields remain zero.
The graphs refresh at up to 20 frames per second, preserve gaps over 200 ms,
and keep a bounded display history. Hiding them does not stop capture; recording
still saves every received valid sample. Graphs are a live monitor and are not
burned into the recorded camera video.

**Connect watch** starts scanning immediately and filters Chrome's chooser by
the shared `M5StickC-IMU-` name prefix. Unrelated devices such as keyboards and
mice are hidden. This standard Web Bluetooth name filter needs no experimental
flags, local launcher, or user configuration in supported Chrome browsers.
Wait a few seconds for your watch and select it; there is no separate scanning
action. The app also validates the complete watch name and assigned pair before
making a GATT connection. Service UUIDs are requested through `optionalServices`,
not used as discovery filters, because the firmware does not advertise them.
Each new watch still needs selection in the browser's permission chooser.
Chrome closes its chooser after one selection; the page cannot keep it open,
enable multiple selection, or read the full detected-device list. After each
selection, **Connect next watch** opens the chooser with already selected watch
names excluded. Progress shows connected watches out of the configured two or
four slots. When all slots connect, the button changes to **All watches connected**
and is disabled. Selected but disconnected watches use their individual
**Reconnect** buttons. Partial sessions remain supported; this progress is not
a count of devices detected nearby. Every new chooser is opened by a page click,
preserving the browser's required user interaction.

**Automatically connect paired watches** defaults on and is remembered locally.
Once approved, watches for the selected arms/legs pairs connect when the page
opens, without another chooser. The app uses `getDevices()` to retrieve approved
devices and `watchAdvertisements()` when available to discover them before
connecting. A dropped or out-of-range watch retries automatically, with pauses
of 2, 4, 8, 16, then at most 30 seconds between attempts. Each discovery attempt
waits up to 12 seconds for an advertisement. Each connection repeats service
discovery, time synchronization, and notification subscription. Gaps stay in
recordings and graphs. Duplicate authorized devices for one limb require an
explicit chooser selection; unrelated devices are never connected.

**Disconnect** or **Cancel connection** pauses that watch until **Reconnect** or
the next page load. Turning automatic connection off cancels pending automatic
attempts and retries, while healthy connections remain active. Permission or
missing-service errors remain visible and require an explicit retry after fixing
the problem. Turning automatic connection back on resumes eligible watches.

Chrome currently keeps remembered devices behind its experimental Bluetooth
permissions feature. `live.py` passes
`--enable-features=WebBluetoothNewPermissionsBackend` to Chrome; this enables the
required APIs and persisted permissions while retaining the initial chooser.
**Fully quit Chrome once before launching the updated `python3 live.py`**: an
already-running Chrome process ignores new launch options. Pair each watch once
after this change, and use the same Chrome profile and origin (including port;
`localhost` and `127.0.0.1` have separate permissions). Clearing site permissions
requires pairing again. The launcher does not enable all experimental web
features or modify Chrome's saved flags. When opening the page without this
launcher, the corresponding `chrome://flags/#enable-web-bluetooth-new-permissions-backend`
setting can be enabled manually; see [Chrome's getDevices sample](https://googlechrome.github.io/samples/web-bluetooth/get-devices.html).
Browsers without `getDevices()` explain the limitation and still reconnect watches
approved in the current tab after an unexpected disconnect.

If the chooser stays empty, **fully quit Chrome with ⌘Q**
and run `python3 live.py` again, even if Bluetooth permission is already enabled. Closing
a tab or window does not fully quit Chrome. On macOS, check **System Settings → Privacy & Security →
Bluetooth → Google Chrome**, then fully quit/reopen Chrome. Disconnect watches
from other apps, phones, and tabs before retrying. The app reports when Chrome
says Bluetooth is unavailable; a cancelled/empty chooser now exposes these
recovery steps. The current watch firmware advertises names without its service
UUID, so discovery does not require advertised services.

On macOS, `live.py` launches the Chrome executable directly in its normal
profile, using the launch method that restored watch discovery on the test Mac.
It falls back to Launch Services for nonstandard Chrome installations. If
Chrome is already running, its existing process/profile is reused; fully quit
an existing session with stalled discovery before retrying. The Python server
stays in your terminal: **Ctrl+C** stops it and releases port 5092. Closing
Chrome alone does not stop the server.

The receiver accepts exactly 36-byte little-endian v2 packets (`<6fQBBBB>`),
using service/notify/time-sync UUIDs `12345678-1234-5678-1234-56789abcdef0/1/2`.
Each connection discovers the service again, writes an eight-byte epoch-ms
timestamp, then subscribes. Failed time sync is recorded and shown; reception
can continue using receipt time. Invalid length/version/role, nonfinite values,
and identity conflicts are rejected. The canonical transform is
`(ax, -ay, az, -gx, gy, -gz)`; T-Watch's zero gyro fields remain zero.

The CSV header is exactly:

```csv
sync_time,timestamp_ms,device_id,ax,ay,az,gx,gy,gz,role,button_flags
```

`sync_time` is notification arrival time on the recorder's monotonic clock,
relative to actual capture start. `timestamp_ms` is the unmodified device
uint64 timestamp. Every valid notification becomes one row, with no browser
resampling. Pending microphone permission, stopped takes, and packaging do not
capture IMU. Watches stay connected across takes; unexpected disconnects retry
when automatic connection is enabled. Manual Disconnect pauses retries.
`manifest.watches` includes assignments, orientation, protocol, per-device
counts, recording-relative connection intervals and time-sync outcomes. Negative
time-sync timestamps describe synchronization before recording began.

Install local `ffmpeg` and `ffprobe` on PATH for Python import (for example,
`brew install ffmpeg` on macOS). Import runs in a cancelable worker and validates
the manifest, checksums, CSV, assignments, and archive paths. Only a fully
converted take is published as a new folder in built-in Sources. Existing takes
and the original ZIP are preserved. Source files live in `browser_originals/`,
with `source_manifest.json` at the recording root. Converted output is
`video.mp4` when present, PCM `audio.wav` for instruments, and optional
`microphone.wav`. `sync_info.json` uses decoded media timestamps and recorded
microphone offsets, never pose-observation frame counts.

Choose the imported take in **IMU Recording**, then Play. The same transport
controls all four sensor channels, companion video, and selectable instrument
or microphone audio. Instrument audio is the default; **Send MIDI** mutes
recorded audio while generating new music. Audio-only takes also work.
The **Arms/Legs** selector chooses the pair for existing classification/music;
limb-labelled CC inputs and note mappings remain independent. Missing channels
produce no controls, and processing never fills gaps longer than 200 ms.

Limb notes start disabled. Defaults: notes `60/62/64/65`, MIDI channel 1,
velocity 100, duration 120 ms, activity `abs(norm(acceleration) - 1 g)`, onset
0.35 g, release 0.15 g, and minimum interval 200 ms. All values are editable.
Release is required before another onset; overlapping owners of the same note
share its release. Seek, stop, source/pair changes, and unavailable input reset
the appropriate state. Note settings and existing CC cards persist in presets.

Receipt-time alignment includes BLE delivery and scheduling delays. Browser
media capture and separate microphone recording are independent clocks; this
format supports approximate synchronized review, not sample-accurate sensor,
video, or audio synchronization. No browser watch-driven music, recognition,
native pose-cache import, classifier retraining, or Python live BLE
expansion is included.

### Hardware acceptance (manual)

Connect `00-L`, `00-R`, `01-L`, and `01-R`; confirm their limb slots and moving
Hz indicators independently. Check approximately 1 g stationary acceleration
in the CSV and zero T-Watch gyro fields. Record with all four, disconnect one
for at least a second, explicitly reconnect, and record a second take. Confirm
the gap, repeated time sync, per-take sample counts, and retained connections.
Import both ZIPs in Zones, play video/instrument/microphone tracks, switch the
processing pair, and test each enabled limb note/CC independently. Seek and
stop during held notes and verify silence. This check requires physical watches
and a MIDI/audio output; mocked automated tests do not certify the hardware.

For an opt-in hardware test through the actual app's Chrome chooser:

```sh
python tests/test_browser_watches_hardware.py --output /tmp/watch-hardware
```

This selects only the four `00-L/R` and `01-L/R` watches, tests time sync and a
disconnect/reconnect, saves a ZIP with real IMU and synthetic media, and releases
all connections. It needs Chrome Bluetooth permission and physical watches;
it is not part of the ordinary mocked test suite. `report.json` records measured
rates, packet counts, gravity magnitude, battery, and gyro values.

Also verify discovery in the user's ordinary Chrome profile. During hardware
testing on 2026-10-26, both ordinary and fresh test profiles could show an empty
chooser with Bluetooth permission enabled: macOS logged zero advertisements
delivered to Chrome while a native scan saw all four watches. Fully quitting
the app's Chrome process and relaunching restored discovery in the ordinary
profile. All four watches then connected through the visible chooser. This is
a recovery observed on that Mac, not a diagnosis of the underlying OS/browser
fault; a passing isolated browser test alone does not verify the user's session.

## Pose evidence mapping to Zones v0.2

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
python tests/test_browser_watch_plots.py
python tests/test_browser_watch_autoconnect.py
```

Omit `--zones-root` to run just the browser and ZIP tests. The Zones check uses
that checkout's `.venv/bin/python`. Tests use synthetic detector results and
real browser canvas, audio, MediaRecorder, ZIP worker, and media playback.
They cover missing values, raw hand freshness, async mode loading, crop/depth
transforms, configuration changes, timing/loops, audio-only capture, retry, and
Python ZIP/checksum/array validation. Real camera/model inference and Safari/
Firefox still require platform smoke checks.

Four-watch tests use reference-layout packets and four mocked GATT devices with
real browser media/ZIP creation. Export import fixtures with
`--watch-fixtures-dir /tmp/watch-fixtures`. In the Python repository, run
`BROWSER_WATCH_FIXTURES=/tmp/watch-fixtures .venv/bin/python -m pytest -q
tests/test_browser_import.py tests/test_limb_routing.py`. The import tests also
generate MP4/WebM, microphone, and audio-only media using local FFmpeg.
The plot test drives all four channels through notification decoding while the
camera is off, checks signal selection, display gaps, bounded history and
continued recorder delivery when hidden, and checks Retina/mobile layout.
The automatic connection test checks the installed Chrome's real API availability
with the launcher option, then uses simulated watches for restoration of four
channels, discovery/retry/cancellation, duplicate identities, permission failures,
page reload, persistent opt-out, and live graphs. It does not connect to physical
watches or change the user's Chrome profile. Test servers and browsers close on
completion.
Microphone tests also cover default-off permission behavior, separate playable
audio in both modes, denied/missing devices, initialization failures,
disconnects/errors, pending permission cancellation and late-stream cleanup,
track ownership, locked controls, and microphone ZIP retries/recovery.
The Chrome suite also simulates Safari's Audio Session restriction, including
sound-unlock taps and restoring playback after cancellation and failures.
