# Mac launcher build and release

`Dance2Music.swift` owns a directory-based PyInstaller backend and one local
server at `127.0.0.1:5092`. The backend receives explicit resource/state/log
locations, reserves the port before setup, and reports JSON lines on stdout.
Diagnostics use stderr. The backend process group and the native parent
watchdog prevent workers surviving a launcher or server failure.

The distribution contains `Contents/MacOS/Dance2Music`,
`Contents/Helpers/backend/` (frozen backend executable),
`Contents/Frameworks/backend/` (Python and extension libraries),
`Contents/Helpers/mrt2/` (native helper and dylib closure if needed), and
`Contents/Resources/` (Python data/certificates, `mlx.metallib`, website, lock
manifests, notices, and signed-binary integrity records). Relative symlinks
preserve PyInstaller's directory layout and colocated Metal lookup while keeping
data outside macOS code directories. No models, Chromium, compiler, or source
build tree ships.
Setup writes only to Application Support and Logs. Receipts contain relative
asset names and catalog hashes, so upgrades and relocation preserve downloads.

## Build

Use Apple Silicon and the exact Xcode and Metal compiler versions in
`toolchain.json` (Metal build `17F109`, compiler `32023.883`). Install that
component with `xcodebuild -downloadComponent MetalToolchain -buildVersion 17F109`.
Bootstrap using Python 3.11.8+; it verifies and extracts
the pinned portable Python distribution and installs hash-locked build tools:

```sh
python3 packaging/macos/bootstrap.py
export PATH="$PWD/.packaging/build-venv/bin:$PATH"
python packaging/macos/build.py --version 0.1.0 --output .packaging/build-0.1.0
```

The output directory must be new. Native dependencies are built in
`.packaging/native` using `native/magenta/manifest.lock.json`. The script checks
arm64, deployment versions, and Mach-O load paths; rewrites native libraries
to colocated paths; bundles licenses; signs nested code before writing its
hashes; then signs/verifies the outer app. Without `D2M_SIGN_IDENTITY` this uses
ad hoc signatures for development and is **not a distributable release**.
Only these local builds omit hardened runtime: ad hoc signatures have no Team
ID for library validation. Developer ID builds enable hardened runtime on all
executables and libraries without disabling library validation.
The portable Python archive is verified against the upstream release checksum
recorded in `toolchain.json`; its deployment target is macOS 11. Homebrew Python
may require a newer macOS than the app supports and must not be substituted.
All dependencies and tool versions are pinned; Apple signing timestamps and
notarization mean release artifacts are not expected to be byte-identical.

The MediaPipe lock is regenerated only deliberately with
`python packaging/macos/pin_browser_assets.py`. Model URLs use version 1,
never `latest`. Scene, piano, and native model manifests are shared with the
developer workflow. The packaged server enforces a same-origin content policy
that blocks session-time CDN fallback, including requests from workers.

## Signing and publishing

For a local release, create **Developer ID Application** in Xcode's account
settings under **Manage Certificates**. Keep its private key in your Mac's
keychain. Set `D2M_SIGN_IDENTITY` to that certificate's full name. If the shell
cannot see the default keychain search list, pass `--keychain` to `build.py`
and `notarize.py`, or set `D2M_SIGN_KEYCHAIN` to the login keychain path.
The scripts let Apple's signing/authentication tools use the OS account's home
lookup, so an agent's redirected HOME does not hide an otherwise valid identity.

Run `configure-notarization.command` in your own Terminal to configure the
`Dance2Music` notarization profile. It prompts for Apple account email, team ID,
and an app-specific password, validates with Apple, and stores the credentials
in the login keychain. The password is not placed in shell history or files.
Pass `--notary-keychain ~/Library/Keychains/login.keychain-db` to `notarize.py`
when using this local profile. Exporting the signing private key or configuring
GitHub secrets is unnecessary for a local build.

To finish signing while deferring notarization, use the already signed app:

```sh
python packaging/macos/notarize.py \
  --app .packaging/build-0.1.0/Dance2Music.app --version 0.1.0 \
  --output .packaging/signed-installers-0.1.0 --sign-only
```

