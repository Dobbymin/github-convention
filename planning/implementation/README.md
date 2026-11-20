# Implementation Graph

This graph traces every Functional Requirement ID in `PRD.md` to one independently verifiable implementation node. Node contracts are stored in `nodes/`; `graph.json` is the machine-readable source and `graph.mmd` renders the hard-dependency DAG.

## State and execution

The initial target is N01, after a GitHub implementation Issue is confirmed or created and the user approves it. No implementation, GitHub Issue, branch, tool installation, hook, or CI mutation is part of this graph-initialization run. All nodes currently remain `blocked` until the approved Issue exists; dependency-free nodes become schedulable after that gate.

Runtime graph state belongs under `.harness/state/active/` and is excluded from Git. Graph definitions and node contracts are Git-tracked. Product runtime state remains separately defined by `SPEC.md` under `.github-convention/state/`.

## Requirement and priority policy

The coverage map preserves all PRD `FR-*` IDs and their priorities. SC acceptance evidence remains traceable through the linked FR contracts and node evidence fields. P0 foundation/install nodes come first; P1 GitHub/orchestration nodes follow their actual data and interface dependencies; P2 operations and ecosystem work remains gated behind the relevant merged-workflow or distribution capability.

## Conflict audit

No normative conflict was found among PRD, SPEC, ROADMAP, and `docs/decision-register.md`. ROADMAP's Epic dependency sketch implies a broad delivery order; this graph narrows edges to actual technical prerequisites. The root `decision-register.md` is byte-identical to the requested `docs/decision-register.md`. Product run state and graph execution state use distinct paths and purposes.

## Gate protocol

Before marking a node `passed`, verify every acceptance criterion, run its listed commands, inspect the diff against `allowed_files`, and record command output/log paths as evidence in runtime state. `passed` outputs freeze. Any later modification requires an explicit dependent revalidation node and rerun of affected gates. Reversible changes need tests and diff review; recoverable changes also need backup/ownership evidence and independent review; irreversible remote or destructive actions require explicit user approval.
