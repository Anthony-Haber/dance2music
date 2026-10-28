# Project Status

## 2026-10-22 - Separate Bakarji Circles from Anthony Body turns

- Fixed: Anthony's turn transposition and diagnostics had also been enabled in
  Circles and Together. They now belong exclusively to Body turns. Switching
  studies restores original pitch and consumes disabled events without replay.
- Restored Bakarji's original shoulder-yaw spin signal independently of Anthony's
  torso-and-limb detector, including the original Circles/Together stereo pan.
  Circular-motion note patterns, reversals and wind-down retain their mappings.
  Updated feature instructions and browser cache versions.
- Verification: All 136 JavaScript tests pass, including regressions observed
  failing before the fix. Compared restored circle detection, shoulder-spin
  values and original events against Bakarji's imported implementation across
  1,070 synthetic frames in nine sequences: exact match. The real browser loop
  with synthetic video confirms Circles/Together hide body-turn controls and
  disable turn transposition, including turns made while Circles is selected;
  Body turns resumes its stored pitch without replay. No page errors.
- Local branch: codex/anthony-movement-dictionary. No push. Real Safari camera
  quality remains a manual check; browser validation used muted Chromium.

## 2026-10-19 - Change sustained choir pitch on body turns

- State: Implemented and verified locally on codex/anthony-movement-dictionary;
  main/ableton and separate browser settings preserved. No push/publication.
- Decisions: Anthony chose left up/right down one D-major scale step per
  confirmed 90° turn, transpose the sustained choir together, and continue
  through octaves. Chosen tonic range D3–D6 is shown with boundary messages.
- Changes: Device-free Python turn_pitch reference first; browser translation
  and integration afterward. Directional counter snapshots prevent duplicate,
  stale, invalid, skipped or unconfirmed events from stepping pitch. Half turns
  cannot double-trigger. Shift all four effective voices equally, retaining
  chord intervals and base voice leading. D4→E4→F♯4→G4→A4 on four left quarter
  turns; right reverses. Update real oscillator/bass frequencies with existing
  glides, a move swell, absolute chord labels and a prominent Turn tonic readout.
  Body turns/Circles/Together enable pitch stepping; other studies keep original
  pitch, consume disabled events and resume the stored offset on return.
  Tracking loss holds pitch. Reset turns/Start restores D4. Reaching the range
  limit holds pitch, displays the limit and recovers immediately on an inward
  turn without hidden accumulated steps. Added CSV pitch fields and tutorials.
- Verification: New Python tests initially fail without the reference; an actual
  choir regression failed before integration. All 56 focused Python pitch/spin
  cases pass (12 new pitch cases). JavaScript complete suite 134 passed,
  including live Python parity, actual detector→choir integration, uniform
  transposition, deduplication, recovery, study switching and oscillator targets.
  Pitch p95 about 0.001 ms against a 1 ms budget, excluding pose inference.
  Ruff lint/format, mypy all 15 instrument files and whitespace checks pass.
  Local AST graph refreshed: 2,215 nodes, 4,071 edges, 184 communities; no API cost.
- Browser: Fresh muted Chromium, synthetic video/model, real page/audio graph:
  E4 tonic and E3/B3/E4/G♯4 voices at 90°, F♯4 tonic at 180° (two changes), A4
  tonic at 360°, right turn returns G4. Actual soprano and bass oscillator
  frequencies converge to the expected values. Study disable/resume, reset to
  D4, face/pose loss, mirror, old-setting isolation and stream cleanup pass;
  zero page errors. Screenshot output/movement-dictionary/body-turns-browser.png
  inspected. No user camera, MIDI port or audible browser output used in tests.
- Remaining: Actual Safari performer detection accuracy and listening remain
  manual. A tonic walking D-major degrees transposes the whole chord; individual
  chord tones need not all belong to the original D-major scale. Refresh Safari
  to load versioned app/harmony/sound/view/pitch modules. Server remains on 5094.

## 2026-10-19 - Add 90-degree Movement Dictionary quarter turns

- State: Implemented on codex/anthony-movement-dictionary; remains local.
  Main/ableton and separate Anthony browser settings preserved.
- Request: Detect 90-degree turns as well as the existing 180-degree turns.
- Changes: Python reference first, then JavaScript parity. Add quarter counters,
  directional totals, 90-degree progress and spin_quarter events/CSV columns.
  At 90 degrees, projected limbs can overlap before an image-order swap, so
  require an initially aligned, fresh wrist or knee/ankle axis to rotate with
  the torso instead. Torso must still reach the full 90 degrees. Preserve the
  stricter image-order swap rule for half turns. Do not count crossed limbs,
  missing landmarks, implausible jumps, boundary jitter or unseen quarters.
  Reversal/gap handling and Reset turns cover both counters. UI uses quarters
  as the large counter, retains half totals, and versions module URLs for Safari.
- Verification: 11 new Python cases fail before implementation; all 44 detector
  cases pass afterward. JavaScript full suite 123 passed, including 1,089
  Python/browser parity observations, exact profile 90-degree event and CSV
  counts, plus retained half-turn/stereo/other experiment contracts. Detector
  p95 about 0.009 ms against the 5 ms budget, excluding pose inference. Ruff
  lint/format, mypy all 14 instrument files and whitespace checks pass.
- Browser: Fresh Chromium with synthetic camera/pose data confirms 1 quarter
  and 0 halves at 90 degrees, 2 quarters and 1 half at 180 degrees, 4 quarters
  and 2 halves at 360 degrees. Mirror, separate saved settings, reset, pose/face
  loss, cleanup and mobile-width checks pass with zero page errors. Screenshot
  output/movement-dictionary/body-turns-browser.png inspected. No performer
  camera/model download or MIDI messages used by the automated checks.
- Remaining: Real Safari performer accuracy/listening trials remain pending;
  estimated 3D depth and occlusion can still cause misses. Updated tutorial,
  experiment README and research contract explain the distinct confirmations.

## 2026-10-19 - Movement Dictionary body half-turn experiment

- State: Implemented and verified with synthetic inputs; real Safari camera
  accuracy/listening trials pending. Changes kept locally on the new branch
  `codex/anthony-movement-dictionary`, based on merge a318bd0 in Anthony's fork.
  No changes made to the main or ableton branch tips; no push/publication.
  Anthony's browser preferences use separate md:anthony: keys, preserving
  Joseph's md: settings on the same Safari origin. Isolation regression reproduced
  before the fix and passed in the real-page browser smoke test afterward.
- Decisions: Anthony chose combined torso plus hand/leg evidence, and counting
  each 180-degree half turn rather than only full 360-degree turns. Use existing
  pose face visibility as a supporting diagnostic, never proof of a body spin.
  No replacement models, face/hand inference pipeline or camera captures added.
- Changes: Device-free Python reference in instrument/body_spin.py first, then
  DOM-free browser translation. Fresh shoulders and hips must agree; a stable
  wrist or knee/ankle ordering swap corroborates each half turn. Profile overlap
  is unknown rather than a swap. Reject implausible jumps, reset partial progress
  across long gaps/reversals, retain counts through loss, and never extrapolate
  from the dictionary's retained coordinates. Face absence does not prevent the
  separate turn diagnostics. Body turns study shows large count, progress,
  direction, speed, tracking and limb evidence, plus Reset turns. Circles and
  Together share diagnostics. Measured phase replaces fixed-30fps stereo phase;
  loss/other studies center the spin pan. No new note/chord/MIDI mapping.
- Data/documentation: Keep old CSV fields and append turn count/progress,
  tracking, limb/face cues, status and direction counts. One spin event per
  counted half turn when a dictionary measurement frame is available. Tutorial,
  experiment README and spin-research.md record accepted choices, thresholds,
  primary research sources, commands, field migration and remaining limitations.
  Added files remain grouped under instrument/, tests/ and this experiment.
- Verification: New Python tests initially failed without implementation; three
  integration regressions failed before replacing shoulder-only detection.
  33 new Python cases; complete suite 314 passed, 2 skipped, 434 subtests passed
  (16.02s). JavaScript complete suite 122 passed: includes 1,089 observations
  compared with the Python oracle and a separate stereo/loss test. Spin p95
  about 0.007 ms against a 5 ms budget, excluding pose inference. Ruff lint and
  format pass; mypy passes all 14 instrument source files; whitespace check passes.
  Environment: macOS arm64, Python 3.11.17, Node 24.19.0.
  Local AST graph refreshed: 2,167 nodes, 3,968 edges, 183 communities; no API cost.
- Browser verification: Fresh headless Chromium with synthetic video/pose data
  exercised the real page loop: one count at 180 degrees, two at 360, face loss,
  calibration enablement, mirror invariance, reset, total pose loss, study switch,
  stream cleanup and mobile width. Zero page errors; screenshot inspected at
  output/movement-dictionary/body-turns-browser.png. No user camera, video,
  IAC bus or Safari session used by this test. Local server remains on port 5094;
  refresh Safari and choose Body turns or use the #body-turns link.
