# Graph Report - .  (2026-09-30)

## Corpus Check
- 68 files · ~84,032 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 573 nodes · 1049 edges · 40 communities (27 shown, 13 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 39 edges (avg confidence: 0.63)
- Token cost: semantic input/output usage unavailable (the agent tool exposes no usage counts). AST extraction uses no API tokens.

## Community Hubs (Navigation)
- [[_COMMUNITY_Dance Music Methods|Dance Music Methods]]
- [[_COMMUNITY_Offline Audio Synthesis|Offline Audio Synthesis]]
- [[_COMMUNITY_Pose Sonification Pipeline|Pose Sonification Pipeline]]
- [[_COMMUNITY_KaTeX Formula Parsing|KaTeX Formula Parsing]]
- [[_COMMUNITY_Live Audio Harmony|Live Audio Harmony]]
- [[_COMMUNITY_KaTeX Rendering Styles|KaTeX Rendering Styles]]
- [[_COMMUNITY_Live Instrument Controls|Live Instrument Controls]]
- [[_COMMUNITY_KaTeX Macro Expansion|KaTeX Macro Expansion]]
- [[_COMMUNITY_Live Motion Features|Live Motion Features]]
- [[_COMMUNITY_Camera Display Controls|Camera Display Controls]]
- [[_COMMUNITY_KaTeX Rendering Core|KaTeX Rendering Core]]
- [[_COMMUNITY_Specification Workflow Skills|Specification Workflow Skills]]
- [[_COMMUNITY_Offline Motion Processing|Offline Motion Processing]]
- [[_COMMUNITY_Specification Script Utilities|Specification Script Utilities]]
- [[_COMMUNITY_Graphify Extraction Tools|Graphify Extraction Tools]]
- [[_COMMUNITY_Project Quality Standards|Project Quality Standards]]
- [[_COMMUNITY_Offline Chord Harmony|Offline Chord Harmony]]
- [[_COMMUNITY_Hand Tracking Runtime|Hand Tracking Runtime]]
- [[_COMMUNITY_KaTeX DOM Construction|KaTeX DOM Construction]]
- [[_COMMUNITY_Motion Sound Mapping|Motion Sound Mapping]]
- [[_COMMUNITY_KaTeX Markup Serialization|KaTeX Markup Serialization]]
- [[_COMMUNITY_KaTeX Scoped Settings|KaTeX Scoped Settings]]
- [[_COMMUNITY_Hip Bounce Tracking|Hip Bounce Tracking]]
- [[_COMMUNITY_Hand Gesture Features|Hand Gesture Features]]
- [[_COMMUNITY_KaTeX Node Rendering|KaTeX Node Rendering]]
- [[_COMMUNITY_KaTeX Attribute Rendering|KaTeX Attribute Rendering]]
- [[_COMMUNITY_Feature Branch Creation|Feature Branch Creation]]
- [[_COMMUNITY_KaTeX Element Attributes|KaTeX Element Attributes]]
- [[_COMMUNITY_KaTeX Text Elements|KaTeX Text Elements]]
- [[_COMMUNITY_KaTeX Markup Elements|KaTeX Markup Elements]]
- [[_COMMUNITY_Graph Navigation Guidance|Graph Navigation Guidance]]
- [[_COMMUNITY_Local Live Server|Local Live Server]]
- [[_COMMUNITY_KaTeX Range Utility|KaTeX Range Utility]]
- [[_COMMUNITY_KaTeX Range Construction|KaTeX Range Construction]]
- [[_COMMUNITY_GitHub Pages Deployment|GitHub Pages Deployment]]

## God Nodes (most connected - your core abstractions)
1. `handler()` - 30 edges
2. `Vn` - 27 edges
3. `Hn` - 25 edges
4. `Engine` - 18 edges
5. `$()` - 18 edges
6. `O` - 18 edges
7. `htmlBuilder()` - 15 edges
8. `Dance2Music Methods` - 15 edges
9. `p` - 14 edges
10. `out_dir()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `Requirements quality checklists` --semantically_similar_to--> `Graph integrity diagnostics`  [INFERRED] [semantically similar]
  .agents/skills/speckit-checklist/SKILL.md → .claude/skills/graphify/SKILL.md
- `_twofive()` --indirect_call--> `stems()`  [INFERRED]
  synths.py → motion.py
- `Scientific Media Runtime Dependencies` --conceptually_related_to--> `Dance2Music`  [INFERRED]
  requirements.txt → README.md
- `Asymmetric Bounce Template Proposal` --references--> `Bayesian Hip Bounce Tracking`  [EXTRACTED]
  IDEAS.md → web/methods.html
- `Offline Mapping Matrix Proposal` --references--> `Movement to Sound Mapping Matrix`  [EXTRACTED]
  IDEAS.md → web/methods.html

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Shared mathematical explanations** — web_about_standalone_methods, web_index_comparison_page, web_live_index_live_instrument, web_methods_methods [INFERRED 0.95]
- **Movement to sound contracts** — readme_mediapipe_pose, web_methods_motion_cleaning, web_methods_savitzky_golay_derivatives, web_methods_laban_efforts, web_methods_synthesis_primitives [EXTRACTED 1.00]

## Communities (40 total, 13 thin omitted)

### Community 0 - "Dance Music Methods"
Cohesion: 0.07
Nodes (46): Asymmetric Bounce Template Proposal, Ball Between the Hands, Unbuilt Dance Instrument Ideas, Offline Mapping Matrix Proposal, Dance2Music, Accent State and Energy Signals, Six Discovered Dance Shapes, MediaPipe Pose (+38 more)

### Community 1 - "Offline Audio Synthesis"
Cohesion: 0.10
Nodes (44): find_video(), A clip by name: videos/ first, then ~/Downloads., breath(), ctrl(), ctrl_ar(), _draw_regions(), _draw_rules(), efforts() (+36 more)

### Community 2 - "Pose Sonification Pipeline"
Cohesion: 0.11
Nodes (32): Where things live. Everything big stays out of git (see .gitignore)., DanceContext, _fill_gaps(), limbs_music(), main(), music(), out_dir(), overlay() (+24 more)

### Community 3 - "KaTeX Formula Parsing"
Cohesion: 0.16
Nodes (7): c(), handler(), Hr(), m, qr(), Vn, Yt()

### Community 4 - "Live Audio Harmony"
Cohesion: 0.10
Nodes (12): cents(), Engine, gauss(), silentWav(), BY_COUNT, ChordFollower, CHORDS, readFingers() (+4 more)

### Community 5 - "KaTeX Rendering Styles"
Cohesion: 0.10
Nodes (8): P, H, htmlBuilder(), mathmlBuilder(), O, p, r, sn()

### Community 6 - "Live Instrument Controls"
Cohesion: 0.07
Nodes (25): ACTIONS, bounce, COL, custom, cv, DEFAULT_ACTIONS, DEG, drumMode (+17 more)

### Community 8 - "Live Motion Features"
Cohesion: 0.11
Nodes (13): clip(), EDGES, Features, lp(), OneEuro, PART_J, PARTS, periodicity() (+5 more)

### Community 9 - "Camera Display Controls"
Cohesion: 0.16
Nodes (21): $(), applyMix(), applySens(), draw(), drawRegions(), exists(), handReadout(), line() (+13 more)

### Community 10 - "KaTeX Rendering Core"
Cohesion: 0.13
Nodes (10): $e(), It(), je(), N(), Or(), qt(), Rr(), Rt() (+2 more)

### Community 11 - "Specification Workflow Skills"
Cohesion: 0.21
Nodes (17): speckit-analyze, speckit-checklist, Requirements quality checklists, speckit-clarify, speckit-constitution, Project constitution, speckit-converge, speckit-implement (+9 more)

### Community 12 - "Offline Motion Processing"
Cohesion: 0.21
Nodes (16): clean(), derivatives(), diagnostic(), features(), _fill(), _hampel(), load(), main() (+8 more)

### Community 13 - "Specification Script Utilities"
Cohesion: 0.23
Nodes (13): Find-SpecifyRoot(), Format-SpecKitCommand(), Get-CurrentBranch(), Get-FeaturePathsEnv(), Get-InvokeSeparator(), Get-NormalizedPriority(), Get-Python3Command(), Get-RepoRoot() (+5 more)

### Community 14 - "Graphify Extraction Tools"
Cohesion: 0.21
Nodes (15): Graphify URL ingestion and watcher, Graphify exports and benchmark, EXTRACTED INFERRED AMBIGUOUS evidence, Graphify semantic extraction schema, Graphify cross-repository merge, Graphify post-commit hook, Graphify query path and explain, Constrained query vocabulary expansion (+7 more)

### Community 15 - "Project Quality Standards"
Cohesion: 0.22
Nodes (13): dance2music Constitution, Maintainable Boundaries, Meaningful Automated Tests, Numerical and Integration Correctness, Readable Explicit Python, Reproducible Environments, Requirements Quality Checklist, Constitution Template (+5 more)

### Community 16 - "Offline Chord Harmony"
Cohesion: 0.24
Nodes (12): chords(), chords6(), main(), Per frame: which of the six regions the hands are in ('' if unsure)., Held chord per frame (after the dwell) and its voice-led voicing., Per frame: which rule the pose satisfies ('ii', 'V', 'I' or '')., Held chord per frame after the dwell, starting on I.      `alt_weight`: if giv, Place pitch classes on the voices, least total motion, inside [lo, hi]. (+4 more)

### Community 18 - "KaTeX DOM Construction"
Cohesion: 0.18
Nodes (3): kt(), Q, ut

### Community 19 - "Motion Sound Mapping"
Cohesion: 0.24
Nodes (9): loop(), applyPreset(), BASE, clip(), defaults(), DESTS, evaluate(), PRESETS (+1 more)

### Community 20 - "KaTeX Markup Serialization"
Cohesion: 0.20
Nodes (3): dt, K, toText()

### Community 23 - "Hand Gesture Features"
Cohesion: 0.33
Nodes (6): J, d2(), fingerState(), GESTURES, HAND_EDGES, HS

### Community 24 - "KaTeX Node Rendering"
Cohesion: 0.29
Nodes (3): ct(), mt(), Z

### Community 30 - "Graph Navigation Guidance"
Cohesion: 0.67
Nodes (3): Graphify Agent Guidance, Knowledge Graph Navigation, Graphify Claude Guidance

## Knowledge Gaps
- **48 isolated node(s):** `B`, `TRACKED`, `REF`, `HS`, `SIX` (+43 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **13 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `P` connect `KaTeX Rendering Styles` to `Live Motion Features`, `Live Instrument Controls`?**
  _High betweenness centrality (0.073) - this node is a cross-community bridge._
- **Why does `p` connect `KaTeX Rendering Styles` to `Camera Display Controls`, `KaTeX Rendering Core`, `KaTeX Formula Parsing`, `Live Audio Harmony`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **Why does `htmlBuilder()` connect `KaTeX Rendering Styles` to `KaTeX Rendering Core`, `KaTeX Formula Parsing`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `handler()` (e.g. with `c()` and `m`) actually correct?**
  _`handler()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Where things live. Everything big stays out of git (see .gitignore).`, `A clip by name: videos/ first, then ~/Downloads.`, `MediaPipe pose per frame → landmarks.npz (T, 33, 4: x, y, z, vis).` to the rest of the system?**
  _89 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Dance Music Methods` be split into smaller, more focused modules?**
  _Cohesion score 0.06763285024154589 - nodes in this community are weakly interconnected._
- **Should `Offline Audio Synthesis` be split into smaller, more focused modules?**
  _Cohesion score 0.09898989898989899 - nodes in this community are weakly interconnected._
## Extraction Integrity Audit

- 48 dangling endpoint edges: Python external imports reference dependencies without node records; these edges are omitted by the graph builder.
- 114 same-endpoint edges collapsed in the default undirected graph, including 98 exact duplicates. Most repeated edges are from bundled KaTeX; some distinct relations and locations also collapse.
- Three inferred Python-to-JavaScript calls were excluded: the AST extractor matched short names in synths.py with unrelated KaTeX symbols. See extraction-audit.json.
- Bundled KaTeX is included in the requested full-folder corpus and occupies many communities and top-degree nodes.
- Remaining inferred edges are hypotheses requiring source verification. The graph is usable with these documented limits.
- Semantic analysis used this Codex session. Measured token counts and dollar cost are unavailable; zero placeholders are not measured free semantic extraction.