This creates a signed DMG and checksums without submitting anything to Apple.
Its release manifest records `notarized: false`, so it cannot enable the public
download link. When ready to notarize, run the same command without `--sign-only`
and with a new output directory, adding the local keychain options if needed.

For builds on GitHub Actions instead:

Create a GitHub environment named `macos-release` with these secrets:

| Secret | Value |
| --- | --- |
| `D2M_SIGN_IDENTITY` | Full `Developer ID Application: … (TEAMID)` identity |
| `D2M_CERTIFICATE_P12_BASE64` | Base64 of the exported certificate and private key |
| `D2M_CERTIFICATE_PASSWORD` | Export password |
| `D2M_NOTARY_KEY_P8_BASE64` | Base64 App Store Connect API private key |
| `D2M_NOTARY_KEY_ID` | API key ID |
| `D2M_NOTARY_ISSUER` | API issuer ID |

Run **Mac launcher release** manually with `major.minor.patch`. The pinned
Xcode must exist on the selected macOS ARM runner; the build fails explicitly
if it is absent. The workflow downloads the pinned Metal component and the
builder checks its exact identity. Signing credentials use an ephemeral keychain
and are removed even on failure. Never commit credentials or keychain files.

The default creates a **draft release**. Download and exercise that exact
installer on a clean machine before publishing it. With the publish input,
the workflow publishes only after both app and DMG notarization, stapling,
signature verification, Gatekeeper checks, and the strict `<2 GiB` size gate
pass. Versioned DMGs, SHA256SUMS, and a release manifest go to GitHub Releases.
For a draft that you publish later, run the Pages workflow to refresh the link.

`release_link.py` enables the website link only when the release is public,
non-prerelease, notarized according to its generated record, and its exact
filename/size/checksum match both SHA256SUMS and GitHub's uploaded-asset digest.
No generic download link is enabled before this gate succeeds.