- Limits/next: Synthetic geometry validates the rules, not MediaPipe accuracy.
  Uncertain depth, coordinated gradual label errors, self-occlusion, torso twist,
  camera movement and cropping can still miss/miscount turns. Begin facing the
  camera with torso and hands or knees visible. Test slow/quick half turns each
  way, full turns, crossing limbs alone and partial-return movements. Compare
  diagnostics before tuning or trying a dedicated orientation/temporal model.

## 2026-10-19 - Linear anatomical span MIDI velocity

- State: Implemented and verified locally on ableton; updated server running.
- Request: Stop the reach-capture experiment; hands together = 0, full span =
  127, with a linear scale while expanding. No performer measurement was run.
- Changes: Python hand_span_gain reference first, then browser translation.
  Estimate full wrist reach from shoulder width plus upper arms/forearms using
  existing 3D pose (2D fallback). Subtract quarter-shoulder hands-together zone
  and normalize linearly; zero releases notes/CC11=0. Missing/invalid arm points
  mute. Retain continuous same-note velocity refresh, root/chord routes,
  split energy, captured one-hand transfer level and existing cleanup.
  Audio mixer boosts no longer saturate MIDI early; mute/zero still silences it.
  Version entry, frame and MIDI module URLs to replace older cached Safari code.
- Verification: 17 new mapping cases fail before implementation; Python reference
  then passes all 56 focused tests. Full suite: 281 passed, 2 optional skips,
  434 subtests (14.89s). An initial sandbox run could not bind local HTTP sockets;
  rerunning with localhost access passed. JavaScript: 82 passed, including 3D
  frame gating, linear endpoints, scaling, transfer and previous controller parity.
  Real headless browser → localhost bridge → synthetic driver produced
  0/32/64/95/127/0, checked mute/audio boosts, held notes, root/chord, panic,
  disconnect/close and zero page errors. No test messages sent into user IAC buses.
  Ruff lint/format, mypy for changed Python module and whitespace checks pass.
- Runtime: Gracefully stopped old live.py and synthetic test server; relaunched
  normal live.py at http://127.0.0.1:5094/live/. Actual browser requested all three
  new linear-span module URLs with HTTP 200. No reach-test launcher was started.
  AST graph refresh: 1,870 nodes, 3,407 edges, 175 communities; no API cost.
- Limits: Endpoint is estimated from the model's anatomy, not calibrated personal
  reach. Pose error/occlusion may affect it; repeated Note Off/On can retrigger
  envelopes/release tails. Actual listening with this revised scale remains
  manual (T097). Prior audible acceptance applied to the earlier velocity curve.
  Current changes remain local/uncommitted; previous unrelated work preserved.

## 2026-10-15 - Live Safari MIDI diagnosis and cache fix

- State: Verified with Anthony performing in Safari and confirming Ableton sound changes.
- Finding: Read-only taps on all three existing IAC sources captured the live
  dance2music bus. Before reload, 54 Note Ons all had velocity 100 while CC11
  ranged 0–127: Safari was executing the cached fixed-velocity module.
- Fix: Version the live entry and MIDI module URLs for this migration; localhost
  static responses now require cache revalidation. Server logs confirmed both
  new module URLs fetched with HTTP 200 after restart.
- Live result: Same C-major pitches 48/52/55 received 810 Note Ons across 104
  distinct velocities, range 13–127, with zero duplicate Note Ons lacking Offs.
  Anthony confirmed: "Yes, the sound changes now". No notes were generated by
  the monitor; all came from his browser. Read-only listeners closed after 180s.
  Capture and summary: output/anthony-instrument/live-midi-debug/.
- Checks: Cache-header regression failed before fix; 30 bridge and 23 affected
  JavaScript tests pass. Ruff/format, mypy and whitespace pass. Local AST refresh:
  1,848 nodes, 3,370 edges, 171 communities. Changes local/uncommitted on ableton.

## 2026-10-15 - Continuous MIDI velocity refresh on held notes

- State: Corrected and verified locally on ableton; actual Ableton listening pending.
- Task: Anthony reported attack-only velocity did not work for resizing a held
  note or shared chord tones; explicitly requested continuous velocity updates.
- Changes: Python-first lifecycle validation, then website translation. Evaluate
  each frame and, when rounded 1–127 velocity changes, send Note Off for removed
  and refreshed notes before CC11 and replacement Note On at current velocity.
  Shared chord tones refresh too. Equal quantized velocity keeps sustaining;
  zero/invalid/lost input still releases and cleanup resets velocity ownership.
  Root/chord output and Safari IAC use the same rule. This supersedes the earlier
  attack-only behavior. MIDI 1.0 requires a new attack to change velocity, so
  resizing can audibly retrigger envelopes/release tails; CC11 remains available
  for smooth sustained expression. Existing native CLI stays separate.
- Verification: Same-note regression failed before the fix. Focused Python:
  38 passed; full suite 263 passed, 2 optional skips, 434 subtests passed (14.92s).
  Node: 80 passed, MIDI routing p95 0.001416ms (<1ms). Real browser/HTTP synthetic
  driver verified same chord velocity 64 → 32, then shared-note chord velocity
  127, ordered Off/On, unchanged-level sustain and panic/loss/close; zero page
  errors. Ruff check/format, mypy (16 sources) and whitespace check pass.
- Limitations: Additional native CoreMIDI probe could not enumerate its temporary
  test destination from the running server, including after a bounded 2s wait;
  no actual-user IAC messages were sent, and no live delivery/listening pass is
  claimed for that probe. Existing IAC buses remained listed. Unit and real HTTP
  synthetic-driver checks pass; actual Safari/Ableton listening remains manual.
- Local state: Backend restarted at http://127.0.0.1:5094/live/; current page and
  MIDI source verified HTTP 200. Synthetic test server stopped. Local AST refresh:
  1,845 nodes, 3,368 edges, 171 communities, no API cost. Usage/contract/decisions
  updated. Uncommitted; prior work preserved, no push or upstream import.

## 2026-10-15 - Ball-size MIDI attack velocity

- State: Implemented and verified locally on ableton; actual Ableton listening pending.
- Task: Use ball size to control the velocity of website MIDI messages.
- Changes: Validated the Python browser-MIDI reference first, then translated it
  to JavaScript. New note attacks use max(1, round(effective ball gain × 127)),
  replacing fixed velocity 100 for root-only and full-chord modes, native Web
  MIDI and Safari's local IAC path. Existing body-relative size curve and
  pad/master gain scaling apply. Zero/invalid gain releases notes; tiny positive
  gain never sends velocity-zero Note On. Held/common notes keep sustaining;
  size changes still send CC11, and added tones/root changes/recovery use current
  size. Native CLI retains its separate explicit --midi-velocity option.
- Verification: Four new attack regression cases failed before the fix. Python
  lifecycle/geometry suite: 36 passed, including small/large sizes, saturation,
  camera scaling, split energy, recovery and no held-note retrigger. Full suite:
  261 passed, 2 optional skips, 434 subtests passed (15.60s). Node: 80 passed,
  including native MIDI parity, both modes and Safari fallback; MIDI routing
  p95 0.0015ms (<1ms). Fresh browser/HTTP synthetic-driver integration passed with
  zero page errors and exact velocity 64/127 bytes, sustain, panic and cleanup.
  Ruff lint/format, mypy (16 sources) and whitespace check pass. Local AST refresh:
  1,840 nodes, 3,361 edges, 168 communities; no API cost.
- Local state: Uncommitted; previous work preserved, no push/upstream imports.
  Actual Anthony server remains http://127.0.0.1:5094/live/. Synthetic test server
  stopped; no notes sent to the user's IAC buses for this verification.
- Outstanding: Refresh the website, select MIDI output, vary ball size and start
  new notes to listen to velocity-sensitive attacks. Held-note size changes need
  CC11 support/mapping for continuous expression; actual Safari/Ableton listening
  and end-to-end latency remain manual acceptance.

## 2026-10-15 - Opposite relative-root mappings

- State: Implemented and verified locally on ableton; performer/listening trial pending.
- Task: Make opposing direction pairs reverse the same musical interval.
- Decision: Anthony corrected the proposed mixed-pair rule: left-up reverses with
  left-down, and right-up with right-down. Keep the horizontal direction fixed
  and flip only the vertical direction, whichever hand supplies it. Both
  left/right = fourth down/up; left-right/right-left = whole step down/up;
  both up/down = octave up/down. Retain the opposed tritone pair and all 12 notes.
- Changes: Revised Python table first, then the existing website translation.
  Preserved backend handedness and displayed L/R aliases; chart and tutorial
  show the transposed map using displayed names. Neutral/dwell, limits, quality,
  ball controls and MIDI lifecycle stay intact. Demo uses the new whole-step
  gesture while preserving its C → G → A musical/MIDI sequence. Updated native
  parity fixture, accepted map, decisions and usage instructions.
- Verification: New round-trip regression reproduced 96 old-map failures; now all
  16 pairs reverse exact roots/voicings at all 12 starting notes. Full Python suite:
  241 passed, 2 optional skips, 434 subtests passed (15.50s). Node: 79 passed,
  including 4,020 parity observations and 90,000 voicing transitions; controller
  p95 0.003ms (<5ms). Ruff lint/format and mypy (16 sources) pass. Fresh headless
  browser verified all 16 rendered chart entries and zero page errors; chart
  screenshot inspected at output/anthony-instrument/root-mapping/interval-chart.png.
  Local AST update requested by the supplied AGENTS instructions: 1,833 nodes,
  3,344 edges, 176 communities, no API cost.
