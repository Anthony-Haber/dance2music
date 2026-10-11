# Approved complete hand-pair chord catalogue

2026-10-11. Anthony approved this 25-cell map, the changed left-hand shortcuts,
complete-pair selection and fuller five/six-note voicings.
This extends the existing Python feature; no website changes or MIDI work are included.

## Ordered gesture map

Rows are the performer's RIGHT body hand, columns are the LEFT body hand.
Point means index pointing up, other three fingers curled and thumb tucked;
V means Victory. Each cell shows a chord at root C.
The same quality applies to each of the 12 roots selected by the existing root ring.

| Right / Left | Open palm | Point | V | Thumb up | Thumb down |
| --- | --- | --- | --- | --- | --- |
| Open palm | C | Cm6 | Cm7b5 | C6 | C6/9 |
| Point | Cm | Cm11 | Cm9 | Cm13 | Cm6/9 |
| V | Cdim7 | C7b9 | Caug | C7#9 | C7sus4 |
| Thumb up | Cmaj7 | Cmaj9 | Cmaj7#11 | Cmaj13 | Cm(maj7) |
| Thumb down | Cm7 | C9 | Csus4 | C7 | C13 |

This has 25 distinct root/quality identifiers, hence 300 selectable chords.
The four ordered thumb/Victory mappings already chosen by Anthony are preserved.
The major, minor, major7 and minor7 right-hand-plus-left-palm shortcuts are also preserved.
Further independent alterations, inversions, slash basses and substitutions would
need additional controls.

To use every slot for a distinct quality, some redundant left-hand shortcuts change:
left Point + right palm becomes m6, left thumb up + right palm becomes 6, and
left thumb down + right palm becomes 6/9. Both V signs become augmented. These
changes were explicitly approved with the complete map.

Both recognized non-fist signs select their exact cell,
with the existing 0.35s quality dwell. Both open palms retain the 1.5s major dwell
so ordinary reopening does not reset the chord. Missing/unknown/low-confidence
signs hold the current quality; fist signs retain lock and ball-mode actions and
do not form chord pairs. The love/heart sign remains excluded. The root lock stays
independent of chord quality. These input rules were approved with the map.

## Musical vocabulary

The eight existing qualities are retained. Seventeen additional qualities are:
6, m6, 6/9, m6/9, maj9, m9, 9, maj13, m13, 13, m11, sus4, 7sus4, aug,
7b9, 7#9 and maj7#11. This covers a useful first jazz catalogue rather than every
possible jazz chord. Add9, augmented seventh and additional altered dominants
are examples of later extensions that are not silently assigned to these slots.

Minor sixth uses a natural sixth (Cm6 = C-Eb-G-A). A dominant ninth includes a
minor seventh (C9 = C-E-G-Bb-D), whereas Cmaj9 uses B. Suspended fourth replaces
the third; it does not add the fourth while keeping an ordinary third.

## Approved sound design

Anthony chose fuller defined voicings. The synth now has six persistent oscillator
slots; all tones in the selected definition sound. The earlier alternatives were:

- Compact jazz voicings: usually root, third, seventh/sixth and the defining color;
  intentionally omit less essential tones. For C13, C-E-Bb-A is one example.
- Fuller defined voicings: play five or six notes for extended chords; extend the
  synth and bounded voice-leading implementation. Common 13th voicings can omit
  the natural 11th; the chosen tone sets must be documented and tested.

The fuller option lets the requested ninths and thirteenths be heard together.
Local listening acceptance remains separate from numerical note validation.

### Tone sets for the new qualities

Semitone offsets from the root; extension registers are retained (9 = 14,
11 = 17, 13 = 21). Existing eight qualities retain their existing definitions.
For 13ths the fuller option omits the natural 11th; it includes both 9 and 13.

| Quality | Fuller defined voicing | Compact option |
| --- | --- | --- |
| 6 | 0,4,7,9 | same |
| m6 | 0,3,7,9 | same |
| 6/9 | 0,4,7,9,14 | 0,4,9,14 |
| m6/9 | 0,3,7,9,14 | 0,3,9,14 |
| maj9 | 0,4,7,11,14 | 0,4,11,14 |
| m9 | 0,3,7,10,14 | 0,3,10,14 |
| 9 | 0,4,7,10,14 | 0,4,10,14 |
| maj13 | 0,4,7,11,14,21 | 0,4,11,21 |
| m13 | 0,3,7,10,14,21 | 0,3,10,21 |
| 13 | 0,4,7,10,14,21 | 0,4,10,21 |
| m11 | 0,3,7,10,14,17 | 0,3,10,17 |
| sus4 | 0,5,7 | same |
| 7sus4 | 0,5,7,10 | same |
| aug | 0,4,8 | same |
| 7b9 | 0,4,7,10,13 | 0,4,10,13 |
| 7#9 | 0,4,7,10,15 | 0,4,10,15 |
| maj7#11 | 0,4,7,11,18 | 0,4,11,18 |

These are explicit project voicings; a chord symbol does not mandate a single
octave arrangement or require every implied extension to sound. Voice leading
can later redistribute octaves while preserving the chosen pitch-class set.

## Implementation and verification

instrument/harmony.py is the authoritative catalogue/map. The existing controller
accepts exact-pair selections; audio capacity derives from the catalogue's largest
voicing. Definitions, selection, rendering and device I/O remain separate.
No additional gesture model training or dependencies are required.

Read-only planning check: the existing exhaustive six-note permutation search
had p95 8.154ms across 30 identical synthetic changes on this workstation,
above the 5ms core target. Input previous notes: (48,52,55,58,62,69), destination
pitch classes: (0,4,7,10,2,9), NumPy 2.4.1. The fuller-voicing implementation replaces
the factorial search with a bounded assignment algorithm while preserving
the existing minimum total movement, maximum movement, then note-order tie policy.
This benchmark is not a camera or playback measurement. The implementation uses
bit-mask assignment costs, searches the least permissible maximum movement, and
reconstructs the lexicographically smallest optimal note tuple. An exhaustive test
oracle checks all three cost priorities for three through six voices (seed 19).

Validation covers all 25 cells and 12 roots, all 90,000 starting/destination states,
formulas/symbols, stable-pair timing, palm reset, unknown/fist/heart handling,
locked-root quality changes, stabilized gestures, JSONL replay and audio transitions.
The instrument suite passes 68 tests and 45 subtests. Synthetic controller p95 is
0.104ms, chord-change p95 0.145ms and six-voice-change p95 0.303ms, below the 5ms
core budget. See [validation evidence](evidence.md) for reproducible inputs, artifacts,
checks and remaining live performer/listening acceptance.

## Reference material

- [Open Music Theory: chord symbols](https://viva.pressbooks.pub/openmusictheory/chapter/chord-symbols/)
- [Berklee: piano voicing techniques](https://online.berklee.edu/takenote/basic-piano-voicing-techniques/)

The gesture assignments are this project's approved controls. These references explain
musical notation and voicing principles, not hand controls.
