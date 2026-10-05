# dance2music Constitution

## Core Principles

### I. Readable, Explicit Python

New or materially changed Python code MUST use descriptive names, explicit imports, and small
functions with a clear responsibility. Public functions and module boundaries MUST declare type
annotations; NumPy inputs and outputs MUST also document shapes, units, and missing-value semantics
when annotations cannot express them. Non-obvious algorithms MUST explain their assumptions and
rationale. Formatting and lint rules MUST be consistent within the project; changed code MUST pass
the configured checks. Abstractions and dependencies MUST solve a stated requirement rather than
anticipate hypothetical needs. These rules make scientific code understandable and reviewable.

### II. Meaningful Automated Tests

Changes to executable behavior MUST include automated tests proportionate to their risk. Tests MUST
assert observable results or documented invariants, rather than repeat implementation details.
Bug fixes MUST include a regression test demonstrated to fail before the fix whenever the defect
can be reproduced automatically. Tests MUST cover relevant normal, boundary, and failure cases.
Core tests MUST run without cameras, audio devices, private video clips, external repositories, or
network access; use small synthetic fixtures and isolate external effects. Randomized tests MUST
use explicit seeds. Documentation-only and formatting-only changes do not require new tests.
Passing checks provide evidence of behavior; a coverage percentage alone does not establish it.

### III. Numerical and Integration Correctness

Changes to pose cleaning, motion features, harmony, or synthesis MUST test the affected numerical
contracts with explicit, justified tolerances. Applicable cases MUST include missing or
low-confidence landmarks, short sequences, invalid timing, and stillness. Tests MUST distinguish
intentional missing values from unintended NaN or infinite outputs. Changes to boundaries between
pipeline stages MUST include integration tests for affected array shapes, units, timestamps, file
schemas, or musical events. Changes affecting live behavior MUST document causal assumptions and
measure latency against a stated budget on representative inputs. Numerical optimization MUST
preserve tested behavior or document and validate an intentional change. These checks protect the
relationship between movement and sound as the pipeline evolves.

### IV. Maintainable Boundaries and Documentation

Computational logic MUST be separable from CLI parsing, file access, camera capture, and audio
playback so it can be tested independently. Shared rules and thresholds MUST have one authoritative
definition with documented units and purpose. New integrations MUST keep optional dependencies at
explicit boundaries; importing computational modules MUST NOT start devices, download resources,
or run the processing pipeline. Changes to public commands, configuration, output formats, or
algorithm assumptions MUST update the relevant documentation in the same change. Breaking
contracts MUST include migration instructions. Refactoring MUST preserve behavior unless an
intentional behavior change is specified and tested. These boundaries reduce the cost of reuse
and future changes.

### V. Reproducible Environments and Diagnosable Failures

Python support versions, runtime dependencies, development dependencies, and setup commands MUST
be declared in project metadata or documentation. Dependency changes MUST record a tested version
or compatible range and a reproducible installation method. Experiments and renders used to
justify a change MUST record their inputs, parameters, random seeds where applicable, and relevant
dependency versions. File and device resources MUST be released reliably, including on failure.
Exceptions MUST be caught only where recovery or useful context can be provided; failures MUST
identify the operation and actionable cause rather than silently produce plausible output.
CLI failures MUST return a nonzero exit status. Reproducibility and clear errors make maintenance
possible beyond the original development machine.

### VI. Local Work Until Explicit Authorization

Project work, including source changes, documentation, commits, and generated artifacts, MUST
remain local unless the user explicitly authorizes an external action. Agents MUST NOT push
commits, publish or deploy work, upload project content, or create remote pull requests or issues
without that authorization. Informing the user of a planned action does not itself authorize it.
Authorization MUST apply only to the action and scope the user requested; permission to pull
updates or make local commits does not authorize a push. This preserves the user's control over
when project work leaves the local workspace.

### VII. Feature Implementation Status Records

Agents MUST update `status.md` at the repository root after feature implementation work,
before its handoff. A feature is a coherent capability, such as one implemented idea in
`docs/ANTHONY_IDEAS.md`. Each entry MUST identify the feature, date, completion state, changes made,
verification performed and its results, and any outstanding work or blockers. Partial or
blocked implementation MUST be recorded accurately rather than marked complete. Existing
history MUST be preserved. Individual commands and internal steps MUST NOT receive separate
entries.