- Local state: Uncommitted; existing Safari changes preserved. No push or branch
  import. Anthony website server restarted at http://127.0.0.1:5094/live/.
- Outstanding: Refresh the page and try the revised gestures with actual hands;
  listening/performer comfort and the existing Safari/Ableton trial remain manual.

## 2026-10-14 - Safari IAC MIDI and mirrored hand label text

- State: Implemented/verified locally on ableton; actual Safari/Ableton listening pending.
- Task: Support Safari in the website's Ableton section with current Mac IAC
  destinations. Then swap left/right writing only, preserving the correct backend.
- Changes: Lazy native MIDI bridge on the normal localhost server, exact explicit
  port selection, ordered batches, heartbeat/timeout, all-owned-note failure and
  shutdown cleanup, bounded same-origin JSON API. Safari uses the existing controls;
  native Web MIDI remains preferred where available. No driver/bus configuration.
  Website hand readouts, owner/transfer text, guide letters and chart headings
  swap L/R display names; tracking IDs, gesture pairs, harmony, intervals and MIDI
  are unchanged. Phone MIDI stays deferred.
- Verification: 240 Python tests, 242 subtests pass; 2 optional skips. 78 Node tests
  pass, including native parity and 90,000 voicing transitions. Ruff/format/mypy
  pass. Browser fallback/HTTP smoke passes with zero page errors. Real CoreMIDI
  loopback received 22 exact messages including abandoned-page cleanup; current
  IAC ARIA_IN, ARIA_OUT and dance2music were listed, with no notes sent into them.
  HTTP round-trip p95 0.642ms over 104 requests, below the 10ms target.
- Local state: Uncommitted on ableton; no push/upstream import. Tutorials, contract,
  decisions and evidence updated. Local AST refresh completed once: 1,827 nodes,
  3,334 edges, 176 communities; no API cost.
- Outstanding: In actual Safari, choose the intended IAC bus and listen in Ableton;
  verify camera gestures, expression mapping and displayed names. Safari automation
  was unavailable without enabling safaridriver/computer-use permissions; those
  settings were left alone. Session cannot invoke /compact; user must run it before
  the next feature under constitution XI.

## 2026-10-12 - Direct sustained chords to Ableton

- State: Implemented and verified locally on ableton; performer/Ableton listening pending.
- Task: Add chord output after the single-root stage. Anthony dropped Expressive
  Chords and requested direct synth input, confirming hold while ball is active
  with P as persistent pause/resume rather than a latched chord after tracking loss.
- Changes: --midi-chords opens dance2music - Chords to Ableton and sends the full
  current three-to-six-note voicing. Identical pitch sets hold without retriggering;
  changed voicings release all old notes before new notes. Quality changes still
  work with root locked. Pause/loss/exit releases every held or attempted pitch;
  partial send/release failures attempt all cleanup before deleting the endpoint.
  Single-root --midi remains available; only the selected mode creates a cable.
- Verification: Full suite 184 passed, 2 optional skips, 242 subtests passed;
  Ruff lint/format and mypy pass. All 300 chords tested at three registers.
  Dedicated CoreMIDI loopback received 38 exact messages and verified source removal.
  Full paced demo: 450 frames in 14.993s, 31 messages including exit cleanup.
  MIDI update p95 0.00621ms; controller+adapter p95 0.00792ms over 13,500 synthetic
  frames, below 5ms. Inspected full six-note MIDI HUD; tutorials/evidence updated.
- Local scope: Branch ableton; Anthony authorized commit and push on 2026-10-12.
  No website translation; dependency unchanged. Local AST refresh: 1,550 nodes, 2,799 edges,
  154 communities, no API cost. Whitespace check passes.
- Outstanding: Connect a polyphonic Ableton synth and listen to held chords,
  quality/root/octave changes, P/loss/recovery and exit. Windows/Linux integration
  and end-to-end audio latency remain unverified. Session cannot invoke /compact;
  user must run it before the next feature under constitution XI.

## 2026-10-12 - Save Ableton changes on a separate branch

- Task: Create the local ableton branch, commit the MIDI implementation and its
  tests, documentation and graph refresh, then return to anthony-explorations.
- Scope: Keep the Ableton work on ableton; anthony-explorations stays at its
  previous commit. No push requested. Implementation verification is recorded below.

## 2026-10-12 - Single held root note to Ableton

- State: Implemented and verified locally; Ableton routing/listening trial pending.
- Task: Add clearly named virtual MIDI cables and send one note before chord work.
- Decisions: Anthony selected the current root, held while the ball is active.
  Active cable: dance2music - Notes to Ableton. Reserved for later, not created:
  dance2music - Chords to Ableton. Channel 1, velocity 96; both configurable.
- Changes: Lazy optional RtMidi port/monophonic adapter, explicit MIDI CLI flags,
  exact/unique existing destinations, port listing, P pause/resume, visible status,
  paced headless output and MIDI byte logs. Root/octave changes release then replace;
  loss/pause/exit release. Quality/ball-mode changes preserve the held root.
  Best-effort Note Off/All Notes Off and endpoint deletion run on exit/failure.
- Verification: Full suite 161 passed, 2 optional skips, 242 subtests passed;
  Ruff lint/format, mypy and whitespace checks pass. Native macOS CoreMIDI loopback
  received all seven expected note/release/panic messages and confirmed source
  deletion. Full 450-frame MIDI demo ran in 14.997s, roots 48 → 55 → 57, MIDI p95
  0.00221ms. Controller+adapter p95 0.00734ms (<5ms) over 13,500 synthetic frames.
  Inspected the HUD preview; tutorials and reproducible evidence are recorded.
- Outstanding: Connect an Ableton MIDI instrument and listen through root/octave,
  pause/loss/recovery and exit. Windows/Linux integration and end-to-end latency
  remain unverified. Restricted sandbox cannot create CoreMIDI; desktop check passes.
  Chord MIDI/Expressive Chords mapping remains the later stage. Local Python only;
  dependency installed in .venv; saved on local branch ableton. No push or website
  translation.
- Graph refresh: Local AST update completed once; 1,522 nodes, 2,699 edges,
  155 communities, no API cost. No supported /compact invocation in this session;
  user must run it before starting the next feature under constitution XI.

## 2026-10-12 - Split-ball energy transfer verification

- State: Complete locally with the approved area rule; performer trial pending.
- Task: Collect the palm ball into the fist ball while split and enlarge the receiver.
- Decision: Anthony selected combined visible area: two radius-40 balls yield
  radius ~57. The existing split-to-fist consolidation already uses that rule.
  Retained it and made the energy relationship explicit in current usage/design docs.
- Changes: Added symmetric tests covering the actual reopen/split/fist+palm sequence,
  receiver enlargement, donor removal, one-time accumulation, captured gain/chord,
  and common nearby-fist return to midpoint. Added direct split-energy usage steps.
- Verification: Both receivers at four hand spacings verify exact area conservation,
  one transfer per closure, stable captured size/gain and nearby-fist return.
  Full suite: 121 passed, 2 optional skips, 242 subtests passed; Ruff lint/format,
  mypy and whitespace checks pass. Inspected the collected-ball preview; example
  radii 31.82 + 31.82 become 45.00 with unchanged gain. Local AST graph refreshed.
  Final checks and preview observations are recorded in feature evidence.
- Outstanding: Live gesture and listening acceptance remain pending. Changes stay
  local/uncommitted; runtime already supported this approved behavior.

## 2026-10-12 - Root verification, full tutorial and palm-to-fist correction

- State: Engineering verified locally; live camera/listening trial pending.
- Task: Confirm relative root changes work, make their tutorial visible, and
  reverse the ball transfer so the closed fist receives it from the open palm.
- Changes: Corrected transfer receiver in both directions. Expanded Feature
  Tutorials with top navigation, full root-position map, C → G → D walkthrough,
  octaves/downward register, center rearming, mode switching and recovery. Updated
  current transfer docs/spec/decisions; prior palm-receiver evidence is historical.
- Verification: 113 tests and 242 subtests passed; 2 optional skips. Ruff lint/format,
  mypy and whitespace checks pass. Full interval/midpoint demos pass and all 600
  states replay exactly. Corrected 380-frame transfer replay matches exactly;
  shared nearby-fist merge remains covered. All 16 tutorial cells match code.
  Reproduced old receiver binding and confirmed the fist receives in both cases.
  Added interval/octave/T/lock integration with fist ownership; local model smoke
  passed. Core demo p95 <0.033ms against 5ms budget. Inspected local previews.
- Outstanding: Restart the native Python instrument; test recognition and sound
  with a performer. Automated and blank-frame checks do not establish live usability.
- Local scope: No website changes or push; edits remain uncommitted. Evidence and
  artifacts are linked in specs/001-anthony-instrument/evidence.md.
  Local AST graph refreshed (1,432 nodes, 2,449 edges, no API cost).

