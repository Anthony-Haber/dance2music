# Offline Google Magenta scene

Select **Google Magenta** in **Scene** before starting a live camera session.
The native MRT2 model generates music locally. Three colored prompt objects
share the existing floor/table scan, occlusion, mirroring, and dragging. Approach
an object with any confidently detected body part to increase its influence.
The meter below its label and the matching sidebar meter show the text blend.

Click a label to edit its prompt, then Apply or Cancel. Drag the object itself
to move it. Sidebar prompt editors remain available when placement or depth
occlusion hides an object. Randomize prompts selects a compatible trio. Prompt
text and musical choices persist; rescanning keeps prompt identities/text and
rebuilds placements. Text encoding is asynchronous and retains the previous
valid embedding until its replacement is ready.

## Install the Mac app

The launcher targets **Apple Silicon Mac, macOS 14+, Chrome required**. Intel
Macs, Windows, Linux, phones, and tablets cannot run this native engine. iPads
using a desktop user agent are treated as tablets. Other website modes remain
available, and an unavailable saved Magenta selection resets to **None**.

The public website shows a download link only after a signed, notarized Mac
release is published. Until then, the installer is not available to download.
The release process is described in [Mac packaging](../packaging/macos/README.md).

The existing scene segmentation model, SegFormer, has NVIDIA terms limiting
its use to non-commercial research or evaluation. The app preserves those
[original terms](https://github.com/NVlabs/SegFormer/blob/65fa8cfa9b52b6ee7e8897a98705abf8570f9e32/LICENSE)
with the downloaded assets; packaging does not broaden that license.

1. Install Google Chrome if it is not already installed.
2. Download the versioned Dance2Music DMG from the website's Mac download link.
3. Open the DMG and drag **Dance2Music** to **Applications**. Eject the disk image.
4. Open Dance2Music. First setup needs internet and downloads approximately
   **4.9 GB** directly from the pinned model/browser upstream hosts. Keep at
   least **5.2 GB free**, in addition to the installer and application.
5. The launcher shows byte progress and verification status, then opens Chrome
   at `http://127.0.0.1:5092/live/`. Allow Chrome to use the camera when asked.
6. Choose **Google Magenta**, then Start. Base, Small, and Auto remain available.

No Python, Xcode, Homebrew, compilation, or Terminal commands are needed to use
the installed app. The browser is not bundled. The public website never
connects to the local service; use the Chrome tab opened by Dance2Music.

After setup, disconnect networking and use camera tracking, hands, scenes,
Floor Piano, Magenta, and recording offline. Starting a session never downloads
assets in the installed app. Closing the launcher window leaves the service
running; use **Quit** to stop downloads, the server, and native music workers.
Click its Dock icon to reopen the window; **Open in Chrome** reopens the tool.
The fixed local address preserves Chrome permissions and browser settings.

Downloads and the installation record live in
`~/Library/Application Support/Dance2Music/`. Diagnostic logs live in
`~/Library/Logs/Dance2Music/`. The signed application bundle is never modified
by setup or a session. Completed downloads are reused only after their sizes
and SHA-256 hashes verify. An interrupted file starts over on Retry; other
verified files remain available.

### Troubleshooting and updates

| Launcher message or symptom | Action |
| --- | --- |
| Chrome is missing | Install Google Chrome, then choose Retry. |
| Setup needs internet | Reconnect and choose Retry. Missing assets cannot be installed offline. |
| Insufficient disk space | Free the amount shown on the disk containing Application Support, then Retry. |
| Checksum failure or missing/corrupt assets | Quit any music session, reconnect, and choose Retry to repair. If a bundled executable is damaged, replace the app from its release installer. |
| Port 5092 is occupied | Close the other app or developer server using that port, then Retry. Dance2Music never terminates another service. |
| Another copy is running | Use the existing Dance2Music window, or Quit that copy before launching another. |
| Local service stopped | Choose Retry. If it repeats, include the launcher and native `latest.log` files when reporting the problem. |
| Magenta is disabled in a browser tab | Open Dance2Music, finish setup, and use Open in Chrome. Reload older local tabs after setup. |

Updates are manual in v1: Quit Dance2Music, download a newer version, and
replace the app in Applications. Compatible verified downloads are retained;
changed assets are verified/downloaded during setup before the next session.
There is no automatic updater. Moving the app to another folder works; keep
the entire `.app` together.

To uninstall, Quit Dance2Music, move it from Applications to Trash, and remove
the Dance2Music folders in Application Support and Logs using Finder's
**Go → Go to Folder**. Removing Application Support deletes downloaded assets.
Chrome site data for `http://127.0.0.1:5092` can also be cleared to remove saved
browser settings and permissions. Recordings you exported elsewhere remain.

## Developer command-line installation

The existing checkout workflow requires Apple Silicon macOS 14+, Chrome with WebGPU, Python 3, Xcode command
line tools, and Apple's Metal compiler/toolchain. Prepare with internet access:

```sh
python live.py --offline
```

For installations that only use the existing browser scenes,
`python live.py --offline --without-magenta` skips the optional native build.

This prepares pose/hand/scene assets, builds the C++ helper, and installs Base,
Small, MusicCoCa, its tokenizer/mapper, and SpectroStream resources. The model
bundle is about 4.6 GB; source/build dependencies need additional disk space.
The flag prepares an offline installation; it does not forbid downloads during
setup. Repeating it verifies and reuses a current, complete Magenta installation
without invoking the build tools. Changed native sources or missing/corrupt
files require preparation again. Use `python magenta_install.py --rebuild` to
explicitly rebuild a verified installation.
CMake and Ninja are installed in an isolated tools environment if CMake is
unavailable. Models already present in `~/Documents/Magenta/magenta-rt-v2` are
reused only after every size/hash passes. To select another existing bundle:

```sh
python magenta_install.py --assets /path/to/magenta-rt-v2
```

The helper, build tree, receipt, and runtime log live under ignored `.magenta/`.
`native/magenta/manifest.lock.json` pins upstream commit
`694a545e4ba0b88bf1150137b129582166d3e07f`, matched model revision, asset sizes and
SHA-256 hashes, dependency revisions/hashes, and license identifiers. Downloaded
source trees retain their licenses. The receipt includes helper/manifest/bridge
hashes and model provenance. The MRT2 source uses Apache-2.0; model assets use
CC-BY-4.0. Preserve these notices and attribution when redistributing.

Start the app with `python live.py`. The browser checks the complete installation
before starting Magenta. Missing or corrupt assets leave the original music
available and explain how to prepare again. Starting a venue session never
downloads native assets. Other scene modes do not launch the native helper.

## Musical controls

| Control | Behavior |
| --- | --- |
| Audio + notes (default) | Uses genuine audio-style conditioning plus the synth's pitched notes and explicit attacks. |
| Audio reference only | Uses the same audio conditioning without note steering. |
| Continue recent phrase | Shows a green **Use recent phrase** action object when a fourth safe placement fits, plus a sidebar button. |
| Body-audio influence | Audio reference share, initially 35%; the three spatial text weights share the remainder. |
| Magenta with blend control | Starts Magenta-only. Original blend uses an equal-power crossfade. |
| Both together | Independent Original and Magenta levels, initially −6 dB each. |
| Keep music flowing | Tracking loss holds the last blend and releases notes after 500 ms. |
| Fade to silence | Additionally fades Magenta out over one second, then back over 300 ms when tracking returns. |
| Auto: Base, then Small if needed | Loads Base first; sustained underruns or pose throughput below 85% of the session baseline cause one transition to Small. |

Changing input/listening/tracking/model controls is allowed during a session.
Changing Scene requires Stop. Camera source, resolution, pose-model, or hand-mode
changes restart Magenta to measure the new configuration's baseline. If the
selected model fails, original body music remains available; Auto tries Small
once, then returns to original music with an explanatory status.

The original synth mix is captured before listening gains and master volume.
Consequently Magenta-only monitoring still supplies body music. The generated
output and separately recorded microphone never enter conditioning. Master
volume, mute, and the main recording apply to the final listening mix.

## Audio semantics and latency

The reference modes keep ten seconds of original stereo audio in memory,
resample to 16 kHz mono, and call native `set_audio_prompt_samples`. Three native
slots hold text and the fourth holds body audio. There is no placeholder audio
embedding or file-path adapter. Windows are offered every two seconds; only one
encoding job runs and only the newest pending window is retained. Text-only
conditioning is used until a useful ten-second reference exists. Silence does
not replace an existing useful reference.

Audio-style encoding is considerably slower than spatial control: initial
measurements on the M3 Ultra are about 27 seconds without the camera workload and
31 seconds with it. The previous reference remains active while a new one is
encoded. A separate native encoder allows live cached-text weight changes to
continue during encoding. This is style conditioning, not continuous audio
transformation.

Continue recent phrase captures up to the preceding ten seconds of original
audio and requires at least four seconds of audible history. The button and a
confirmed whole-body touch invoke the same native SpectroStream/context-prefill
path. MRT2 trims 25 frames (one second) from each boundary before prefill. It
then generates a continuation under the current text blend, without rolling
audio-reference updates or MIDI steering. Preparation initially measured about
three seconds. The app crossfades to original music during preparation, then
returns to the selected listening mix. Master mute remains effective. Holding
contact never repeats capture; release and re-entry are required after completion.
Dragging does not activate it. If the fourth object cannot fit, use the button.

Spatial weights use nearest surface distance to confident body points/segments
and foreground depth samples in approximate unmirrored scene coordinates.
Inverse-square weights use a distance floor of 30% of median object size,
normalize across placed prompts, smooth over 250 ms, and update at most 20 Hz.
Stale depth or tracking loss freezes the blend. Rescanning retains it until new
placements are known. With no placements all three sidebar prompts get equal
weight and the status explains that spatial control is unavailable.

## Runtime and recording

The local HTTP server validates application origin and a per-launch token before
opening its WebSocket bridge. A separate helper process owns each native model
session. Binary PCM and JSON controls use framed local IPC with session and
generation identifiers; late results are discarded. Both browser audio paths
use AudioWorklets. Native output is 48 kHz stereo, resampled to the audio device
rate. Playback targets 120 ms, caps its ring at 180 ms, and grants only five
20 ms PCM blocks of transport credit until the Worklet acknowledges delivery.
Together with the native 120 ms buffer this stays below the 500 ms output
budget, including when the browser stalls. Old timestamped blocks are discarded;
underruns fade/rebuffer. Stop/cancellation closes the connection, flushes
playback, releases notes, and terminates the helper, including native encoder jobs.

Recording remains schema version 1. `settings.scene.magenta` adds requested and
effective model, prompt text/applied text, controls, measured conditioning
latencies, spatial availability, and asset provenance. Observation analysis adds
`magenta_weights` and timestamped `magenta_events` for edits, actual applied
weights, notes, capture, tracking, and fallback. The main video uses the same
labels/meters as preview; the main audio contains the final mix. Full depth maps,
masks, and rolling conditioning PCM are not saved.
Events after the last pose frame are flushed into
`manifest.final_analysis.magenta_events` when recording stops.

## Verification

```sh
python -m unittest discover -s tests -p 'test_magenta_assets.py'
python -m unittest discover -s tests -p 'test_magenta_runtime.py'
python tests/test_magenta_native.py --assets /path/to/magenta-rt-v2
python tests/test_magenta_helper.py --assets /path/to/magenta-rt-v2
python tests/test_browser_magenta.py
python tests/test_browser_magenta.py --live-seconds 600 --camera
python tests/test_browser_scene.py
python tests/test_browser_recording.py
```

Browser tests need Playwright and Chrome. Native/browser evidence is saved in
ignored `output/magenta-*` directories. Native tests render actual application
synth inputs, require deterministic controls, and verify that text, note, audio
reference, and captured-phrase changes affect real model output. Helper tests
measure inference-applied weight acknowledgments while audio encoding runs.
The default browser integration uses explicit pose/surface fixtures for
repeatable interaction assertions, genuine native MRT2, a fresh profile, and
blocked external browser requests. Endurance runs use real pose/depth inference;
without `--camera` their camera is a test pattern. Physical-camera acceptance
requires a person in view and a visible floor/table. Listening quality and ease
of real touch interaction still require a human judgment.

### Measured on 2026-10-14

On an M3 Ultra (32 CPU cores, 512 GB), Chrome 147.0.7727.56, 640×480 camera,
full pose model, hands off, and Auto selecting Base:

| Gate | Result |
| --- | --- |
| Ten-minute physical-camera run | Passed; Base remained ready for all 600 samples. |
| Pose throughput | 29.37 fps average / 30.5 fps baseline = **96.3%** (target ≥85%). |
| Native / playback underruns | **0 / 0**. |
| Applied spatial controls | 6,612 acknowledgments; 47.5 ms p95, **71.8 ms maximum** (target <500 ms). |
| Rolling reference preparation | **28.7–31.8 s** under the camera workload; measured separately from weight updates. |
| Native phrase preparation | **2.5–2.6 s** in the deterministic probe; **2.7–2.8 s** through the browser. |
| Small streaming gate | 2,400 PCM blocks / 48 s, no underruns; weight application ≤44.6 ms during audio encoding. |

The physical run contained 384 one-second samples with valid body tracking and
also exercised loss/recovery, rescanning, and fewer placements. Evidence is in
`output/magenta-native-gate/endurance-base.json`. The initial endurance attempt
exposed blocking reference resampling; moving it off the delivery thread removed
those gaps in the repeat run. Browser transport credit and a smaller playback
ring additionally bound stalled-consumer memory and latency.

Native conditioning comparisons, browser integration, existing scene/percussion
tests, and recording/microphone regressions pass. The decoded Magenta recording
contains stereo 48 kHz audio, readable mirrored labels, and schema-v1 metadata
for both button and confirmed body-touch continuation. Body-touch assertions use
controlled foreground/hip samples with genuine original synth audio and native
continuation. Human listening quality and physical-touch ease remain unverified;
no alternate generator or simulated embedding is used to satisfy those gates.
The final integration also withholds playback acknowledgments to verify the
five-block transport bound and recovery, restarts the camera source, and sends
an invalid native note to confirm actual helper failure, Base-to-Small fallback,
and original-only listening if Small fails as well.