Agents MUST NOT update `status.md` merely because the user sends a request. Questions,
planning, documentation-only edits, constitution amendments, and Git operations MUST NOT
create status entries unless the user explicitly requests one. This keeps the status history
focused on implemented features and their remaining work.

### VIII. Graphify-First Codebase Navigation

When searching or investigating the codebase, agents MUST consult the installed graphify skill
and use the project's knowledge graph first when `graphify-out/graph.json` exists. Start with
`graphify query "<question>"`; use `graphify path "<A>" "<B>"` for relationships and
`graphify explain "<concept>"` for focused concepts. For broad navigation, agents MUST use
`graphify-out/wiki/index.md` when available. Agents MUST use the resulting file locations to
focus source reads and searches, and verify implementation details against the source before
editing. Read `graphify-out/GRAPH_REPORT.md` only for broad architecture reviews or when scoped
queries provide insufficient context. Dirty graph files MUST NOT be a reason to skip graphify.
If the graph or tool is unavailable, the graph is the subject of a stale-output investigation,
or the user explicitly requests another approach, agents MUST record the reason and use focused
source searches. After modifying code, agents MUST run `graphify update .` to refresh the graph
locally using AST extraction without API cost. This reduces unnecessary browsing while keeping
codebase relationships available for future tasks.

### IX. User Decisions on Design Dilemmas

Whenever a design dilemma arises, agents MUST prompt the user with the competing options,
their relevant tradeoffs, and a recommendation. Agents MUST wait for the user's decision before
implementing work that depends on that choice; independent work may continue. A design dilemma
is an unresolved choice between viable approaches with tradeoffs in architecture, behavior,
user experience, interfaces, dependencies, or maintainability. Agents MUST NOT silently settle
such a dilemma through an assumption. Previously supplied user decisions MUST be honored without
asking for the same decision again. The chosen option and its rationale MUST be recorded in the
relevant design documentation or task status entry. This keeps consequential design choices
under the user's control.

### X. Python First, Web Translation by Explicit Request

New feature development MUST follow two separate stages. Stage 1 implements, runs, and validates
the feature locally in Python, with its behavior, relevant interfaces, test evidence, and design
decisions recorded. A Python server hosting JavaScript feature logic does not satisfy this stage.
Stage 2 translates the validated behavior into the JavaScript web application only after the
user explicitly requests that translation. Agents MUST NOT start a web port, modify web feature
logic as part of the Python implementation, or treat successful Python validation, a roadmap,
or a general implementation request as authorization to translate. A translation request MUST
identify the feature or scope it authorizes; unrelated features remain in Stage 1. Before an
authorized port, the plan MUST identify Python behavior to preserve and the browser-specific
differences to verify. Completing a local web port does not authorize publishing or deployment.
This separates experimentation from platform adaptation and avoids premature duplicate work.

### XI. Compact After Each Completed Feature

After completing each feature-sized task, such as one implemented idea in `docs/ANTHONY_IDEAS.md`,
agents MUST run `/compact` before starting the next feature. Individual commands, tests,
implementation steps, and checklist items do not each trigger compaction. Before compaction,
agents MUST save the completed feature's outcome, verification, decisions, and outstanding work
in `status.md` and relevant feature documentation so work can resume accurately.

Agents MUST use the session's supported compaction command when available. If the session does
not expose a way to invoke `/compact`, agents MUST state that limitation and ask the user to run
the command; printing `/compact` or writing a summary MUST NOT be reported as executed compaction.
This keeps conversation context focused between completed features without losing project state.

### XII. Coherent File Organization

New files MUST be grouped by purpose within the existing project structure. Agents MUST reuse
an appropriate package, directory, or document before adding another location. New top-level
files MUST have a project-wide entry-point, configuration, or navigation purpose that is
recorded in the change rationale. Feature-specific implementation, helpers, tests, and design
material MUST live with their corresponding package or established purpose-specific directory.

The original main branch is the reference for a coherent, readable repository explorer.
Changes MUST avoid scattering related files, duplicating instructions or authoritative records,
and leaving temporary review or generated artifacts among maintained source files. Documents
MUST have distinct purposes and link to authoritative content instead of copying it. Tool-required
paths and the locations explicitly mandated by this constitution remain valid.