## 2026-10-12 - Persistent hand transfer and common two-fist merge

- State: Engineering complete locally; performer camera/listening acceptance pending.
- Task: Add fist + palm transfer alongside nearby-fist split, then confirm owned
  balls merge back with both closed fists close together, as split balls do.
- Decisions: Accepted recommended persistent ownership, transfer-only (no root
  lock toggle), and captured body-relative size/gain. Anthony explicitly corrected
  owned mode to merge to midpoint on nearby fists; midpoint then splits on the
  next reopened closure. M/reset also clear ownership; transfer back is supported.
- Changes: Pure controller owner/captured geometry, closure arbitration and pair
  cancellation; one-wrist rendering/gain, ownership/loss/progress HUD and cleared
  particle trails. Split balls can consolidate into an open hand. Distant fists
  and fist/non-palm retain lock controls. Updated fixtures/demo and usage/design docs.
- Verification: Existing split/merge checked first (7 tests/3 subtests passed).
  Full suite: 111 passed, 2 optional skips, 242 subtests passed; lint/format/mypy
  and whitespace checks pass. All 380 exported states replay exactly. Inspected
  owner/midpoint previews; 11,400-frame core p95 0.0078ms (<5ms). Artifact paths
  and reproducible parameters are in specs/001-anthony-instrument/evidence.md.
- Local scope: Python only; changes are uncommitted. No push or website translation.
  AST graph refreshed locally once (1,425 nodes, 2,439 edges, no API cost).
  Session has no supported /compact invocation;
  user must run the command before the next feature under constitution XI.
- Outstanding: Restart Python and try transfer in both directions, retained sound
  with the other wrist absent, and both nearby closed fists returning to midpoint.
  Live inference and audible acceptance are not established by synthetic tests.

## 2026-10-12 - Relative root modes and wider split/merge

- State: Engineering complete locally; performer camera/listening acceptance pending.
- Task: Implement the approved separate-hand interval map as default, retain the
  midpoint selector behind a keyboard switch, and widen the split distance.
- Decisions: T switches modes while preserving chord/register/lock/ball state;
  R retains the mode while resetting musical state. Neutral rearm is 0.20s,
  pair dwell 0.35s; chest origins and thresholds are documented in relative-root.md.
- Changes: Added pure body-relative interval selection, exact signed transposition
  and real octave controls, root MIDI/register-aware voicing, lock/recovery guards,
  T/CLI mode selection, effective mode recording/replay, updated demo, neutral
  guides and top-panel target/progress. Default split/merge distance increased from
  0.6 to 1.0 torso lengths. Preserved original midpoint and legacy replay behavior.
- Verification: 91 tests and 242 subtests passed; two optional Node/PowerShell tests
  skipped. Coverage includes all 16 signed pairs at all 12 roots, 4,800 catalogue
  transpositions, octave audio frequency ratios, rearming/loss/bounds, mode-key
  replay and wider split regression (failed before adjustment, passes afterward).
  Ruff lint/format, mypy and whitespace checks passed. All 90 exported demo states
  replay exactly. Synthetic 5,760-frame controller p95 0.0074ms (<5ms budget).
  Inspected narrow/wide interval and midpoint previews; audio sample exported for
  listening under output/anthony-instrument/relative-root. Live inference not measured.
- Documentation: Updated approved map, tutorials, quickstart, README, explanation,
  decisions, spec, plan, tasks and evidence. New files stay with instrument/tests/spec.
- Local state: Previous work preserved; no push or website changes. Local AST graph
  refreshed (1,397 nodes, 2,355 edges). Session exposes no compaction invocation;
  user must run /compact before the next feature under constitution XI.
- Outstanding: Restart Python, center both wrists, try signed intervals/T/octaves
  and retest nearby fists; automated results do not establish performer acceptance.

## 2026-10-12 - Relative root-control proposal

- State: Design proposal only; awaiting Anthony's choice before implementation.
- Task: Recommend separate-hand interval controls reaching all 12 pitch classes,
  with signed movement and two-hands-up/down octave controls.
- Proposal: Four body-relative direction zones per hand; left chooses an interval
  family and right chooses signed movement. Reserve both up/down for +/-12, and
  opposite vertical directions for +/-6. Seconds, thirds, fourths and fifths fill
  the remaining pairs. Require stable dwell and neutral rearming for one step per
  gesture. Proposed replacement of the midpoint selector retains fist root lock.
- Verification: Reviewed current midpoint root selection, lock gating and bounded
  voice leading. Signed +/-1 through +/-6 cover every nonzero pitch class; +/-7
  adds fifth gestures. Actual octave shifts need explicit register state because
  current root is only 0–11 and voice leading uses a fixed MIDI register.
- Outstanding: Confirm control mode and mapping before Python implementation;
  body zones and timing need performer validation. No executable code changed.

## 2026-10-12 - Prominent top hand readouts

- State: Complete locally; live distance-readability trial pending.
- Task: Display what each hand sees at the top for reading from farther away.
- Changes: Added LEFT HAND / RIGHT HAND columns with large confirmed gestures and
  current raw model labels/confidence underneath. Label size grows for wider feeds
  and fits within each column. Explicit unknown, wrist-only and missing-hand states
  clear prior readings on loss. Expanded the panel to 350 pixels, preserving the
  full camera image; updated tutorials and quickstart.
- Verification: 16 visual/CLI tests and 6 subtests passed, covering corrected hand
  identities, confirmed versus raw labels and loss. Ruff lint/format and mypy passed.
  Inspected `output/anthony-instrument/hand-readouts/preview.png` at 640px width.
  Whitespace check passed; local AST graph refreshed (1,352 nodes, 2,116 edges).
- Local state: Changes remain uncommitted; no push or JavaScript changes.
- Outstanding: Restart camera mode and check readability at performer distance.

## 2026-10-12 - Flip live hand controls

- State: Complete locally; performer confirmation pending.
- Task: Swap reversed left/right hand labels and musical controls in camera mode.
- Changes: Shared mirrored-body mapping assigns L to wrist/elbow 16/14 and R to
  15/13 for body wrists and gesture crops. Hand identities remain stable when
  crossing. Recorded replay IDs remain as saved. Updated tutorials, quickstart
  and decisions with Anthony's requested correction and replay behavior.
- Verification: New ordered-chord/crossed-hand/replay regression failed before
  the fix and passes afterward. 77 tests and 47 subtests passed; two optional
  tests skipped. Ruff lint/format, mypy and whitespace checks passed. Local AST
  graph refresh completed (1,348 nodes, 2,089 edges).
- Local state: Changes remain uncommitted; no push or JavaScript changes.
- Outstanding: Restart camera mode and confirm physical left/right chord controls.

## 2026-10-12 - Larger outlined instrument text

- State: Complete locally; live readability trial pending.
- Task: Make instrument text larger and add a shadow/outline.
- Changes: Enlarged chord/status, root, gesture and help text; added white or colored
  text with a black outline and offset shadow. Expanded the controls panel to 240
  pixels and split help across shorter lines, preserving the entire camera frame.
  Updated tutorials and quickstart.
- Verification: 14 visual/CLI tests and 6 subtests passed; Ruff lint/format and mypy
  passed. Inspected `output/anthony-instrument/text-readability/preview.png` on a
  bright background. Local AST graph refresh completed (1,346 nodes, 2,083 edges).
- Local state: Changes remain uncommitted; no push or JavaScript changes.
- Outstanding: Restart the instrument to see the new text on the live feed.

## 2026-10-12 - Prepare camera models on macOS

- State: Model setup and macOS dependency fix complete; camera trial pending.
- Task: Resolve missing local models when starting the native instrument.
- Changes: Downloaded both MediaPipe models to ignored `output/models`, verified
  their pinned SHA-256 hashes and wrote provenance. Upgraded local MediaPipe from
  1.0.1 to 1.1.0 after reproducing a native Metal initialization abort, including
  with an explicit CPU delegate. Added platform-specific runtime pins and Mac
  commands in `docs/FEATURE_TUTORIALS.md`; Windows retains its existing pin.
- Verification: MediaPipe 1.1.0 passed `--model-smoke` with both models and two
  synthetic frames (17.33ms total). 76 tests and 47 subtests passed, with two optional
  skips. Pip reports no broken requirements; whitespace check passed.
- Local state: Changes remain local; model files are ignored. No push performed.
- Outstanding: Camera startup reports no attached video input devices;
  `system_profiler SPCameraDataType` returned no devices on this Mac. Connect/enable
  a webcam or iPhone Continuity Camera and grant the terminal camera permission,
  then retry. Performer camera/audio trial remains pending.

## 2026-10-12 - Install local test dependencies

- State: Complete.
- Task: Install dependencies so tests can run on this Mac.
- Changes: Installed `requirements.txt`, `requirements/instrument.txt` and
  `requirements/dev.txt` into the existing Python 3.11.17 `.venv`; aligned NumPy
  to 2.4.1 and added PyYAML 6.0.3 for the optional preset-composition test.
