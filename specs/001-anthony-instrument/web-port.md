# Authorized JavaScript translation, 2026-10-13

Anthony explicitly requested translating the implemented Python instrument into
the existing web app. Work remains on `anthony-explorations`, local only. Upstream
`origin/main` recording and iOS audio changes were merged locally at `83433fc`;
the approved constitution and Spec Kit helpers were retained.

## Contracts to preserve

- `instrument/controller.py`: persistent root-only lock, fist arbitration,
  reopening/gap rules, nearby split/merge, fist+palm one-hand ownership, area/gain
  conservation and silence when required body/wrist tracking is absent.
- `instrument/root_control.py`: default interval mode, all 16 ordered directions,
  neutral rearm, no held repeats, real octave transposition, register limits,
  midpoint ring alternative and mode changes preserving musical state.
- `instrument/harmony.py`: exact 25 ordered hand pairs, 12 roots, all chord tones,
  deterministic bounded voice leading, quality persistence, 1.5s both-palm reset.
- `instrument/tracking.py`: corrected L/R joint identities in the mirrored view,
  wrist-based ball geometry, canned labels with 350ms confirmation; no finger-shape
  fallback. Both label confirmation and original candidate time reach fist gates.
- Glowing fire/light balls, skeleton and fingers, visible lock/ownership/direction
  feedback, reset, merge and root-mode controls.

MIDI/Ableton was excluded from this initial translation. The subsequent explicit
[desktop MIDI request](desktop-midi.md) now authorizes that separate feature.
Unbuilt spells, games, true 3D and additional
finger modes remain deferred. Existing web harmony, mixer, mapping, drums,
ordinary video/audio recording remain available alongside the new mode.
Samir's raw-observation ZIP and separate microphone work was subsequently removed
at Anthony's request; it remains isolated on its upstream branch.

## Browser adaptation

Pure JavaScript controller/harmony/root modules sit beside `web/live/` modules.
The adapter transforms raw pose coordinates into the same mirrored pixel frame as
Python, independent of preview mirroring. Hand tracking uses the corresponding
body joints in instrument mode without changing legacy-mode assignments.
Tracking failure advances the controller with an empty frame; retained display
hands cannot supply a missing body wrist. Six persistent audio slots release
unused voices. The native tone is selectable; other web timbres also sound all
tones. Web Audio uses 60ms pitch and 30ms amplitude smoothing in instrument mode.

Anthony selected tracking and sound on the iPhone. `live.py --phone` serves local
HTTPS, creates/reuses a local certificate authority via OpenSSL, and presents a
local certificate-installation page on a separate HTTP port. Private keys stay
under ignored `output/phone/`, outside the served directory. iOS certificate
installation/full trust is a manual device step; no system trust stores are
modified automatically. Rear camera, lite model and modest capture resolution
are phone defaults. No video/control/audio transmission to the laptop is added.

The HTTPS wrapper is implemented and tested in Python before connecting the web
phone flow, satisfying principle X for the new server capability. The existing
validated native instrument provides Stage 1 for the explicit JS translation.

## Verification

- Native-generated replay fixtures: every output field and event sequence,
  300 catalogue chords and all 90,000 voice-leading transitions.
- Node tests: controller boundary/loss/rearm/quality/ownership behavior, pose
  adapter and hand identities, six audio slots and unused-voice release.
- Python tests: certificate chain/SAN/reuse, TLS and setup endpoints, private-key
  isolation, invalid CLI options and reliable shutdown. Ruff and mypy for Python.
- Browser checks: controls, mobile viewport, module loading, synthetic replay
  visuals, native-tone audio rendering and existing recording paths.
- Controller/voice-leading p95 budget: <5ms on synthetic desktop inputs. Camera,
  Safari inference speed and audible iPhone latency require a device trial and
  must be reported as unverified until observed.

No new root-level files or npm runtime dependencies are needed. Tests live under
`tests/web/`; phone-server helpers live with the web app. Instructions belong in
`docs/FEATURE_TUTORIALS.md`; final evidence and remaining acceptance go in
`status.md` and this feature's evidence document.