Plans and reviews MUST check file placement and explain any new directory or top-level file.
Existing clutter MUST be addressed through a scoped, authorized reorganization that preserves
working commands, imports, links, and tool discovery; this principle alone does not authorize
moving unrelated files. These rules keep navigation understandable as the project grows.

## Python and JavaScript Project Constraints

The analysis and orchestration code uses Python; the web application uses JavaScript with HTML
and CSS. Work in each area MUST use its established language. Python changes MUST use an
explicitly documented Python version compatible with the required scientific and media
dependencies. Python-specific requirements apply to Python code; browser JavaScript MUST use
the web application's documented browser support and applicable tooling. Language-independent
requirements for correctness, testing, boundaries, and documentation apply to both. Browser or
native integrations MUST preserve documented contracts with the Python pipeline.

Development MUST use an isolated Python environment. The project MUST document repeatable
commands for tests, formatting, linting, and type checking; checks MUST be applied to changed
Python code. Pytest is the default runner for new Python tests unless an established project
runner already meets these requirements. Introducing or changing tools MUST include their
configuration and setup instructions in the implementing change.

Source clips belong in `videos/`, and generated datasets, figures, audio, and renders belong in
`output/`; both directories MUST remain excluded from version control. Automated tests MUST use
small synthetic or redistributable fixtures. Optional integrations such as the rope music engine
MUST declare setup requirements and fail with actionable guidance when unavailable.

Spec Kit MUST use its official Bash helpers on macOS/Linux and official PowerShell helpers
on Windows, with one shared constitution, template stack, skill set, and feature document tree.
Agents MUST select commands for the current platform rather than require another platform's
shell or hand-translate helper logic. Portable project references MUST use repository-relative
paths with forward slashes; machine-local feature selection MUST remain separate from shared
feature documents. Both helper sets MUST be kept at compatible upstream versions and validated
against the same observable contracts when changed.

## Development Workflow and Quality Gates

Before implementation, each change MUST identify its intended behavior, affected contracts, and
verification approach. Feature plans MUST assess compliance with these principles and identify
any justified exceptions. Changes MUST remain focused on the stated requirement.

Feature plans MUST separate Stage 1 local Python development from Stage 2 JavaScript translation.
Without explicit user authorization for Stage 2, the active implementation scope MUST end at
Python validation and its documentation. Any proposed web adaptation MUST remain deferred.

Feature implementation handoff MUST include the `status.md` update required by principle VII.
Other requests MUST NOT trigger a status update unless explicitly requested. Every handoff MUST
check that any external project action had explicit user authorization. Local completion MUST
NOT imply permission to publish the result.

Before merging or declaring implementation complete, the author MUST run the affected automated
tests and configured formatting, lint, and type checks, and record the results. Changes to shared
pipeline behavior MUST also run the relevant integration tests. If a check cannot run, the author
MUST record the reason and remaining verification work; unrun checks MUST NOT be reported as
passing. Manual viewing or listening MUST supplement automated checks when visual or audible
quality is affected, with the evaluated input and observation recorded.

Reviews MUST assess correctness, test evidence, interface compatibility, documentation, and
unnecessary complexity. Existing code is not presumed compliant: changes MUST avoid adding new
violations, and violations in materially changed code MUST be corrected or receive a documented
exception. Unrelated legacy cleanup MUST remain separate unless required for correctness.

## Governance

This constitution governs project specifications, plans, implementation, and reviews. Conflicts
with project guidance MUST be resolved against these principles or through an explicit amendment.
Compliance MUST be reviewed during planning and before implementation is accepted.

Amendments MUST state the proposed wording, rationale, affected practices, and any migration work.
The project maintainer MUST approve an amendment before it is adopted. Each adopted amendment
MUST update this document's version and last-amended date while preserving its original
ratification date. Dependent specifications and guidance MUST be checked for conflicts, with
required follow-up work recorded.

Versions follow semantic versioning: MAJOR for incompatible principle removals or redefinitions;
MINOR for new principles or materially expanded obligations; PATCH for clarifications without
changed obligations. Version 1.0.0 is the first adopted constitution.

Exceptions MUST record the affected rule, reason, risk, compensating verification, and a removal
condition or review date. The project maintainer MUST explicitly approve them; exceptions do not
silently amend the constitution.

**Version**: 2.1.0 | **Ratified**: 2026-09-30 | **Last Amended**: 2026-10-05
