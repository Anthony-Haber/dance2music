---
type: "query"
date: "2026-10-11T17:29:28.741486+00:00"
question: "the fist detection is very bad what should a fist look like and is the code doing the calculation or the model knows what a fist looks like"
contributor: "graphify"
outcome: "useful"
source_nodes: ["GestureState", "FistGate"]
---

# Q: the fist detection is very bad what should a fist look like and is the code doing the calculation or the model knows what a fist looks like

## Answer

Query terms: fist gesture tracking. Verified instrument/tracking.py GestureState and observations plus instrument/controller.py FistGate: MediaPipe canned Closed_Fist classification determines fists, with confidence >=0.5 and candidate confirmation 0.35s. Finger openness geometry does not classify fists. Controller requires rearm then closure and 0.25s arbitration; nearby paired fists split. Visible landmarks do not imply recognized gesture. Current recognition performance cause requires raw label and crop observations.

## Outcome

- Signal: useful

## Source Nodes

- GestureState
- FistGate