- Verification: 76 tests and 47 subtests passed; two optional tests skipped because
  Node and PowerShell are unavailable. Pip dependency check, Ruff lint/format and
  mypy passed. Run tests with `.venv/bin/python -m pytest -q`.
- Local state: Only this status record is changed in tracked files; no push performed.
- Outstanding: Optional JavaScript and cross-shell parity checks require Node and
  PowerShell respectively. Camera/audio device behavior was not tested.

## 2026-10-12 - Pull latest changes

- State: Complete.
- Task: Pull the latest remote changes.
- Verification: `git pull --ff-only` succeeded on `anthony-explorations` and reported
  already up to date at `89c7815`. The working tree was clean before the pull.
- Local state: This status entry is uncommitted; no push was performed.

## 2026-10-04 - Constitution: local work and task status

- State: Complete.
- Task: Keep all project work local until explicitly authorized by the user, and update this
  file after each user-requested task rather than after individual commands.
- Changes: Amended `.specify/memory/constitution.md` from version 1.0.0 to 1.1.0 with two new
  principles and a corresponding task handoff requirement. Created this task record.
- Verification: Resolved the active constitution template; confirmed existing principles and
  the original ratification date are preserved, version and amendment date agree with the
  amendment report, no unresolved placeholders remain, and the diff has no whitespace errors.
  No executable behavior changed, so application tests were not required.
- Local state: Working on `anthony-explorations`; this amendment is uncommitted. No external
  project actions were performed.
- Outstanding: No implementation work remains. Remove the temporary Sync Impact Report before
  committing the constitution amendment.

## 2026-10-04 - Constitution: graphify, design decisions, and project languages

- State: Complete.
- Task: Use graphify to search the codebase efficiently, prompt the user whenever a design
  dilemma arises, and clarify that the analysis code is Python while the web app is JavaScript.
- Changes: Amended `.specify/memory/constitution.md` from version 1.1.0 to 1.2.0. Added principles
  for graphify-first navigation and user decisions on design dilemmas. Clarified the language
  split and the scope of Python-specific requirements. Preserved all previous principles.
- Verification: Resolved the active constitution template; checked headings, version, ISO dates,
  unresolved placeholders, preservation of existing principles, and whitespace. No executable
  behavior changed, so application tests and a code graph refresh were not required.
- Local state: Working on `anthony-explorations`; both constitution amendments remain local and
  uncommitted. No external project actions were performed.
- Outstanding: No implementation work remains. Remove the temporary Sync Impact Report before
  committing the constitution amendments.

## 2026-10-04 - Anthony's vision and Python-first development

- State: Requested vision and governance documents complete; formal feature planning deferred.
- Task: Structure Anthony's six project ideas and first-priority fist toggle, document possible
  design flaws, preserve project context for future agents, and require Python validation before
  any explicitly requested JavaScript translation.
- Changes: Created `ANTHONY_IDEAS.md` with project context, current versus proposed capabilities,
  priorities, each idea's possible design flaws, open questions, and a feature-planning handoff.
  Added project/vision context to `AGENTS.md` and a vision-document link to `README.md`. Amended
  the constitution from version 1.2.0 to 1.3.0 with the two-stage development principle.
- Confirmed decisions: Persistent fist toggle; lock the root while allowing quality changes;
  split gestures suppress lock toggles; start with estimated-depth 3D control; recognize three
  spell moves in order; remain split after reopening, with a future separate merge gesture.
  Recorded future animator-supplied 3D assets and openness, rotation, and hold-time controls.
- Verification: Used graphify queries/explain/path followed by focused source reads; checked the
  README, current sphere/gesture/harmony implementation, and `live.py` server boundary. Resolved
  the constitution template and validated version, dates, placeholders, links, idea coverage,
  preservation of prior governance, and whitespace. No executable behavior was changed, so
  application tests and a code graph refresh were not required.
- Planning prerequisite: `setup-plan.ps1 -Json` failed because no active feature directory or
  `.specify/feature.json` exists. No formal `IMPL_PLAN`, research, data model, contracts, or
  quickstart was generated, and unresolved design choices were not treated as approved.
- Local state: Working on `anthony-explorations`; all documentation changes remain local and
  uncommitted. No Python feature implementation or website translation was performed.
- Outstanding: Specify the local Python fist root-lock feature and settle its remaining scope
  and design choices before formal implementation planning. Confirm the MIDI trigger map and
  plugin behavior before finalizing its adapter. Remove the constitution's temporary Sync Impact
  Report before committing. JavaScript translation remains explicitly deferred.

## 2026-10-04 - Commit vision and governance documents locally

- State: Complete.
- Task: Commit the reviewed vision and project governance changes locally.
- Changes: Removed the constitution's temporary Sync Impact Report and included the vision,
  constitution v1.3.0, project guidance, README link, and this status history in the local commit
  titled `docs: record Anthony's vision and Python-first workflow`.
- Verification: Checked the five-document commit scope and whitespace; verified the constitution
  version and removal of the review comment. Application tests were not required because this
  commit changes documentation only.
- Local state: Committed on `anthony-explorations`; nothing was pushed. Earlier entries retain
  the uncommitted state recorded at those tasks' handoffs; this entry supersedes that state.
- Outstanding: Formal Python fist-toggle specification/planning and its remaining design decisions
  remain future work. JavaScript translation still requires explicit user instruction.

## 2026-10-04 - Review Joseph's ball and defer initial 3D work

- State: Complete.
- Task: Identify Joseph Bakarji's ball work, compare it with Anthony's planned design, and assess
  whether it can be used temporarily while 3D comes later.
- Findings: Git history and blame attribute the current ball to Joseph's `0c019b6` commit dated
  2026-10-01. It uses Canvas 2D, wrist midpoint/spacing, fire or chord-colored glow, sparks,
  motion-energy flicker, and sphere-size sound mappings. The same commit adds pad timbres.
  Depth, split/merge, rotation, and hold-time color interactions are not implemented by that ball.
- Decision: Anthony explicitly chose to reuse Joseph's design temporarily in the Python prototype
  and defer depth/3D work. This supersedes the earlier 3D-first starting point, while preserving
  the future 3D/animator-asset vision and the other confirmed interaction decisions.
- Changes: Updated `ANTHONY_IDEAS.md` with provenance, current behavior, reuse boundaries, new
  design risks, and the revised starting point. Updated `AGENTS.md` to preserve that decision.
- Verification: Used graphify followed by focused source reads, `git show`, and `git blame`;
  checked document consistency and whitespace. This was a source review, not a runtime visual
  or audio test. No executable behavior changed, so application tests and a code graph refresh
  were not required.
- Local state: Working on `anthony-explorations`; these documentation changes remain local and
  uncommitted. No feature implementation, website translation, or push occurred.
- Outstanding: Plan the Python adaptation and remaining gesture/MIDI details before implementation.
  A later 3D renderer and any depth-dependent behavior still need dedicated design and validation.

## 2026-10-04 - Explain code behavior and the computer-vision boundary

- State: Complete.
- Task: Create `explanation.md` explaining the existing code, what the CV models provide, and
  what the project implements or still needs to build.
- Changes: Added the explanation of the Python and browser paths, body/hand model outputs,
  project motion/gesture/harmony/audio/ball logic, third-party dependencies, and the separate
  vocabulary-clustering experiment. Included a responsibility table, a pipeline diagram, and
  a table distinguishing planned work from implemented features. Linked it from README and AGENTS.
- Verification: Used graphify queries/explain followed by focused reads of the relevant source;
  checked model/application boundaries, document links, planned versus current behavior, and
  whitespace. No runtime benchmark or effort measurement was performed, so no percentage of
  model versus project work is claimed. This is documentation only; application tests and a
  code graph refresh were not required.
- Local state: Working on `anthony-explorations`; these and the prior ball-roadmap changes remain
  local and uncommitted. No application source, feature behavior, or web translation changed.
- Outstanding: The Python feature specification, implementation, and relevant runtime validation
  remain future tasks. No documentation work remains for this request.

## 2026-10-05 - Resume Anthony's local Python instrument implementation

- State: Stage 1 implementation and engineering validation complete; performer acceptance pending.
- Task: Continue yesterday's `$speckit-implement` work in `specs/001-anthony-instrument`.
- Resume point: The full native prototype, feature documents and 24 tests were uncommitted;
  tasks were unchecked and evidence.md was missing. Earlier status entries predated that work.
- Changes: Verified and completed the existing root-only fist lock, split arbitration/persistence,
  Joseph-inspired fire/light glow, 72-chord catalogue, smoothed local synth, camera/video/demo/replay
  CLI, offline model setup and scoped development tooling. Corrected WAV event timing across
  irregular gaps, configurable dead-zone feedback, malformed replay diagnostics, nonfinite
  tracking-score handling and synth sample-rate validation. Added regression coverage, checked
  completed tasks, created evidence.md, reconciled README/vision/explanation and verified ignores.
