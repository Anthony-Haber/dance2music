---
type: "query"
date: "2026-10-11T17:56:34.324213+00:00"
question: "what other hand symbols can we do, can i do different finger combinations and code detect that or do i need to train a model, because i want access to nearly all the known jazz chord transformations or at least all the basic ones. liek maj 7, min 7, 7th, majorminor7th, half diminished, diminished, 6th minor 6th 13 9th"
contributor: "graphify"
outcome: "useful"
source_nodes: ["QUALITY_GESTURES", "Tracker", "Chord", "Controller"]
---

# Q: what other hand symbols can we do, can i do different finger combinations and code detect that or do i need to train a model, because i want access to nearly all the known jazz chord transformations or at least all the basic ones. liek maj 7, min 7, 7th, majorminor7th, half diminished, diminished, 6th minor 6th 13 9th

## Answer

Expanded from graph vocabulary: gesture hand harmony quality chord landmarks. Source verified in instrument/harmony.py, models.py, tracking.py and controller.py. Native Python currently maps Open_Palm to major, Pointing_Up to minor, Victory to dominant7, Thumb_Up to major7, Thumb_Down to minor7, and ILoveYou to minor_major7. Closed_Fist is reserved for root lock and split/merge. Tracker stores 21 two-dimensional hand landmarks. Custom finger combinations can be classified through joint-angle and normalized-distance rules without training an additional model, subject to camera visibility and live validation. A trained custom classifier is an optional later approach for difficult distinctions. Broader jazz vocabulary also requires extending chord representation, voicing and gesture mappings; a compositional family-plus-extension interface is a proposal, not implemented behavior. No feature implementation requested or performed.

## Outcome

- Signal: useful

## Source Nodes

- QUALITY_GESTURES
- Tracker
- Chord
- Controller