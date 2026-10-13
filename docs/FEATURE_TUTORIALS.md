# Feature Tutorials

The browser translation is now available locally:

- [Play the instrument in JavaScript](#play-anthonys-instrument-in-the-browser)
- [Use the iPhone camera and sound with --phone](#iphone-camera-and-sound)

Start here for the current native Python instrument:

- [Change roots: interval map, octaves and T mode switch](#relative-roots-and-switching-modes)
- [Transfer the ball from palm to fist](#transfer-the-ball-to-one-hand)
- [Split and merge the ball](#1--control-and-split-the-ball)
- [Lock a root](#0--lock-a-chord-root)
- [Choose chord qualities](#2--choose-roots-and-chord-qualities)
- [Run on macOS](#native-instrument-on-macos)

## Repository layout and moved commands

Run all commands from the repository root. Guides and ideas live in `docs/`;
feature specifications and evidence remain in `specs/`. The original pipeline
commands and `python -m instrument` keep their existing entry points.

The additional dependency files and model helper moved on 2026-10-05:

| Previous path | Current path or command |
| --- | --- |
| `requirements-dev.txt` | `requirements/dev.txt` |
| `requirements-instrument.txt` | `requirements/instrument.txt` |
| `requirements-instrument-lock.txt` | `requirements/instrument-lock.txt` (tested Windows environment) |
| `python scripts/setup_instrument_models.py` | `python -m instrument.setup_models` |

After activating your environment, install development tools with
`python -m pip install -r requirements/dev.txt`. For native instrument runtime
dependencies use `requirements/instrument.txt`. Model setup remains explicit;
`python -m instrument.setup_models --directory output/models` downloads and verifies
the models, and `--help` shows its options without downloading anything.

## Native instrument on macOS

From the repository root, use `.venv/bin/python` (Windows uses `.venv/Scripts/python.exe`):

```bash
.venv/bin/python -m pip install -r requirements/instrument.txt -r requirements/dev.txt
.venv/bin/python -m instrument.setup_models
.venv/bin/python -m instrument --model-smoke
.venv/bin/python -m instrument --camera 0
```

Model setup downloads and verifies both files in `output/models`; it is needed once
before camera mode. The macOS runtime requirements select MediaPipe 1.1.0, validated
with Python 3.11.17; 1.0.1 aborted during model initialization on this Mac.
For a scripted demo use `--demo` instead of `--camera 0`. Press Q or Escape to quit.
Restart after updates to see the larger chord, root and gesture labels with dark
outlines and shadows. Controls occupy a 450-pixel panel above the full camera frame.
At the very top, **LEFT HAND** and **RIGHT HAND** show each confirmed gesture in
large text. The smaller **Seeing:** line shows the current model label and confidence;
it can differ while recognition waits for a stable gesture. **UNKNOWN** means no
gesture is confirmed, **Wrist only; no gesture** means body tracking has no hand
details, and **NOT SEEN** means that hand is absent. Readouts follow corrected hand
identities even when the hands cross.

## Relative roots and switching modes

**The root changes are implemented in the native Python instrument.** The default
is **INTERVAL**: each hand's position selects a signed change from the current root.
**T** switches to the original **MIDPOINT** root ring and back. Restart the instrument
after updates, focus its window, and check the top panel says **ROOT: INTERVAL**.

```bash
.venv/bin/python -m instrument --camera 0 --root-mode interval
```

### First try: C → G → D

1. Press **R** to reset to C3, unlocked. Use open palms or your chosen quality signs;
   avoid fists while choosing intervals because they perform ball/lock actions.
2. Put each wrist inside its own **L CENTER / R CENTER** circle, around chest height,
   and hold **both** there for **0.20 seconds**. Wait for **READY — MOVE BOTH HANDS**.
3. Move the **left hand left** from its circle and the **right hand up** from its
   circle. Hold both directions for **0.35 seconds**. The root becomes **G3** (+7).
4. Return **both** wrists to center for 0.20s. Repeat the same pair: G3 becomes
   **D4** (+7 again). Every change uses the current root, so the moves accumulate.
5. Center again, then move **both hands up** for an octave up, or **both hands down**
   for an octave down. These shift the sounding notes by exactly 12 semitones.

Use the **LEFT HAND / RIGHT HAND** readouts for hand identity. Movement directions
follow the mirrored camera image and are measured from each hand's own center;
crossing your hands does not swap their identities. Move clearly along one axis:
diagonal positions are ambiguous. The top panel shows the recognized directions,
signed interval, target note and hold progress.

### Complete relative root map

Rows are the **left hand's position**; columns are the **right hand's position**.
Numbers are semitones from the current root. These are position directions,
independent of the finger-sign table used for chord qualities below.

| Left hand / Right hand | Left | Right | Up | Down |
| --- | --- | --- | --- | --- |
| Left | Fourth down **−5** | Fourth up **+5** | Fifth up **+7** | Fifth down **−7** |
| Right | Whole step down **−2** | Whole step up **+2** | Half step up **+1** | Half step down **−1** |
| Up | Minor third down **−3** | Minor third up **+3** | Octave up **+12** | Tritone down **−6** |
| Down | Major third down **−4** | Major third up **+4** | Tritone up **+6** | Octave down **−12** |

From C, +1 through +6 reach C#, D, Eb, E, F, F#; −1 through −6 reach B, Bb, A,
Ab, G, F#. C plus these changes covers **all 12 root notes**. For example, left
hand right + right hand down takes **C3 → B2** (−1), crossing into the lower octave.
A fifth up (+7) and fourth down (−5) share a note name one octave apart; a fifth
down (−7) reaches a different note name.

### Repeating, switching and recovery

- Return **both** hands to center before every interval. Holding a pair, or moving
  directly to a different pair, never repeats a change. One-hand ball ownership
  does not change this: interval controls still need both wrists.
- Root lock freezes root and octave in both modes; quality remains editable.
  Fist + non-palm or two distant fists toggles lock. **Fist + palm transfers to the fist.**
- Missing wrists/body points, fist controls or tracking gaps cancel pending
  intervals. Return to center after recovery. A register-limit warning refuses
  the change; center and choose an interval toward the playable range.
- **T** preserves root/register/quality/lock and ball ownership. In **MIDPOINT**,
  move the hands' midpoint to a labeled sector and hold 0.35s. Press T again for
  intervals, then center both hands to rearm. To start with the ring directly,
  use `--root-mode midpoint`.
- **R** resets chord/register/lock/ball while retaining the active root mode.
  Old replay files without mode metadata use midpoint root selection; old fist+palm
  lock recordings now use the current transfer behavior.

The [design reference](../specs/001-anthony-instrument/relative-root.md) records
zone thresholds, register bounds and replay details. The automated checks cover
all 16 pairs at every root, all 300 chords, signed/octave sound changes and recovery.
Live camera recognition and performer comfort still need a trial.

**Split/merge:** reopen to arm, then close both fists within **1.0 torso length**
(previously 0.6). From midpoint this splits; from split or owned mode it merges to
midpoint. Hold until recognized; reopen before repeating. Fists farther apart toggle root lock.
If a custom `--config` supplies `split_torsos`, it overrides this new default.

## Spec Kit on macOS and Windows

Invoke the same `$speckit-constitution`, `$speckit-plan`, `$speckit-tasks`, and other
Spec Kit skills on either platform. The shared skills select the official Bash helpers on
macOS/Linux and PowerShell helpers on Windows. macOS does not require PowerShell.

Both use `.specify/memory/constitution.md`, the templates under `.specify/templates/`,
and feature documents under `specs/`. Both helper sets were copied unchanged from the
installed `specify-cli` 1.1.0 bundle, keeping their logic at the same upstream version.
Do not maintain separate Mac and Windows copies of these documents.

The current feature is selected locally in ignored `.specify/feature.json`. This checkout
selects `specs/001-anthony-instrument`. Use repository-relative paths with forward slashes
for portability. Each checkout keeps its own selection while sharing feature documents.
The `script: ps` initialization metadata records how this project was originally installed;
the shared skills choose the native shell at execution time.

When upgrading Spec Kit, refresh both official helper sets together and preserve the skills'
platform selection and project amendments. Run `python -m unittest tests.test_speckit_scripts`
to check the helpers available on that machine. Preset-composition checks also need PyYAML,
which is included in the Specify CLI's own environment.

## Python environment on macOS

From the repository root, using Python 3.11:

```sh
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m pip check
```

Activate with `source .venv/bin/activate` in each new terminal; use `deactivate`
to leave the environment. On macOS, use `.venv/bin/python` in place of the
Windows `.venv/Scripts/python.exe` commands below. The native instrument's
separate requirements and model setup are documented in the quickstart.

## Start the Python instrument

Run from the repository root:

```powershell
.venv/Scripts/python.exe -m instrument --camera 0
# Scripted demo:
.venv/Scripts/python.exe -m instrument --demo
```

Keep shoulders, hips and both hands visible. Open your hands for at least
about 0.60 seconds before using fist controls (recognition plus rearming).
Add `--mute` to disable sound.
Whole-body joints are drawn, including visible legs and feet. The ball uses body
wrists even when palms face sideways. Detailed hand recognition uses wrist crops
for smaller hands; missing hand details do not hide a ball supported by body wrists.
Add `--volume 0.5` to halve playback and exported WAV volume.
Restart after code changes. Resize/maximize the native window to see the complete
camera frame; the controls are above the image. Camera mode requests 1280x720.
Use --camera-width / --camera-height to request another supported device mode.
Hand diagnostic text and root notes use larger, light lettering with a dark
outline and shadow so they remain readable against the camera image and ball glow.
Fresh-machine setup: [quickstart](../specs/001-anthony-instrument/quickstart.md).

## 0 — Lock a chord root

1. Select a root with interval controls above, or press T to use the ring. Keep your hands apart.
2. Close either fist while the other hand shows a non-palm sign (such as Point),
   or close both fists while apart. Hold about **0.60 seconds** to lock the root.
   The display confirms **ROOT LOCKED**; it stays visible when you reopen.
   Detection matches web/main's **far** mode: alternating wrist crops, a 0.5
   confidence threshold, and 0.35 seconds to confirm label changes. The first line
   under a hand is the confirmed gesture; **raw** below shows the classifier result.
   Brief raw None/fist alternation retains the last confirmed label. A new fist
   must first be consistently recognized for 0.35s. Joint shape does not override
   None. Missing detections are tolerated for 0.4s, then gesture actions cancel.
3. Reopen. Move freely or change chord quality; the root stays locked.
4. Repeat that fist/non-palm or distant two-fist gesture to unlock. Reopen between toggles.

Nearby two fists split/merge instead of root lock; fist + palm transfers the ball.

## 1 — Control and split the ball

- Move both hands: the ball follows their midpoint.
- Spread your hands: the ball grows and sound gets louder.
- Start with open hands for about **0.60 seconds**, then close both fists and
  bring them together. Keep wrist spacing within 1.0 times your shoulder-to-hip
  distance. Both fists must be confirmed for **0.35 seconds**; they can be
  recognized while apart and brought together afterward, even after root locking.
  The top panel confirms **TWO BALLS**. Spread your hands to see them clearly.
- Reopen: the two balls stay attached to your hands and share the chord.
- Repeat the same nearby two-fist gesture to **merge into one ball**. Reopen
  between gestures; holding fists produces only one change. The panel confirms
  **ONE BALL** after merging. Both directions preserve the chord and root lock.
- Press **M** to return to the midpoint; reopen before another split or transfer.
  **S** switches fire/light appearance.

### Transfer the ball to one hand

1. Reopen to arm. Close one fist while the other hand shows **Open Palm**.
   Hold about **0.60 seconds** (0.35s confirmed closure + 0.25s arbitration).
   The ball transfers **from the palm to the closed fist**; the panel shows
   **ONE BALL: LEFT/RIGHT HAND** for the fist hand.
2. Relax or move the owning hand: the ball stays attached to its wrist. Size and
   loudness are captured at transfer; changing the other hand's distance has no
   effect. Radius follows torso scale if you move toward/away from the camera.
   The other wrist can leave view. Missing owning wrist or torso hides/mutes the
   ball; tracking recovery restores it without changing ownership.
3. Reopen, then reverse fist/palm to transfer to the other fist hand. This also collects
   two split balls into that fist. Transfer preserves root lock and chord;
   normal root/quality controls remain available afterward.
4. To return to the midpoint, **close both fists and bring them within 1.0 torso
   length**. This is the same merge gesture used for split balls. Held fists merge
   once; reopen before the next action. From midpoint, the next nearby two-fist
   closure splits into two balls. **M** also returns to midpoint; **R** resets.

Both labels must be reliable. If the pair changes or tracking drops during
arbitration, transfer cancels; reopen before retrying. Nearby fists take priority
over a pending transfer. Fist + palm does **not** toggle root lock.

### Collect energy from split balls

Start in **TWO BALLS**, then reopen to arm. Keep the donating hand an **open palm**
and close the receiving hand into a **fist**. Hold about 0.60s: the palm's ball
disappears and the fist's ball grows to contain both. The HUD changes to
**ONE BALL: LEFT/RIGHT HAND**. This works in either direction.

The balls' **visible areas add**, conserving their combined energy. The new radius
is `sqrt(receiver_radius² + donor_radius²)`: two radius-40 balls become one of
radius about **57**. Two equal balls produce a receiver about **1.41×** their
individual radius. Their existing shared loudness stays the same.

Size and loudness are captured once at transfer; continuing to hold the pair
does not repeatedly grow the ball. Reopen before another action. Both nearby
closed fists return the collected ball to midpoint, using the same merge control.

## 2 — Choose roots and chord qualities

The default is [relative interval control](#relative-roots-and-switching-modes).
Press **T** for midpoint mode: move the midpoint toward a labeled root and hold **0.35 seconds**.
C is on the right; the 12 roots run clockwise. The central circle holds your root.

Use both hands to select a cell; hold the pair for **0.35 seconds** after recognition.
Rows are your **right** hand, columns your **left** hand. Examples use root C:

| Right / Left | Open palm | Point | V | Thumb up | Thumb down |
| --- | --- | --- | --- | --- | --- |
| Open palm | C | Cm6 | Cm7b5 | C6 | C6/9 |
| Point | Cm | Cm11 | Cm9 | Cm13 | Cm6/9 |
| V | Cdim7 | C7b9 | Caug | C7#9 | C7sus4 |
| Thumb up | Cmaj7 | Cmaj9 | Cmaj7#11 | Cmaj13 | Cm(maj7) |
| Thumb down | Cm7 | C9 | Csus4 | C7 | C13 |

**Point:** index pointing up, middle/ring/little fingers curled, thumb tucked.
**V:** Victory sign. Hand identity follows your body, including when hands cross;
the labels **L/R** do not mean the left/right side of the screen. The live pose-side
assignments were swapped on 2026-10-12 at Anthony's request to correct reversed
controls in his mirrored view. Restart camera mode for the corrected labels and
chord combinations. Existing replay files keep their recorded hand identities.
Camera recognition also needs about 0.35 seconds of a stable sign before the pair dwell begins.

Both recognized non-fist signs are required. Missing, uncertain, low-confidence or
heart/love signs hold the quality; fists retain ball/lock controls. Brief reopening
holds the quality; **both open palms held 1.5 seconds** select major. Quality remains
editable while the root is locked. Root controls work independently when unlocked.

The catalogue contains **25 qualities × 12 roots = 300 selectable chords**. Extended
chords use five or six notes; thirteenths include ninths and omit the natural eleventh.
Compared with the earlier shortcuts, left Point with right palm now selects m6,
left thumb up selects 6, left thumb down selects 6/9, and both V signs select augmented.
See the [approved map and tone sets](../specs/001-anthony-instrument/chord-map.md).

## Save, replay or use video

```powershell
# Save observations, states, preview video, WAV and images:
.venv/Scripts/python.exe -m instrument --camera 0 --output output/instrument-session
# Replay those observations:
.venv/Scripts/python.exe -m instrument --replay output/instrument-session/frames.jsonl
# Track an existing video (replace the path):
.venv/Scripts/python.exe -m instrument --video videos/example.mp4
```

## Reset or quit

**R:** reset to C major, unlocked, one ball. **Q / Escape:** quit.
Body/wrist loss mutes sound; hand-detail loss preserves the body-driven ball and
audio. Reopen your hands after gesture tracking returns before another fist toggle.

## Play Anthony's instrument in the browser

```powershell
.venv/Scripts/python.exe live.py
```

Choose **Anthony instrument · 300 chords** in Harmony, then Start. New browser
sessions default to it; an existing saved harmony mode is preserved. Hand tracking
defaults to **far**, cropping each body wrist in alternating frames. For an
instrument close to the camera, **near** is also available. Both detailed signs
must be reliable to choose a chord quality; **None**, missing signs, fists and
heart signs hold the current quality. Both palms held for 1.5 seconds return to
major. Use the on-page chord chart or the [approved map](../specs/001-anthony-instrument/chord-map.md).

The browser preserves the native controls:

- **Fist + palm:** transfer the ball to the fist, retaining its size and loudness.
  The owning body wrist can continue controlling it when the other wrist disappears.
- **Fist + another sign, or two distant fists:** toggle root-only lock; chord
  quality remains editable. Held fists act once; reopen before repeating.
- **Two nearby fists:** toggle split/merge, or return an owned ball to midpoint.
  This takes priority over root lock. Proximity is 1.0 torso length.
- **Relative intervals:** center both wrists in the marked chest circles for
  0.2 seconds, then hold a cardinal direction pair for 0.35 seconds. Each step
  applies once; return to center before another. Both up/down moves a real octave.
  Consult the [interval map](../specs/001-anthony-instrument/relative-root.md).
- **Root control selector / T:** switch to the 12-sector midpoint ring or back
  without changing the current chord, register, ball ownership or lock.
- **Merge ball / M:** return to midpoint. **Reset / R:** C major, unlocked, merged.
  These buttons work on touch screens. Space starts/stops on a keyboard.

The ball uses body wrists, so finger-detail loss alone does not stop it. Missing
required body/wrist tracking silences sound; persistent chord/lock/ownership
survives recovery. Instrument L/R uses the same corrected joint identities as
Python, including crossed hands, independent of whether the preview is mirrored.

Choose **native instrument** for the sine-plus-harmonic tone. All existing web
timbres now support three through six chord notes. Instrument loudness follows
the ball's size or captured transfer gain. The Mix pad/master faders still apply;
instrument mode keeps the pad sounding while a ball is active. Legacy harmony,
mapping, drum and gesture-action modes remain available in the Harmony selector.
In instrument mode, signs control chords/balls rather than legacy drum/preset actions.

Record still exports a ZIP containing video/sound, pose/hand observations and
configuration history, now including instrument state. Microphone recording
remains an explicit separate option. Use the Record button in instrument mode
because R is its reset shortcut. Existing microphone/bundle behavior comes from main.

## iPhone camera and sound

```powershell
.venv/Scripts/python.exe live.py --phone
```

Use **Safari**, with the iPhone and laptop on the same Wi-Fi. The command prints
an HTTP setup URL (default port 5093) and an HTTPS instrument URL (port 5092).
Open the **setup URL on the iPhone** first. Follow its one-time steps:

1. Download the local certificate profile.
2. In Settings → General → VPN & Device Management, install
   **dance2music local phone camera**.
3. In Settings → General → About → Certificate Trust Settings, enable full trust
   for **dance2music local phone CA**.
4. Return to Safari and open the HTTPS instrument link. Tap Start and allow the
   camera. If needed, tap **Tap for sound**.

This trust step is required for Safari camera access; bypassing a certificate
warning is not a substitute. See [Apple's certificate trust instructions](https://support.apple.com/en-us/102390)
and [browser camera security requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).
No system trust stores are changed by the CLI. Remove the profile from the
iPhone when it is no longer needed. Certificates/keys stay under ignored
`output/phone/`; the setup server only exposes the public certificate profile.

OpenSSL 3.x must be on the laptop's PATH (**3.4.0 tested on this Windows machine**).
Ordinary localhost mode needs no OpenSSL. On this machine it is already available
through MSYS2; on another machine use its package manager, e.g. `brew install
openssl@3` on macOS or `sudo apt install openssl` on Debian/Ubuntu. The command
reports an actionable error if OpenSSL or a listener is unavailable.

Phone mode prefers the **rear camera**, **lite** pose model and **640×480 at a
requested 30 fps**. Front/rear switching is in Camera. Tracking and synthesis run
on the iPhone; the laptop only serves files. There is no video stream back to the
laptop, MIDI or Ableton integration in this port. Use the phone speaker or wired
audio for latency testing. Keep Safari visible; backgrounding releases sound,
and returning may require another sound tap. iPhone inference and audible latency
still require a real-device trial. The displayed audio latency is a browser
estimate, not measured movement-to-sound latency. Gesture confirmation/dwell
times deliberately match the native instrument.

If the auto-detected address uses a VPN/other adapter, specify the laptop's Wi-Fi IP:

```powershell
.venv/Scripts/python.exe live.py --phone --phone-host 192.168.1.50
# Custom listener ports:
.venv/Scripts/python.exe live.py --phone --port 5100 --setup-port 5101
```

Allow those local TCP ports through the laptop firewall if prompted. Restart
after a Wi-Fi IP change; the server reissues its leaf certificate under the same
local CA, so the iPhone trust step need not repeat. Ctrl+C closes both servers.
For a venue without internet, run `live.py --offline` beforehand; it now downloads
the hand model as well as pose/WASM assets. The ordinary camera command stays local
to `127.0.0.1` unless `--phone` is supplied.

### Web-port validation commands

```powershell
# Device-free native -> JavaScript fixtures, then JS parity/audio checks (Node 24 tested):
.venv/Scripts/python.exe tests/web/generate_reference.py
node --test tests/web/instrument.test.mjs tests/web/audio.test.mjs
# Python HTTPS/CLI tests:
.venv/Scripts/python.exe -m pytest tests/test_phone_server.py -q
.venv/Scripts/python.exe -m ruff check live.py web/phone_server.py tests/test_phone_server.py tests/web/generate_reference.py
.venv/Scripts/python.exe -m ruff format --check live.py web/phone_server.py tests/test_phone_server.py tests/web/generate_reference.py
.venv/Scripts/python.exe -m mypy --explicit-package-bases live.py web/phone_server.py tests/web/generate_reference.py
```

`tests/web/browser-smoke.cjs` uses Playwright **1.62.1** and Chromium, a synthetic
camera/model and real browser media APIs. Set `NODE_PATH` to an existing Playwright
installation, or install it under ignored `output/web-port/browser-tools` with
`npm install --prefix output/web-port/browser-tools playwright@1.62.1`, then set
`NODE_PATH` to that folder's `node_modules`. Install Chromium with Playwright's
CLI, and run `node tests/web/browser-smoke.cjs`. Set `PLAYWRIGHT_BROWSERS_PATH` if
using a custom browser cache. It saves screenshots/results under `output/web-port/`.
These checks do not establish real iPhone camera recognition or performance.