- Verification: 28 tests and 11 subtests passed; lint/format/types and pip check passed. Exhaustive
  5,184 chord transitions passed. The 450-frame replay exactly matched demo state; controller
  p95 was 0.0572 ms (<5 ms). Inspected merged/locked/minor/split renders in fire/light styles.
  Both local models loaded; native window, default audio stream and synthetic video checks passed.
  Approved camera retry outside the sandbox processed 19 frames (inference p95 45.1 ms) with no
  hands/body detected. This does not establish gesture usability or subjective audio quality.
- Local state: This entry accompanies the task-plan's local implementation commit on
  `anthony-explorations`. Refreshed the code graph with graphify update . (AST only, no API cost)
  and reviewed the local diff. Code, evidence and generated graph stay local. Git staging/commit
  needed approved access because the sandbox restricts Git metadata writes. No web feature logic,
  push, upload or deployment.
- Outstanding: Anthony's live gesture/threshold and listening review. 3D, spells, games, MIDI and
  JavaScript translation remain separate future work. Prior dated graph snapshots and caches
  unrelated to this resume remain unstaged; no historical task records were removed.

## 2026-10-05 - Mark Anthony's ideas 0–2 and remaining work

- State: Complete documentation update.
- Task: Confirm whether ideas 0, 1 and 2 were implemented, mark their completed scope,
  and state what still needs fixing.
- Changes: Added an explicit completion checklist and status to each idea in ANTHONY_IDEAS.md.
  Marked root lock, the approved temporary 2D/split ball and the initial 72-chord catalogue
  complete for the local Python prototype. Replaced superseded unanswered questions with
  the implemented choices. Listed label overlap, live recognition/timing trials, distant or
  occluded hand assessment and subjective listening as remaining cleanup/review. Kept true
  3D and other unbuilt additions explicitly deferred; recorded the validation fixes already done.
- Verification: Consulted graphify and the current spec, decisions, completed tasks and evidence.
  Matched completion claims to local implementation commit 6acfa55 and its recorded 28 passing
  tests. Reviewed the Markdown diff and whitespace. No executable behavior changed, so new tests
  and a code graph refresh were not required.
- Local state: Documentation edits remain local and uncommitted on anthony-explorations.
  Existing graph snapshot/cache changes were preserved. No external actions occurred.
- Outstanding: The listed performer acceptance and visual cleanup; deferred future features
  are not represented as completed. No documentation work remains for this request.

## 2026-10-05 - Create concise feature tutorials

- State: Complete.
- Task: Write a concise Markdown guide explaining how to use each implemented feature.
- Changes: Created FEATURE_TUTORIALS.md with launch/demo commands, ideas 0–2 controls,
  the six quality gestures, save/replay/video commands and reset/recovery/quit instructions.
  Linked it from README and added project guidance to maintain it for future implemented features.
- Verification: Consulted graphify and checked commands, timings and gestures against the
  quickstart and current harmony mappings. Checked local links and Markdown whitespace.
  No executable behavior changed; application tests and a code graph refresh were not required.
- Local state: Documentation changes remain local and uncommitted on anthony-explorations.
  Prior documentation and graph changes were preserved. No external actions occurred.
- Outstanding: None for this documentation request; existing performer review and deferred
  feature work remain as recorded in ANTHONY_IDEAS.md.

## 2026-10-05 - Require compaction after completed features

- State: Constitution amendment complete; automatic command invocation unavailable here.
- Task: Record the user's requirement to run `/compact` after each feature-sized task,
  such as one implemented Anthony idea.
- Changes: Added principle XI and bumped the constitution from 1.3.0 to 1.4.0. Require
  persistent handoff notes before compaction; exclude individual commands and checklist steps.
  Record unavailable command execution accurately and ask the user to invoke it when needed.
- Verification: Resolved the active constitution template; no extension hooks are configured.
  Checked version, dates, placeholders and whitespace. No executable behavior changed.
- Local state: Documentation remains local and uncommitted; prior work is preserved.
- Outstanding: This session has no callable `/compact` capability. No compaction was executed.

## 2026-10-05 - Commit and push Anthony's isolated branch

- State: Local commits complete; push blocked by GitHub write permissions.
- Task: Commit and push the completed work while keeping it separate from main and others' work.
- Decision: Stay on anthony-explorations, as explicitly requested. No new branch, merge,
  pull, rebase, pull request or change to main was performed.
- Changes: Committed feature completion notes, tutorials, project guidance and constitution
  v1.4.0 as 3d73ddd, following implementation commit 6acfa55. Removed the constitution's
  temporary review report before committing. Generated caches and historical graph edits
  remain unstaged and preserved.
- Verification: Reviewed staged file scope and passed git diff --cached --check. Pushed with
  the explicit refspec HEAD:refs/heads/anthony-explorations and automatic tag pushes disabled.
  GitHub rejected the push with HTTP 403: Anthony-Haber lacks write permission to
  Music-Intelligence-Lab/dance2music. Remote branch inspection confirmed main remains at
  f40be3b73384acb8ab8049c65bd876855afbb3de and anthony-explorations was not created remotely.
- Outstanding: Repository write access, or authentication with an authorized account,
  is required to retry the push. No remote changes occurred.

## 2026-10-05 - Set up the local macOS Python environment

- State: Complete.
- Changes: Created ignored .venv with Python 3.11.16 and installed all packages from
  requirements.txt. Added macOS setup and activation commands to FEATURE_TUTORIALS.md.
- Verification: pip check reported no broken requirements. All ten direct requirements
  imported successfully. Matplotlib built its initial font cache in a temporary directory;
  sandbox font-cache warnings did not prevent imports.
- Scope: Installed the main pipeline requirements; the separate instrument lock file,
  development tools and model downloads were not part of this installation.
- Local state: Environment and documentation remain local. No application code changed.
- Outstanding: None for the requested environment setup; devices and full application
  behavior were not tested.

## 2026-10-05 - Share Spec Kit workflows across macOS and Windows

- State: Implemented locally; macOS validated, Windows execution pending.
- Task: Use native Bash and PowerShell helpers with the same constitution, templates,
  skills and feature documents; complete the requested file-organization amendment.
- Changes: Copied both official helper sets unchanged from installed specify-cli 1.1.0.
  Updated ten shared skills to select upstream platform commands and registered the Bash
  helpers in the shared-infrastructure manifest. Initialized the ignored local feature
  pointer to specs/001-anthony-instrument. No feature documents were recreated.
- Constitution: Updated 2.0.0 to 2.1.0 with principle XII (coherent file organization,
  using original main as the reference) and shared native-shell Spec Kit requirements.
  Preserved principles I-XI and the original ratification date. Existing repository
  reorganization remains outside this implementation.
- Documentation: Updated existing AGENTS.md and FEATURE_TUTORIALS.md; added no root files.
  Installed declared requirements-dev.txt tools into the existing ignored .venv.
- Verification: All twelve helpers match the installed official bundle byte for byte;
  all six Bash helpers pass bash -n. On macOS Bash 3.2, nine contract tests passed using
  the Specify CLI Python environment (including PyYAML); one cross-shell parity test was
  skipped because PowerShell is unavailable. Tests cover shared templates and overrides,
  composition/failure handling, feature paths, persistence, prerequisites, plan preservation,
  feature creation and Unicode/UTF-8 feature-name limits. Ruff lint/format and mypy passed
  for the new test module. Actual project template resolution, prerequisites, plan setup
  and task setup succeeded. Constitution placeholders/version/dates, all ten skill YAML
  frontmatters and script references were checked. Graphify was refreshed locally.
- Validation limitation: The generic skill-creator validator rejects the existing Spec Kit
  compatibility frontmatter key; that metadata was preserved, and YAML/references were
  validated separately. Native Windows execution has not been run on this Mac.
- Local state: All work remains local and uncommitted; previous environment documentation
  edits were preserved. No publishing, pushes or project uploads occurred.
- Review cleanup: Removed the temporary constitution Sync Impact Report before committing.
- Outstanding: Run the same tests on Windows. No callable /compact exists in this session;
  the user must invoke
  it before the next feature-sized task.

## 2026-10-05 - Organize files by purpose

- State: Complete locally.
- Task: Apply constitution principle XII to the repository layout, using original main
  as the reference for a coherent explorer and preserving the original pipeline commands.
- Changes: Grouped three added guides and vision documents in docs/. Restored the original
  IDEAS.md to the root following the user's clarification to retain main's original files.
  Moved additional dependency files into requirements/ while retaining the main requirements.txt entry point.
  Moved the instrument's model helper into instrument/setup_models.py and documented its
  module command, python -m instrument.setup_models. Removed the empty scripts/ directory
  and redundant .claude/CLAUDE.md; root CLAUDE.md now points to authoritative AGENTS.md.
- Rationale: docs/ groups added human-facing guides; requirements/ groups the three additional
  environments. The helper belongs with its instrument package. README, shared agent entry
  points, project configuration, status.md and original executable pipeline entry points
  retain their root-level navigation, tool-discovery and command roles. All eight root Python
  files are byte-identical to origin/main, and every original main root entry exists.
- Integration: Updated documentation links, agent guidance, feature artifacts, tracking
  error instructions, the existing model-setup regression test and lint/type-check paths.
  Constitution references now point to docs/ANTHONY_IDEAS.md; governance rules and version
  are unchanged. Historical status entries retain the file names used at the time.