Apple's [notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)
and [PyInstaller signing notes](https://pyinstaller.org/en/stable/feature-notes.html#macos-binary-code-signing)
describe the signing steps. GitHub documents the
[2 GiB per-file release limit](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases).

## Verification and release acceptance

Automated checks (browser tests need Playwright and installed Chrome):

```sh
python -m unittest discover -s tests -p 'test_*assets.py'
python -m unittest discover -s tests -p 'test_magenta_runtime.py'
python -m unittest discover -s tests -p 'test_magenta_install.py'
python -m unittest discover -s tests -p 'test_release_link.py'
python -m unittest discover -s tests -p 'test_packaged_backend.py'
python tests/test_browser_launcher.py
python tests/test_browser_scene.py
python tests/test_browser_piano.py
python tests/test_browser_recording.py
```

Against a running packaged app (external browser requests are blocked):

```sh
python tests/test_browser_magenta.py --origin http://127.0.0.1:5092
python tests/test_browser_magenta.py --origin http://127.0.0.1:5092 --live-seconds 600 --camera
```

`tests/test_packaged_app.py --app … --state …` checks signatures, relocates an
assembled app, starts its frozen backend with a system-only executable search
path and blocked upstream downloads, then runs the browser integration. Supply
an independent verified `magenta/` and `browser/` asset tree. Add
`--live-seconds 600 --camera` for physical-camera acceptance.
Use `--browser-assets` for real pose/gesture/scene inference and the piano and
recording suite against the same packaged server, with external requests blocked.
`tests/test_native_shutdown.py --helper … --assets …` kills a parent during real
audio generation and requires the native worker to exit promptly.

Before declaring a release accepted, record results for the following on a
clean Apple Silicon macOS 14+ machine without Python, Homebrew, Xcode, or a
checkout. Automated development-machine checks do not substitute for these:

* Download the quarantined DMG; verify Gatekeeper and stapled signatures; move
  the app to Applications; complete first setup; Chrome opens once.
* Generate actual audio with both Base and Small. Exercise Auto, camera plus
  Magenta, hand tracking, scene processing, Floor Piano, and recording after
  disabling networking. Confirm model and browser settings survive relaunch.
* Interrupt a download, Quit during setup/generation, kill the launcher and
  server, corrupt a model/browser file, exhaust available disk space, remove
  Chrome, occupy port 5092, and launch a second copy. Confirm clear failures,
  no orphan workers, and reuse of verified completed files on Retry.
* Relocate the whole app; replace it with an upgrade; verify unchanged assets
  are retained and corrupt/changed assets require repair before readiness.
* Check iPhone, Android phone/tablet, desktop-mode iPadOS, public desktop
  guidance, and supported local availability, including saved selections.

Do not claim clean-machine, quarantine, notarization, physical-camera, or
listening acceptance based solely on an ad hoc local build.

### Development-machine results — 2026-10-19

The app was built and exercised on an Apple M3 Ultra, macOS 26.6.2, with
Chrome 147.0.7727.56. Initial coverage used ad hoc signing; the Developer ID
checks below used the final signed build. This verifies the packaged runtime
on this host; macOS 14 and clean-machine installation still need the release
acceptance run above.

* 25 setup, asset, runtime, installation, release-link, and process-lifecycle
  tests passed. Seven Chrome device/availability cases passed, including
  desktop-mode iPadOS and invalid saved selections.
* Native conditioning and Base streaming gates passed, as did parent-death
  cleanup during real audio generation. Existing scene, piano, and recording
  browser suites passed.
* The app passed strict signature verification before and after relocation.
  Its frozen backend started with only system executables on PATH and blocked
  upstream downloads. Packaged Magenta integration passed recording, source
  restart, real helper failure, Auto fallback, and repeated stop/cancel.
* Packaged offline pose/gesture inference, real scene models, piano samples,
  recording, and help/math rendering passed. The scene pass measured 20.1 pose
  frames/sec against a 20.0 baseline using a test-pattern camera.
* A 60-second physical-camera/Base run detected a person, completed body-audio
  conditioning, and averaged 29.09 pose frames/sec against a 29.5 baseline.
  Native and playback underruns were both zero; control latency was 44.4 ms
  at p95 and 61.1 ms maximum. This is an automated camera run, not listening
  acceptance or the longer clean-machine soak test.
* A real HTTPS repair through the frozen backend replaced one missing small
  asset, verified its checksum, and reused every other installed asset.
* Mach-O audits found only arm64 code, deployment targets at or below macOS 14,
  and no developer-machine library load paths. The app occupies about 149 MB.
* The final Developer ID app passed strict signature checks, relocation, and
  frozen-backend startup with hardened runtime and library validation enabled.
  Its offline Magenta browser integration passed with real Small and Base
  generation, recording, real helper failure/Auto fallback, repeated stop/cancel,
  and packaged server shutdown.
* The Developer ID-signed DMG is 59,235,251 bytes (about 59 MB); its checksum
  matches the generated manifest and SHA256SUMS. It passed disk-image checksum
  verification and mounted read-only with a valid signed app and Applications
  shortcut. Notarization was deferred for that installer and its manifest records
  `notarized: false`.

### Notarization results — 2026-10-21

Apple accepted both the app and the final DMG with no reported issues:

* App submission: `21195c15-f3cb-419c-a012-c3c3563204a3`.
* DMG submission: `4c4f80d4-5450-4c81-b093-be84fe35c746`.
* Tickets were stapled to both artifacts and validated. Both passed Gatekeeper
  assessment as `Notarized Developer ID` and strict signature verification.
* The DMG mounted read-only. Its contained app passed ticket validation,
  signature and binary-integrity checks, and offline frozen-backend asset
  verification using the prepared test asset tree.
* The final DMG is 59,344,061 bytes, with SHA-256
  `b0dabf6b8dc0b180b5af5c028324e4914488661ba1fcf89d1af0847cbde42f22`.
  It is saved under `.packaging/notarized-installers-0.1.0/`, alongside
  checksums, Apple's reports, and a manifest recording `notarized: true`.

No public release was published. Installation of a quarantined download on a
clean Mac, macOS 14 runtime acceptance, and the longer listening/soak checks
remain outstanding. These local notarization checks do not replace that
acceptance testing before enabling the public download link.
