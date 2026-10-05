# Decisions made during ideas 0–2 implementation

2026-10-04. This file separates Anthony's answers from implementation defaults.

## Confirmed by Anthony

- Python first; no JavaScript translation or pushes.
- Persistent root-only toggle; nearby split suppresses toggle; split persists.
- Joseph-inspired 2D visual temporarily; true 3D and animator assets deferred.
- During this task: all 12 roots, six absolute gesture-quality mappings listed in
  spec.md, either hand locks, M merges, stable reopen rearms after tracking loss.

## Agent choices, provisional and open to revision

| Choice | Reason / consequence |
| --- | --- |
| Native OpenCV window, MediaPipe Tasks, NumPy and optional sounddevice | Uses existing technology; avoids browser port and new GUI framework. |
| Ring C at screen right, chromatic roots clockwise, 0.25-torso central dead zone | Every root reachable; denser than six regions. Screen is mirrored before inference/display, so ring and display agree. |
| 0.35 s closure/quality/root dwell, 0.20 s reopen, 0.25 s arbitration, 0.20 s maximum frame gap | Reduces accidental actions; fist response around 0.60 s is intentionally slower and needs human tuning. |
| Nearby means wrist separation <= 0.6 torso lengths | Scale independent but a provisional threshold. |
| Right-labeled hand wins conflicting quality selections | Deterministic; either hand works when the other has no quality gesture. Hand IDs are model labels on the mirrored image. |
| Unknown/low-confidence gestures never rearm or select quality | Avoids flicker triggering extra toggles; deliberate recognized non-fist is required. |
| Startup fists do nothing until reopened; loss preserves chord/lock/split but cancels pending actions | Avoids phantom toggles; R resets to C major/unlocked/merged. |
| No audio while both reliable hand positions and torso are unavailable | Prevents stale musical output. Split with one hand missing shows only the present ball but stays muted. |
| Split radii are merged radius / sqrt(2), with shared spacing gain | Conserves visual area and avoids doubling loudness. No separate music per ball yet. |
| Six qualities only, minor-major means minor-major seventh | Covers the explicitly approved mapping; arbitrary extensions and inversions remain future catalogue work. |
| Triads have three voices, sevenths four; root at MIDI 48–59 initially | Small predictable local synth; voicings stay 48–83 and move minimally where possible. Plugin voicings are not assumed. |
| Ordinary recognized open palm selects major as well as rearms | Consequence of the approved absolute mapping; reopening can therefore change a minor chord back to major. |
| Demo, replay, video and camera modes share the same controller | Makes state behavior testable without hardware and permits deterministic reproduction. |

Direct dependency/model downloads are setup, not web research, and upload no
project content. No runtime downloads occur. Tests do not need model files.
Any unexpected limitations found during validation will be recorded in evidence.md.

## Resume validation, 2026-10-05

The existing choices above were retained. Corrections enforce the existing contracts:
WAV events start at their observation timestamps, the configured root dead-zone guide
matches selection, invalid/nonfinite tracking scores are rejected, malformed replay
input reports its line, and sample rates must be valid integer Hz. Audio export uses
bounded chunks even across long frame gaps. No new gesture or musical mapping was chosen.

Automated and device-boundary validation is recorded in evidence.md. The camera smoke
had no visible hands/body; live gesture usability and subjective listening are still
human acceptance checks. Thresholds are unchanged pending that review.