- Usage: README describes the layout; docs/FEATURE_TUTORIALS.md records old-to-new paths
  and commands. Additional installs use requirements/dev.txt, requirements/instrument.txt
  or the tested Windows requirements/instrument-lock.txt.
- Verification: Full pytest suite: 36 passed, 2 skipped, 13 subtests passed. The skips are
  optional Spec Kit preset composition (PyYAML absent from .venv) and cross-shell parity
  (PowerShell absent from this Mac). Ruff lint and formatting passed for instrument/tests;
  mypy passed for all 10 instrument source files. Local documentation links were checked,
  and the relocated model helper's --help succeeds without downloads. Moved dependency
  files and model-helper code are byte-identical to their originals. Graphify was refreshed,
  with preserved semantic provenance redirected to the moved source documents.
- Local state: Changes remain local and uncommitted. No model downloads, publishing,
  pushes or project uploads occurred during this reorganization.
- Outstanding: None for the organization request. This session cannot invoke /compact;
  the user must run it before the next feature-sized task.

## 2026-10-11 - Check upstream main for updates

- State: Complete; anthony-explorations already contains the latest upstream main.
- Task: Fetch main from Music-Intelligence-Lab/dance2music while keeping exploration work local.
- Verification: Fetched origin/main successfully. Upstream main is f40be3b
  (Live: record and download (video + sound, or sound only)). Git ancestry checks confirm
  anthony-explorations contains all upstream main commits, with 15 additional local commits
  and zero missing upstream commits. The working tree was clean before this status entry.
- Local state: No merge was needed. Neither local branch was moved; no push was performed.
- Outstanding: None for synchronizing the current exploration branch with upstream main.

## 2026-10-11 - Correct Python instrument performer testing barriers

- State: Implemented and validated locally; performer retest pending.
- Task: Restore whole-body camera feedback and sideways-palm ball control, improve
  hand tracking/volume, persist chord quality, show ROOT LOCKED, recognize None-labeled
  fists with visible finger joints, and show the complete camera view.
- Decisions: Anthony chose two recognized open palms held 1.5s to return to major
  and retained nearby paired fists for split; either fist or two separated fists
  toggle the root lock. Reopening retains the lock and current quality.
- Changes: Added body skeleton and body-wrist geometry, website-style wrist crops,
  causal 40ms position smoothing, conservative 3D finger-joint fist/open-hand arming
  without invented classifier scores, replay support, louder ordinary-spacing sound
  and --volume. Moved controls above the entire camera image; made the window resizable;
  requested 1280x720 with width/height overrides and Windows DirectShow/MJPEG capture.
- Verification: 49 instrument tests and 32 subtests passed; Ruff lint/format and mypy
  passed. Three regressions fail on isolated pre-fix HEAD and pass after correction;
  pre-fix controls obscured camera rows, now preserved pixel for pixel. Model smoke,
  both real crop recognizers, 450-frame demo, camera capture and playback passed.
  Final camera: 41 frames at 1280x720, full preview 1280x830, two wrists in all frames,
  reliable torso in 39; inference p95 45.86ms. Demo controller p95 0.0836ms. Ordinary
  spacing measured 20.83dB louder with peak 0.27752 and tested output bounds.
- Documentation: Recorded original-main comparison and follow-up feedback in the
  vision/decisions; updated spec, plan, tasks, quickstart, tutorials, README and evidence.
  Inspected representative body and ROOT LOCKED previews; Graphify refreshed locally.
- Local state: Work remains uncommitted on anthony-explorations. No push, upload,
  deployment or browser changes. Earlier upstream-check status entry is preserved.
- Outstanding: Retest live gesture reliability, full window sizing and subjective
  sound. Two unchanged Spec Kit tests fail on Windows template newline expectations;
  details are in specs/001-anthony-instrument/evidence.md. This session cannot invoke
  /compact; project governance requires the user to run it before the next feature.

## 2026-10-11 - Improve hand diagnostic and root-note text readability

- State: Complete locally.
- Changes: Made labels under the hands and root notes around the circle larger and
  bold black, with a light outline for contrast against camera footage and ball glow.
  Added a concise note to docs/FEATURE_TUTORIALS.md.
- Verification: All 7 visual tests passed; Ruff lint/format and mypy passed. Rendered
  and inspected output/anthony-instrument/text-readability.png. Graphify refreshed locally.
- Local state: Changes remain uncommitted on anthony-explorations; nothing was pushed.
- Outstanding: Restart the Python instrument to load the updated display.

## 2026-10-11 - Match web/main fist recognition and stabilization

- State: Implemented locally; live performer acceptance pending.
- Changes: Removed the added joint-shape fist/open-hand fallback. Ported web/main
  far-mode canned-label confidence threshold (0.5), confirmation (0.35s), missing
  detection grace (0.4s) and alternating wrist crops. Accepted fist dwell counts
  toward controller timing once; persistent root lock, nearby split priority and
  quality choices are preserved. Bold black diagnostics show confirmed/raw labels
  separately. Replay metadata retains both; obsolete geometry flags are ignored.
- Verification: 51 tests and 16 subtests passed, including direct execution of the
  website's JavaScript filter across 150 observations, flicker/lock/split/replay and
  fresh body-wrist requirements. Ruff and mypy passed. Model smoke, headless demo
  and authorized 1280x720 camera check passed; camera inference p95 31.36ms and
  controller 0.0603ms. Inspected the diagnostic preview. No deliberate fist was
  captured in the camera check, so it does not establish recognition accuracy.
- Documentation: Updated tutorials, quickstart, vision, model explanation and spec
  decisions/tasks/evidence. Refreshed Graphify locally.
- Local state: Changes remain uncommitted on anthony-explorations; nothing pushed.
- Outstanding: Restart and retest open-to-fist gestures. Body model remains Lite;
  parity applies to web far-mode hand detection/filtering, not the whole runtime.
  Previously recorded unrelated Windows Spec Kit failures remain outside this task.

## 2026-10-11 - Fix split after bringing confirmed fists together

- State: Corrected locally; live performer retest pending.
- Task: Anthony reported both confirmed hands showing Closed_Fist while ONE BALL
  remained. Reproduced a controller defect when closure occurred apart, root-lock
  arbitration completed, and the held fists then approached each other.
- Changes: Preserve the current closure's split eligibility while its recognized
  fist stays held. Bringing confirmed fists within the existing 0.6-torso distance
  can now split after locking. Split preserves the lock; opening, loss, reset,
  split and M clear the eligibility. M still requires reopening before another split.
- Verification: The approach regression failed before the fix and passes afterward.
  All instrument tests: 55 passed, 16 subtests passed, including alternating camera
  label cadence, merge/reopen, startup and gesture loss. Ruff lint/format and mypy
  passed. Sandbox temporary-file failures were resolved by an authorized test rerun.
  Inspected output/anthony-instrument/split-after-approach/comparison.png: one ball
  before approach, two separate wrist balls after reopening, ROOT LOCKED retained.
  Synthetic 20ms cadence split on the first nearby frame; controller p95 0.041ms.
- Documentation: Updated tutorials, quickstart, spec, decisions and evidence.
- Local state: Prior uncommitted work preserved; no push or website changes.
  Graph not refreshed for this minor controller fix, per constitution VIII.
- Outstanding: Restart Python and retest live. Model accuracy and thresholds were
  not changed or validated by the synthetic controller regression.

## 2026-10-11 - Merge using the same two-fist gesture

- State: Implemented and validated locally; live performer retest pending.
- Decision: Anthony requested the same action for merging as for splitting,
  superseding the deferred separate merge gesture.
- Changes: Nearby confirmed fists toggle one ball into two or two into one.
  Reopening rearms; held fists change mode once. Both directions preserve the
  chord and root lock and suppress pending root toggles. M remains a merge shortcut.
  Updated the on-screen hint, tutorials, explanation, vision and feature documents.
- Verification: New merge assertions failed before the change and pass afterward.
  Final instrument suite: 58 passed, 16 subtests passed, including three successive
  toggle cycles, loss/reopen, raw flicker, alternating hand inference and JSONL replay.
  Ruff lint/format, mypy and targeted whitespace checks passed. Inspected the
  two -> one -> two preview at output/anthony-instrument/fist-split-merge/comparison.png.
  Synthetic controller p95 0.048ms; each nearby closure changed mode in about 0.36s.
- Local state: Prior work preserved; no pushes or website changes. No module/data-flow
  changes, so no graph refresh for this small mapping change under constitution VIII.
- Outstanding: Restart Python and retest live; this does not measure model accuracy.

## 2026-10-11 - Ordered hand chord selection without love/heart

- State: Selected mappings implemented and validated locally; the complete pair
  catalogue remains a design task, and live performer/listening retest is pending.
- Decisions: Anthony chose right thumb up + left thumb down for minor-major 7,
  the reverse for dominant 7; right Victory + left palm for dim7, left Victory
  + right palm for m7b5. He excluded the love/heart sign entirely.
