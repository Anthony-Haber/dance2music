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

## Python and Project Constraints

Python is the primary language for analysis and orchestration. Changes MUST use an explicitly
documented Python version compatible with the required scientific and media dependencies.
Browser or native integrations MUST preserve documented contracts with the Python pipeline.

Development MUST use an isolated Python environment. The project MUST document repeatable
commands for tests, formatting, linting, and type checking; checks MUST be applied to changed
Python code. Pytest is the default runner for new Python tests unless an established project
runner already meets these requirements. Introducing or changing tools MUST include their
configuration and setup instructions in the implementing change.

Source clips belong in `videos/`, and generated datasets, figures, audio, and renders belong in
`output/`; both directories MUST remain excluded from version control. Automated tests MUST use
small synthetic or redistributable fixtures. Optional integrations such as the rope music engine
MUST declare setup requirements and fail with actionable guidance when unavailable.

## Development Workflow and Quality Gates

Before implementation, each change MUST identify its intended behavior, affected contracts, and
verification approach. Feature plans MUST assess compliance with these principles and identify
any justified exceptions. Changes MUST remain focused on the stated requirement.

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

**Version**: 1.0.0 | **Ratified**: 2026-09-30 | **Last Amended**: 2026-09-30