- Changes: Ordered body-hand pairs take priority over supported single-hand
  shortcuts, preserve root lock and existing dwell, and add correct dim7/m7b5
  intervals, symbols and local voicings. ILoveYou cannot select quality or rearm
  fist controls. Crossing hands retains body identity. Both Victory signs hold quality.
  Updated the on-screen quality hint before commit to reflect the new mappings.
- Capacity: Five non-fist signs per hand yield 25 pair slots, potentially 300
  chords at 12 roots once every slot has a distinct assigned quality. Current
  implemented catalogue is eight qualities x 12 roots = 96 chords. Remaining
  assignments require user decisions; existing shortcuts have not been replaced
  with an invented 25-quality catalogue.
- Verification: 62 tests and 20 subtests passed; Ruff lint/format and mypy passed.
  After correcting the help text, all seven visual tests and its lint/format checks passed.
  Reachability covers every start/destination among all 96 chords. Synthetic
  2400-frame run: controller p95 0.0193ms, chord-change p95 0.206ms (<5ms budget).
  See output/anthony-instrument/ordered-hand-chords/summary.json and feature evidence.
- Local state: Prior work preserved; no pushes or JavaScript changes. This extends
  existing mapping/catalogue tables within unchanged modules/data flow; no graph
  refresh for a minor mapping change under constitution VIII.
- Outstanding: Restart Python to try the new signs. Live gesture reliability,
  listening acceptance and the remaining pair assignments are not yet validated.

## 2026-10-11 - Complete 25-pair jazz chord catalogue

- State: Approved map implemented and validated locally; performer camera/listening
  acceptance remains pending. This completes the next catalogue step in Python.
- Decisions: Anthony approved all 25 cells, changed left-hand shortcuts, complete
  recognized pairs and fuller five/six-note voicings. Point = index up with other
  fingers curled and thumb tucked. Ordered thumb/Victory meanings are preserved.
- Changes: 25 qualities × 12 roots = 300 selectable chords, including sixths,
  ninths, thirteenths, m11, suspended, augmented and altered chords. Both reliable
  signs select an exact cell; incomplete/unknown/fist/heart pairs hold quality.
  Both palms retain the 1.5s major reset. Root selection and fist controls remain
  independent. Six oscillator slots sound every defined tone; bounded assignment
  replaces factorial voice leading while preserving its musical priorities.
- Verification: 68 tests and 45 subtests passed, including all 90,000 start/target
  transitions, exact exhaustive-search parity for seeded three-to-six voice cases,
  all 300 chord audio outputs, locked roots, gesture stabilization and JSONL replay.
  Ruff lint/format and mypy pass. Inspected the 25-cell contact sheet and C13 preview.
  Synthetic controller p95 0.104ms, chord-change p95 0.145ms and six-voice change
  p95 0.303ms (<5ms budget); inputs and artifacts are recorded in feature evidence
  and output/anthony-instrument/jazz-catalogue/summary.json.
- Documentation: Updated approved chord chart, tutorials, quickstart, vision,
  explanation, spec, plan, decisions, tasks and validation evidence.
- Local state: No new push or JavaScript changes. Completed one local AST graph
  refresh (1,342 nodes, 2,206 edges, 150 communities, no API cost) for the changed
  voicing architecture/audio dependencies; absolute-path CLI retry succeeded.
- Outstanding: Restart Python and retest both-hand combinations on camera; listen
  to the fuller extensions. Automated results do not establish model accuracy or
  performer acceptance. Additional jazz alterations, MIDI and spells remain future work.
## 2026-10-13 - JavaScript instrument translation and iPhone camera server

- State: Implemented and validated locally; actual iPhone/performer/listening
  acceptance remains pending. Explicit Stage 2 authorization is recorded in
  specs/001-anthony-instrument/web-port.md.
- Branch: Remained on anthony-explorations. Merged fetched main's recording,
  pose export and iOS audio updates locally at 83433fc, preserving the current
  constitution and Spec Kit helpers. No pushes, deployment or MIDI/Ableton port.
- Changes: Browser instrument mode preserves persistent root lock, split/merge,
  fist+palm ownership/area/gain, 12 roots × 25 qualities, bounded six-tone voice
  leading, interval/octave control and midpoint mode. Added touch/keyboard controls,
  chord/interval charts, corrected body-hand identities, confidence-gated wrist
  geometry, raw/confirmed gesture feedback, six audio slots and native tone.
  Existing web modes/mixer/drums/recording remain available; signs are reserved
  for instrument controls in the new mode. Stop clears stale visuals.
- iPhone: live.py --phone creates/reuses local OpenSSL certificates and serves
  HTTPS plus a certificate setup page. Tracking and sound run on the iPhone;
  rear camera, lite model and 640×480/30fps capture are defaults. Certificate
  installation/full trust is manual; private keys remain outside the served tree.
- Verification: 56 Node tests, 4,020 native replay observations and all 90,000
  catalogue transitions pass; 123 affected pytest tests + 240 subtests pass;
  changed Python lint/format/types pass. Browser smoke and 13 upstream recording
  groups pass. Inspected phone/desktop previews; native six-note C13 render is
  finite/unclipped (peak 0.27312, RMS 0.08752). Core desktop p95 ≈0.006ms (<5ms).
- Baseline limitations: Full pytest still has the two documented Windows Spec Kit
  newline failures; full Ruff reports 27 untouched upstream test-script issues.
  Affected checks pass. Detailed commands/results/artifacts are in feature evidence.
- Documentation: Updated tutorials, README, vision, explanation, decisions,
  quickstart, spec/plan authorization links, port contract, tasks and evidence.
  Generated assets stay in output/.
- Graphify: Completed one local AST refresh via the module CLI: 1,675 nodes,
  3,006 edges and 164 communities, no API cost. The launcher trampoline was
  unavailable; the installed Python module successfully queried and updated it.
- Outstanding: Actual iPhone CA setup, Safari camera/gesture trials, listening,
  heat/FPS and movement-to-sound latency. Browser estimates are not measured
  end-to-end latency. Spells, games and true 3D remain future scope.

## 2026-10-13 - Desktop Web MIDI routing to Ableton

- State: Implemented on codex/anthony-web-implementation, then integrated into
  ableton at Anthony's explicit commit/push request; live
  driver/Ableton and individual desktop-browser acceptance remain pending.
- Authorization: Anthony requested desktop Chrome/Edge/Firefox routing,
  chose both full chord/root-only modes, and deferred phone MIDI. Work uses
  the constitution's Python-first then explicitly requested JS workflow.
- Changes: Ableton section with Connect/refresh, explicit port/channel,
  all voiced notes or one root note, browser/MIDI/both sound routes, CC11
  expression and panic. Sustained/common notes avoid frame retriggers.
  Releases on loss/stop/background/reset/configuration/port changes/errors;
  500ms stale-frame watchdog. No backend required for hosted desktop MIDI.
  Recording metadata includes MIDI settings; browser audio exports exclude Ableton.
- Verification: 47 affected Python tests + 32 subtests, 68 Node tests,
  changed lint/format and configured mypy pass. Browser/recording smoke passes
  with synthetic MIDI/camera/model, including actual browser audio routing.
  Routing p95 ~0.0022ms (<1ms budget), not end-to-end audio latency.
- Documentation: Desktop contract, tutorial/setup links, decisions, quickstart,
  evidence and tasks updated. No new root files or runtime dependencies.
- Outstanding: T074 real virtual-port/Ableton/Firefox permission/listening/latency
  trial; T075 define quality hand gestures' effect in root-only MIDI mode;
  T076 later phone bridge. Local AST graph refresh completed: 1,730 nodes,
  3,094 edges, 162 communities, AST-only with no API cost. Integration refresh
  on ableton: 1,845 nodes, 3,438 edges and 164 communities, also AST-only.
  Integrated branch checks: 118 Python tests + 38 subtests, 68 Node tests,
  browser/recording smoke, lint/format/mypy pass. Native MIDI files remain intact;
  web Python reference/test files are renamed
  to avoid collisions. User authorized commit and push to fork/ableton; no deployment.

## 2026-10-13 - Remove separate upstream recording work

- State: Cleanup validated locally; branch isolation requested for all three Anthony branches.
- Changes: Selectively undo Samir recording/pose ZIP/microphone additions and their
  assets/metadata/audio-session helpers. Restore ordinary media recording, retaining
  Anthony instrument, ball/hand controls, phone server and MIDI on existing branches.
- Governance: .specify and .agents match pre-merge 1ee972f; no Samir Spec Kit
  changes survived. Preserve our installation and all prior commits. AGENTS.md now
  requires explicit authorization for specific upstream imports.
- Verification: 68 Node tests and real-browser smoke pass on ableton, including
  gestures/MIDI and restored video/audio recording. Core modules/phone/native MIDI
  are unchanged. Scope/audit is in upstream-isolation.md.
- Publication: Local cleanup commits only; no upstream or remote-history rewrite.
- Completed all three local branch cleanups; web branch verifies 56 Node tests
  plus browser/media recording, and exploration verifies 59 Python tests +
  32 subtests. Governance directories match 1ee972f on every branch.
  Ableton AST refresh completed: 1,743 nodes, 3,180 edges, 166 communities.
