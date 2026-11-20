# Product Requirements Document — GitHub Convention

**Product:** `github-convention`  
**Document type:** Product Requirements Document (PRD)  
**Version:** 1.0-draft  
**Date:** 2026-11-21  
**Status:** Ready for implementation planning  
**Related documents:** [`SPEC.md`](SPEC.md), [`ROADMAP.md`](ROADMAP.md), [`SKILL.md`](skills/github-convention/SKILL.md)

---

## 1. Product summary

`github-convention` is an installable, agent-independent AI Skill and companion cross-platform CLI. It helps AI coding agents follow a consistent, safe, and recoverable GitHub development workflow across repositories and supported coding agents.

The product has two primary deliverables:

1. **GitHub Convention Skill** — instructs a Main Agent how to inspect a repository, understand existing conventions, plan work as GitHub Issues, schedule dependent work, optionally delegate isolated implementation tasks, validate changes, create one PR per Issue, respond to review and CI feedback, and continue work after a merge or a later session.
2. **`github-convention` CLI** — performs deterministic operations that should not depend on free-form model interpretation: Agent discovery and installation, configuration validation, schema migration, hashing, safe updates, state persistence, locking, Worktree lifecycle, GitHub CLI invocation, idempotency checks, diagnostics, and structured output.

The product is designed around a strict ownership model: **the Main Agent (Orchestrator) owns planning, approvals, Git/GitHub mutations, integration, and Local State. Sub Agents are optional workers that only implement and test assigned work in isolated workspaces.**

The product is not a general project-management platform and does not require Sub Agents. Small tasks can be completed by the Main Agent alone. Parallel execution is used only when dependency, workspace, and resource analysis show that it is beneficial.

## 2. Problem statement

AI coding agents can perform substantial repository work, but workflows are often inconsistent across agents and projects. Common problems include:

- Different agents applying different branch, commit, Issue, and PR conventions to the same repository.
- Repeated project discovery consuming context and time, while stale assumptions can survive between sessions.
- Large feature requests being decomposed poorly: either too few tasks to delegate safely or too many artificial Issues created merely to increase parallelism.
- Parallel workers colliding in a shared workspace or independently mutating Git/GitHub state.
- Session termination losing orchestration details, task assignments, worker results, or recovery checkpoints.
- Duplicate GitHub Issues or other remote resources being created after retries or interrupted API calls.
- Skill updates overwriting user customizations or leaving Agent-specific copies out of sync.
- Automated agents making high-impact decisions without clear approval boundaries.
- CI, code review, secret scanning, release, and deployment behavior varying across projects.

`github-convention` addresses these problems through one portable Skill, a deterministic CLI, capability-based Agent adapters, explicit approval gates, isolated execution, and recoverable state.

## 3. Product vision and principles

### 3.1 Vision

Provide one reusable GitHub development workflow that can be installed in multiple AI coding agents, adapted to each repository's existing conventions, and used safely for both sequential and parallel development.

### 3.2 Product principles

1. **Agent-independent workflow:** core GitHub conventions do not fork by Agent. Only discovery, installation, and runtime capabilities vary by adapter.
2. **Project conventions first:** inspect existing instructions and practices before proposing changes.
3. **Issue-centric execution:** use GitHub Parent Issues, Sub-issues, native dependencies, Labels, and PRs; GitHub Projects and Milestones are not required.
4. **Sub Agents are optional:** choose Main Agent-only, sequential, or parallel execution based on task characteristics.
5. **Orchestrator is the only writer:** workers never commit, push, create or edit Issues, create PRs, merge, resolve review threads, or write shared State.
6. **Parallelism must be safe:** every worker receives an isolated writable workspace; dependencies and file overlap constrain concurrency.
7. **No implicit approval:** silence, `--yes`, non-interactive execution, or an ambiguous previous response never counts as approval for protected actions.
8. **Preserve user work:** do not overwrite or delete files, branches, worktrees, settings, or data unless ownership and safety are verified.
9. **GitHub is the remote source of truth:** query remote state before actions that depend on current Issue, dependency, PR, branch, or CI status.
10. **Local state is recoverable detail:** cache and execution state are local, regenerable or reconcilable, and excluded from Git.
11. **Privacy by default:** no telemetry or analytics; logs remain local and redact secrets.
12. **No required daemon:** work resumes on the next explicit Agent/CLI run. An optional GitHub Actions trigger may be added later.

## 4. Goals, non-goals, and success definition

### 4.1 Product goals

- G-01: Package the workflow as a standalone Skill that can be installed and used independently of a specific AI Agent.
- G-02: Provide a CLI for safe installation, update, removal, configuration, diagnostics, state, and GitHub operations.
- G-03: Support macOS, Linux, and Windows.
- G-04: Detect supported Agents and allow multi-select installation with independent Global/Project scope per Agent.
- G-05: Maintain a single Git-tracked canonical Project Skill source and deploy Agent-specific links or managed copies from it.
- G-06: Preserve existing project conventions and surface conflicts instead of silently choosing a winner.
- G-07: Decompose work into independently implementable and verifiable Issues, with meaningful dependency relationships.
- G-08: Dynamically use optional workers for independent tasks while keeping all Git/GitHub mutations with the Orchestrator.
- G-09: Recover safely after an Agent session ends, including tasks in progress and approval state.
- G-10: Automate PR preparation, self-review, quality gates, review response, and CI remediation within strict bounds.
- G-11: Protect user changes and installation integrity through SHA-256 manifests, three-way merge, backups, and conservative uninstall.
- G-12: Provide deterministic, machine-readable CLI behavior suitable for both humans and AI Agents.

### 4.2 Non-goals

- Replacing GitHub Projects, Milestones, Jira, or other project-management products.
- Requiring Sub Agents, Agent Teams, or a specific agent runtime.
- Guaranteeing that every supported Agent has native worker delegation or native workspace isolation.
- Automatically merging PRs.
- Silently modifying Branch Protection, Rulesets, hooks, CI, or installing new project tools.
- Automatically rolling back a deployment.
- Automatically creating GitHub Releases or Tags without user approval.
- Collecting product telemetry, analytics, or remote error reports.
- Acting as a general application secret manager.
- Running a permanent background process.

### 4.3 Measurable success criteria

The product will be considered successful when the following criteria are demonstrated by automated tests and controlled dogfooding. Because telemetry is prohibited, these are release/test criteria rather than remotely collected usage metrics.

| ID | Success criterion | Measurement |
|---|---|---|
| SC-01 | No protected GitHub mutation occurs without explicit approval | Approval-gate integration and E2E tests |
| SC-02 | No duplicate Issue is created after a retry or interrupted response | Idempotency fault-injection tests |
| SC-03 | No existing user file is lost during install, update, migration, or uninstall | Backup/restore and fault-injection tests on all supported OS families |
| SC-04 | Workers cannot mutate Git/GitHub or shared State through the product workflow | Worker-contract tests and tool-permission tests where supported |
| SC-05 | Every worker workspace is isolated from other writable worker workspaces | Orchestration integration tests |
| SC-06 | CLI config, state, and output contracts are stable and validated | Schema and contract tests |
| SC-07 | Baseline CI passes on macOS, Linux, and Windows | Required CI matrix |
| SC-08 | Project analysis reprocesses only changed/new source documents | Cache invalidation tests using SHA-256 fixtures |
| SC-09 | An interrupted run resumes completed and safe work without repeating completed remote actions | Kill/restart E2E tests |
| SC-10 | No telemetry or analytics traffic is emitted | Dependency inspection and network-isolation tests |

## 5. Target users and personas

### Persona A — AI-assisted developer (primary)

A developer who uses one or more coding agents across multiple repositories and wants consistent GitHub practices without manually repeating workflow instructions.

**Needs:** one installable package, project-specific customization, safe automation, explicit approval for important actions, and predictable output.

### Persona B — Main Agent / Orchestrator

The primary AI agent responsible for analyzing the repository, planning work, coordinating optional workers, validating results, and managing Git/GitHub operations.

**Needs:** concise workflow instructions, machine-readable CLI results, stable state, idempotent operations, and clear capability information.

### Persona C — Sub Agent / Worker

An optional coding agent assigned one independently scoped Issue in an isolated workspace.

**Needs:** bounded task context, acceptance criteria, interface contracts, permitted file scope, test commands, and a simple English report format.

**Restrictions:** a worker must not mutate Git/GitHub remote state, create commits, push, create PRs, or edit shared Local State.

### Persona D — Repository maintainer / team member

A maintainer who needs conventions to be versioned with the repository and shared consistently among team members.

**Needs:** Git-tracked canonical Skill and Project Config, transparent updates, existing convention preservation, and no requirement to adopt a separate project-management tool.

## 6. Product scope and priority model

Requirements use the following priority definitions:

- **P0 — Release blocker:** required for a safe and usable first public implementation.
- **P1 — Core:** required for the intended end-to-end workflow, but may follow the first CLI/Skill foundation release.
- **P2 — Expansion:** valuable follow-on capability that can be delivered after the core workflow is stable.

### 6.1 P0 — Foundation and safe installation

- Cross-platform CLI foundation and command contract.
- Skill package and independent Skill/CLI versioning with compatibility checks.
- Agent discovery, multi-select, and per-Agent installation scope.
- Canonical Project Skill source and symlink/copy fallback.
- Config schema, recursive merge, array replacement, strict validation, dry-run, text/JSON output.
- SHA-256 install manifest, safe update preview, three-way merge, backup, rollback, and conservative uninstall.
- `doctor`, `validate`, and useful error codes.
- No telemetry and secret redaction.

### 6.2 P1 — Core GitHub workflow and orchestration

- Repository convention analysis and SHA-256 cache.
- Parent/Sub-issue planning and grouped/per-Issue approval.
- GitHub native dependencies and idempotent Issue creation.
- Local State, locking, recovery, and archive management.
- Dependency-aware sequential/parallel scheduler.
- Optional Sub Agent dispatch and worker report verification.
- Worktree/native workspace isolation.
- Branch, commit, self-review, PR, review comment, and CI remediation workflow.
- Secret scanning and approved hook/tool integration.

### 6.3 P2 — Operations and ecosystem expansion

- Deployment/Health Check workflow and approval-gated rollback.
- Release Notes, CHANGELOG, SemVer proposal, and approval-gated Tag/Release.
- Optional external notification adapters.
- Optional GitHub Actions trigger for session resumption.
- Agent Marketplace packaging adapters where supported.
- Expanded Agent smoke-test automation.

## 7. Primary user journeys

### Journey 1 — Install the Skill

1. User runs `github-convention install`.
2. CLI discovers candidate Agents and shows detection confidence.
3. User multi-selects the Agents to install.
4. User selects Global, Project, or Both scope separately for each Agent.
5. CLI shows exact target paths and native/symlink/copy strategy.
6. CLI displays a dry-run/installation preview.
7. After required confirmation, CLI installs the Skill and writes ownership/hash manifests.
8. `list` and `doctor` report installed versions and integrity.

**Expected result:** selected Agents can discover the same Skill workflow; unselected Agents and unrelated configuration remain unchanged.

### Journey 2 — Initialize a repository

1. User or Agent runs `github-convention init` in a repository.
2. CLI identifies repository root and checks dependencies.
3. Main Agent inspects repository instructions, scripts, templates, CI, labels, and Git history patterns.
4. Existing project conventions are reused. Contradictions are reported for user resolution.
5. Project Config and convention documents are created only after preview/approval where changes are required.
6. Relevant source files are hashed and analysis results cached locally.

**Expected result:** repository-specific behavior is understood and recorded without overwriting existing conventions.

### Journey 3 — Plan and approve work

1. Main Agent receives a feature request or project plan.
2. It analyses relevant requirements and decomposes them into Parent Issues and independently testable Sub-issues.
3. It constructs a dependency DAG and identifies stable interface contracts.
4. Drafts are presented grouped by Parent Issue.
5. User can approve/reject a group and edit/approve/reject/exclude individual Issues.
6. Unapproved drafts remain in local State.
7. Approved Issues are created idempotently after a fresh GitHub check; native dependencies are attached.

**Expected result:** only approved Issues are created; excluded dependencies block downstream tasks rather than being silently removed.

### Journey 4 — Execute work sequentially or in parallel

1. Orchestrator loads the plan and queries current GitHub Issue/dependency/PR status.
2. It chooses Main-Agent-only, sequential, or parallel execution.
3. It computes concurrency from configured caps, runtime capacity, resource budget, dependencies, and file overlap.
4. If parallel work is safe, Orchestrator creates separate branches/workspaces using verified native isolation or Git Worktree.
5. Workers receive one Issue, acceptance criteria, interface context, allowed scope, and test commands.
6. Workers implement and test, then return the standard English Task Report.
7. Orchestrator inspects every diff and reruns relevant checks.
8. Independent tasks continue if a separate worker fails; failed tasks and their hard dependents stop.

**Expected result:** workers cannot commit or mutate shared state; the Orchestrator integrates all work and controls the Git history.

### Journey 5 — Create and maintain PRs

1. Orchestrator verifies Acceptance Criteria and project checks.
2. It fetches and rebases the latest default branch.
3. It reruns relevant checks, secret scanning, and self-review.
4. It creates one non-Draft PR per Issue using the project's PR title/body rules.
5. After another PR merges, it checks open branches and rebases only those materially affected.
6. It processes review comments and CI failures within retry and approval boundaries.
7. User reviews and merges PRs.

**Expected result:** every PR is independently reviewable and no agent merges it.

### Journey 6 — Resume after session termination

1. On the next explicit run, CLI/Orchestrator acquires the project lock.
2. It validates active Local State and queries live GitHub state.
3. It reconciles remote Issues, dependencies, PRs, and Merge status.
4. Completed tasks are skipped; safe work resumes; ambiguous work is held for user input.
5. Approval cannot be proven → ask again.

**Expected result:** no duplicate remote operation and no unsafe reuse of unclear workspaces.

### Journey 7 — Update or remove the product

1. CLI verifies current manifests and hashes.
2. Update stages the new release and performs Base/Local/Remote three-way merge.
3. Conflicts are previewed; no overlapping edit is silently overwritten.
4. After approval, validation runs in staging and installation is atomically replaced with a backup.
5. Uninstall removes only unmodified CLI-owned artifacts; modified/user-owned files remain.

**Expected result:** user customizations survive updates and removal.

## 8. Functional requirements

### 8.1 Packaging, CLI, and installation

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-CLI-01 | P0 | Provide a TypeScript/Node.js CLI named `github-convention` and a Skill package with independent SemVer versions. | CLI and Skill can be released independently; compatibility metadata is checked before install/update/run. |
| FR-CLI-02 | P0 | Support macOS, Linux, and Windows. | Core CLI, install, update, uninstall, doctor, and validate pass the OS CI matrix. |
| FR-CLI-03 | P0 | Publish the CLI through npm and standalone artifacts through GitHub Releases. | Release pipeline creates documented artifacts for verified OS/architecture targets; unsupported targets are not advertised. |
| FR-CLI-04 | P0 | Automatically discover Agent candidates and support multi-select. | Detection reports `confirmed`, `probable`, `unknown`, or `not_found`; only confirmed or explicitly selected probable targets are modified. |
| FR-CLI-05 | P0 | Allow independent Global/Project/Both scope selection per Agent. | A single install invocation can select multiple Agents with different scopes. |
| FR-CLI-06 | P0 | Keep one canonical Project Skill source at `.agents/skills/github-convention/`. | Canonical directory is Git-tracked; adapter paths are native discovery, symlink, or manifest-managed copy. |
| FR-CLI-07 | P0 | Use symlinks where supported and a managed copy fallback otherwise. | Fallback copies have per-file hashes/source version and are never treated as a second canonical source. |
| FR-CLI-08 | P0 | Provide `install`, `update`, `uninstall`, `list`, `doctor`, `init`, `validate`, `status`, `cleanup`, `plan`, and `state` command families. | CLI contract tests cover each command and its mutation behavior. |
| FR-CLI-09 | P0 | Support Interactive and Non-interactive operation. | `--non-interactive` never prompts or infers approval; missing required data produces a structured result. |
| FR-CLI-10 | P0 | Support text/JSON output and stable exit/error codes. | `--output json` produces valid JSON only on stdout; contract tests freeze response envelope and codes. |
| FR-CLI-11 | P0 | Support `--dry-run` for every mutating command. | Dry run performs read-only inspection only and makes no filesystem, Git, GitHub, configuration, or persistent-state changes. |
| FR-CLI-12 | P0 | Implement `doctor` and `validate`. | They report OS, runtime, Git/gh authentication, Agent paths/capabilities, config/schema, versions, permissions, and integrity without hidden mutation. |
| FR-CLI-13 | P1 | Support standalone installation without requiring the user to install Node.js separately. | Standalone artifacts run on the documented supported platform targets. |

### 8.2 Configuration, project analysis, and customization

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-CFG-01 | P0 | Support Global Config and Git-tracked Project Config. | Project settings override only supplied keys; defaults are inherited. |
| FR-CFG-02 | P0 | Merge nested objects recursively; replace arrays entirely when overridden. | Unit tests cover nested objects, arrays, scalars, and missing keys. |
| FR-CFG-03 | P0 | Treat safety constraints as immutable and non-overridable by Project Config. | Attempts to disable protected approvals, secret redaction, no direct default-branch push, or no agent merge fail validation. |
| FR-CFG-04 | P0 | Validate known settings strictly and warn on unknown keys. | Invalid known values block the affected operation before side effects; unknown keys produce actionable warnings. |
| FR-CFG-05 | P0 | Version the configuration schema and provide backup-first automatic migration. | Migration is staged, validated, backed up, and rolled back on failure; semantic conflicts require approval. |
| FR-CFG-06 | P1 | Inspect existing project instructions and conventions. | Analysis covers relevant instruction files, templates, scripts, CI, labels, and sampled Git patterns. |
| FR-CFG-07 | P1 | Detect conflicts between project files and Project Config. | Conflicting sources are shown to the user; resolution is saved to avoid repeated prompts. |
| FR-CFG-08 | P1 | Cache analysis and source hashes locally. | Only changed/new sources are reanalysed; cache is ignored by Git and never overrides current source files. |
| FR-CFG-09 | P1 | Query live GitHub state immediately before dependent actions. | Issue, dependency, Label, branch, PR, and CI status are not taken from stale local cache for writes. |
| FR-CFG-10 | P1 | Support project-only convention extensions without modifying the base Skill. | Custom rules live in `.github-convention/conventions/` and selected config keys; base Skill updates do not overwrite them. |

### 8.3 Issue planning and GitHub operations

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-GH-01 | P1 | Prefer existing `gh` authentication; use connected Agent GitHub tools only as fallback. | No additional token is created/stored by default; missing permissions are reported. |
| FR-GH-02 | P1 | Analyse and reuse existing Label taxonomy and Issue/PR templates. | Existing project patterns take precedence; proposed new labels/templates require approval where they create remote or tracked changes. |
| FR-GH-03 | P1 | Produce separate Parent Issue and Sub-issue drafts. | Parent has goal/scope/overall acceptance; Sub-issue has context, requirements, tasks, acceptance, dependencies, technical notes, and assumptions. |
| FR-GH-04 | P1 | Decompose only independently implementable and verifiable tasks. | Plan records file overlap, contract assumptions, dependencies, and acceptance criteria; no artificial splitting solely for parallelism. |
| FR-GH-05 | P1 | Present draft Issues by Parent with group and individual approval/edit/exclusion. | Only explicitly approved drafts are created; unapproved drafts remain local until discarded. |
| FR-GH-06 | P1 | Model hard blockers with GitHub native Issue dependencies. | Blocked status is derived from `Blocked by` / `Blocking`; no `blocked` Label is required. |
| FR-GH-07 | P1 | Create Issues idempotently. | Every generated Issue carries a stable plan/task marker; retries reuse/verify matching Issues rather than duplicating them. |
| FR-GH-08 | P1 | Keep approved downstream tasks blocked if a prerequisite is excluded or unapproved. | Their approval is not silently revoked and the dependency is retained until safely revised. |
| FR-GH-09 | P1 | Close Parent when all Sub-issues close and reopen it when a new Sub-issue is added. | Reconciliation tests verify close/reopen behavior and do not close a Parent with any open child. |
| FR-GH-10 | P1 | Start code-dependent downstream tasks only after upstream PR is merged to default branch and linked Issue is closed. | Scheduler verifies Merge and Issue closure before marking task ready. A stable documented interface may permit parallel work without a hard blocking edge. |
| FR-GH-11 | P1 | Create a new follow-up Sub-issue after retry exhaustion or a significant discovered follow-up. | The new Issue links back to the failed/original task and is created only after user approval. Priority reflects impact, not failure alone. |

### 8.4 Orchestration and workspace management

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-ORCH-01 | P1 | Allow Main-Agent-only, sequential, or optional parallel execution. | Scheduler selects the simplest safe execution mode; Sub Agents are never mandatory. |
| FR-ORCH-02 | P1 | Build a dependency DAG and calculate dynamic concurrency. | Effective concurrency never exceeds Global/Project cap or runtime capability and may be lowered by resource, dependency, or file-overlap risk. |
| FR-ORCH-03 | P1 | Prefer verified native workspace isolation; otherwise use Git Worktree. | Each worker has a distinct writable workspace; unknown native capability is treated as unsupported. |
| FR-ORCH-04 | P1 | Keep all Git/GitHub mutations in the Orchestrator. | Worker instructions and tests prohibit commit, push, PR, Issue/Label/dependency mutation, merge, thread resolution, and shared State writes. |
| FR-ORCH-05 | P1 | Provide a standard English worker Task Report. | Report contains Issue, status, summary, changed files, tests, technical decisions, known issues, and blockers. |
| FR-ORCH-06 | P1 | Inspect worker diffs and rerun relevant tests before integration. | A successful worker report alone cannot mark a task complete. |
| FR-ORCH-07 | P1 | Continue independent tasks after a worker failure. | Only the failed task and hard dependents stop; independent tasks continue. |
| FR-ORCH-08 | P1 | Retry a failed worker up to two times after the initial attempt, with early stop for non-retryable/repeated identical errors. | Retry count and reason are persisted; exhausted work becomes an approval-gated follow-up Issue. |
| FR-ORCH-09 | P1 | Preserve and reconcile existing workspaces after interruption. | Safe work resumes; completed work is skipped; ambiguous uncommitted changes are preserved and require review. |
| FR-ORCH-10 | P1 | Rebase before PR creation and assess open PRs after other merges. | Latest default branch is fetched before PR; unrelated open branches are not rebased unnecessarily. |

### 8.5 Git, PR, quality, CI, deployment, and release

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-PR-01 | P1 | Use project-specific branch, commit, and PR naming rules; otherwise apply documented defaults. | Existing project conventions win; fallback output includes Issue number for PR title. |
| FR-PR-02 | P1 | Create one non-Draft PR per Sub-issue. | Each PR links the matching Issue; user owns Merge. |
| FR-PR-03 | P1 | Require acceptance criteria, tests, secret scan, self-review, and latest-branch revalidation before PR creation. | PR cannot be created when required checks are missing or failing. |
| FR-PR-04 | P1 | Classify self-review findings and separate follow-up improvements from current blockers. | Critical correctness/security blockers prevent PR; non-blocking improvements are proposed as approved follow-up Issues. |
| FR-PR-05 | P1 | Process simple review requests automatically and ask before architecture/business logic/requirement changes. | Existing PR branch is updated; tests and self-review rerun. |
| FR-PR-06 | P1 | Resolve only simple review threads fully addressed and verified. | Design/discussion threads remain open for reviewer confirmation. |
| FR-PR-07 | P1 | Classify CI failures and retry within bounded limits. | Code-caused failures retry up to two times; transient external/network errors up to three; permission/config issues ask the user. |
| FR-QUAL-01 | P1 | Reuse existing formatting, lint, type, test, hook, and secret-scanning tools. | No duplicate tool is installed without a proposal and user approval. |
| FR-QUAL-02 | P1 | Require secret scanning before commit/push and in CI. | Likely secret findings block the operation; values are redacted from logs and reports. |
| FR-QUAL-03 | P1 | Propose new Secret Scanner, Git Hook, or CI configuration and require approval before installation/change. | No new tool or configuration is silently installed or replaced. |
| FR-QUAL-04 | P1 | Apply staged test pipeline: local fast checks; PR Unit/Integration; post-merge full suite/E2E; Release full validation. | CI workflows match stage and do not silently replace existing pipeline. |
| FR-DEP-01 | P2 | Inspect existing Branch Protection/Rulesets and propose changes. | Applying changes always requires approval; no existing rules are overwritten silently. |
| FR-DEP-02 | P2 | Inspect deployment and Health Check results after merge. | Transient errors retry within limits; Health Check failure stops further deployment actions. |
| FR-DEP-03 | P2 | Never perform automatic rollback. | Rollback plan is presented and requires explicit approval. |
| FR-REL-01 | P2 | Respect existing release rules; otherwise propose SemVer from Conventional Commits. | Proposed version, Breaking Changes, CHANGELOG, and Release Notes are shown for approval. |
| FR-REL-02 | P2 | Create Git Tag/GitHub Release only after approval. | Non-interactive execution returns `approval_required` and performs no Tag/Release mutation. |

### 8.6 State, privacy, and notifications

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-STATE-01 | P0 | Store each execution run in a separate local JSON file. | State validates against schema and includes schema version, stable task IDs, approvals, workspaces, checkpoints, and remote sync metadata. |
| FR-STATE-02 | P0 | Allow only Orchestrator to write shared run State. | Worker writes are rejected by workflow contract; worker reports are ingested by Orchestrator. |
| FR-STATE-03 | P0 | Persist every State transition immediately with atomic write and lock. | Kill/restart tests show no partially written JSON; concurrent writer receives `LOCK_BUSY`. |
| FR-STATE-04 | P0 | Treat GitHub as authoritative for remote status and Local State as authoritative for local execution detail. | Resume always fetches relevant remote status and reconciles before action. |
| FR-STATE-05 | P1 | Store analysis cache, Local State, archive, and logs outside Git tracking. | `init` adds exact ignore patterns without ignoring tracked canonical Skill/config/conventions. |
| FR-STATE-06 | P1 | Archive completed runs with configurable retention; default 30 days. | Cleanup runs on CLI invocation, never removes active runs, and supports inspect/restore. |
| FR-STATE-07 | P0 | Disable telemetry and analytics entirely. | No telemetry SDK or usage/error upload; outbound requests are limited to requested operations and configured notification endpoints. |
| FR-STATE-08 | P0 | Redact tokens, secrets, and sensitive command output from local logs. | Secret fixtures do not appear in CLI stdout/stderr/log files. |
| FR-NOTIFY-01 | P2 | Notify major events in the active Agent/CLI session; allow optional external adapters. | Start/finish, approval, repeated worker failure, unrecoverable CI, PR ready/Merge waiting, and deployment failure are surfaced; external service is opt-in. |

## 9. Business and policy rules

The following rules are product invariants and cannot be overridden by Project Config:

1. User approval is required before creating GitHub Issues from generated drafts.
2. User approval is required before installing a new project tool or modifying hooks/CI configuration.
3. User approval is required before applying Branch Protection/Ruleset changes.
4. User approval is required before architecture, business-logic, or requirements changes in response to review feedback.
5. User approval is required before deployment rollback or GitHub Release/Tag creation.
6. User approval is required for unresolved destructive/data-loss conflicts.
7. User always owns PR Merge.
8. Main Agent/Orchestrator is the only workflow authority for Git/GitHub mutations and shared State writes.
9. Sub Agents do not commit, push, create PRs, or modify GitHub Issues/Labels/dependencies.
10. `--yes` and non-interactive mode cannot bypass protected approvals.
11. A secret finding blocks commit/push; secret values must never be displayed in full.
12. The product never directly pushes to the protected default branch.
13. No automatic deletion of user changes, unknown files, or unowned workspaces.
14. No telemetry or analytics.

## 10. CLI requirements and command contract

The CLI must implement the command contract defined in [`docs/cli-contract.md`](docs/cli-contract.md). Core command groups:

```bash
github-convention install
github-convention update
github-convention uninstall
github-convention list
github-convention doctor
github-convention init
github-convention validate
github-convention status
github-convention cleanup
github-convention plan validate
github-convention plan apply
github-convention state list
github-convention state show
github-convention state restore
```

Common flags:

```text
--agent <id[,id...]>
--scope <global|project|both>
--non-interactive
--output <text|json>
--dry-run
--yes
--project <path>
--config <path>
--verbose
```

`--dry-run` must inspect and render intended changes without persistent writes, remote mutations, directory creation, or long-lived locks. JSON mode writes JSON only to stdout. Approval-required is a distinct result and exit status, not an implicit success or approval.

## 11. Non-functional requirements

### 11.1 Portability

- Core CLI must support macOS, Linux, and Windows.
- Path handling, permissions, symlink creation, process invocation, and lock behavior must be implemented and tested cross-platform.
- Standalone target architectures must be advertised only after release CI verifies them.

### 11.2 Reliability and data integrity

- All managed updates occur in a staging directory, validate before swap, and preserve a recoverable backup.
- Atomic writes are used for State and manifests.
- File locks prevent concurrent Orchestrator writes for a project/run.
- Remote creation operations use stable idempotency markers and fresh reads.
- Unsafe paths, path traversal, external symlinks, unknown file ownership, and unresolved conflicts stop destructive operations.

### 11.3 Security

- Use existing `gh auth` before considering any alternative.
- Do not persist GitHub tokens or Agent credentials in Project files, State, cache, logs, or generated Issues.
- Invoke child processes using argument arrays; do not concatenate untrusted input into shell commands.
- Redact secrets from all output and logs.
- Run dependency/security scans on the CLI itself.
- Treat Agent detection and capability values as untrusted/unknown until verified.

### 11.4 Performance and efficiency

- Use targeted repository discovery; do not load the entire repository history/source tree into model context.
- Reuse analysis cache for unchanged source files.
- Query live remote state only for resources relevant to the next action, but always refresh immediately before remote writes.
- Dynamic parallelism must account for context/resource budget and integration overhead; more workers are not automatically better.
- Keep CLI runtime dependencies small and avoid unnecessary daemons.

### 11.5 Usability and accessibility

- Interactive CLI must show detection confidence, install targets, scope, and planned changes before mutation.
- Non-interactive CLI must produce actionable machine-readable results and never hang awaiting input.
- Error output must identify the failing path/field/resource and explain a recovery path without revealing secrets.
- Project-specific rules must remain separate from the base Skill so the product can be upgraded safely.

### 11.6 Maintainability and extensibility

- Core policy remains in one canonical Skill.
- Agent adapters implement discovery, path mapping, capabilities, and workspace integration only.
- Marketplace support is implemented as packaging adapters rather than forks of the Skill.
- CLI and Skill version compatibility is explicit and tested.
- Adapter metadata must be revalidated against supported Agent versions before releases.

## 12. Data and configuration requirements

### 12.1 Project structure

```text
repository/
├── .agents/skills/github-convention/    # canonical Skill source; Git tracked
├── .github-convention/
│   ├── config.yaml                      # Git tracked
│   ├── conventions/                     # Git tracked
│   ├── cache/                            # ignored
│   ├── state/
│   │   ├── active/                       # ignored
│   │   └── archive/                      # ignored
│   └── logs/                             # ignored, redacted
├── .claude/skills/github-convention      # managed symlink/copy when needed
└── .gitignore
```

### 12.2 Configuration precedence

1. Immutable product safety policy.
2. Project Config for explicitly supplied project-specific values.
3. Global Config for inherited user preferences.
4. Skill defaults.

Objects merge recursively; arrays replace; scalars replace. Existing project instructions are analysed and conflicts are sent to the user rather than resolved silently. A resolution is persisted so the same conflict is not repeatedly raised.

### 12.3 Data retention

- Cache: local, SHA-256-indexed, regenerable, Git-ignored.
- State: local per-run JSON, Git-ignored, Orchestrator-only write.
- Archive: default 30-day retention, user-configurable; cleanup occurs on CLI invocation.
- Logs: local, redacted, bounded, Git-ignored.
- Unapproved Issue drafts: retained in Local State until explicitly discarded; they are not subject to completed-run archive deletion while still pending.

## 13. Quality, CI, and test requirements

### 13.1 Test levels

- **Unit:** config merge/validation, schemas, migrations, SemVer compatibility, SHA-256, three-way merge, path safety, idempotency, State transitions, locks, output envelopes, retry policy.
- **Integration:** temp Git repositories, Worktrees, actual file/symlink/copy behavior, mocked GitHub CLI, dedicated test repository, install/update/uninstall, migration and rollback, secret scanner wrappers, adapter detection.
- **E2E:** install → init → analyse → plan → approval → Issue creation → execution → PR → review/CI response → merge-state recovery, plus update/uninstall and interrupted-session recovery.
- **Agent smoke tests:** optional, executed only when the actual Agent is installed; absence of the Agent must not fail baseline CI.

### 13.2 CI schedule

| Trigger | Required checks |
|---|---|
| Commit / local hooks | format, lint, type-check, staged secret scan where configured |
| Push / pre-push | fast validation and secret scan |
| PR open/update | Unit + Integration + secret scan |
| Merge to default branch | full test suite + E2E |
| Release | full suite + release packaging + final smoke/deploy validation |

The existing repository pipeline must be inspected before adding or changing workflows. Required PR checks should be the checks configured for Branch Protection; post-merge E2E is an additional integration verification and does not retroactively prevent a merge that has already occurred.

### 13.3 Real GitHub integration

- Use a dedicated user-owned test repository, never an operating repository.
- Require the user to designate the repository and verify required permissions.
- Tag all created test resources with a unique run ID.
- On success, clean up only resources created and verified as owned by the current test run.
- On failure/interruption, preserve artifacts and logs for diagnosis.

## 14. Release and rollout plan

### Phase 1 — Foundation (P0)

Deliver package skeleton, TypeScript/Node.js CLI, schemas, config merge/validation, text/JSON output, dry-run, error codes, no-telemetry guarantees, test harness, and initial Skill package.

**Exit criteria:** cross-platform CLI builds; schemas validate; dry-run creates no side effects; all core tests pass.

### Phase 2 — Install lifecycle (P0)

Deliver Agent discovery, multi-select, per-Agent scope, canonical Project source, symlink/copy fallback, hash manifests, safe update/three-way merge, backup/rollback, uninstall, and doctor.

**Exit criteria:** installation does not modify unselected Agents; updates preserve non-overlapping user edits; conflicts are never silently overwritten; uninstall preserves modified files.

### Phase 3 — Project analysis and config (P1)

Deliver repository analysis, existing-convention detection, Global/Project merge, conflict resolution, SHA-256 analysis cache, project conventions, and init workflow.

**Exit criteria:** changed/new documents are reanalysed; unchanged documents are reused; existing project rules are not silently overwritten.

### Phase 4 — GitHub Issue workflow (P1)

Deliver `gh` authentication, Parent/Sub-issue drafts, grouped approval, idempotent Issue creation, native dependencies, Parent close/reopen reconciliation, and dedicated test-repository integration.

**Exit criteria:** no Issue is created without explicit approval; retry cannot duplicate an Issue; dependency blockers are correctly reflected.

### Phase 5 — State and orchestration (P1)

Deliver per-run Local State, atomic writes, locking, recovery, scheduler, dynamic concurrency, optional worker dispatch, native/Worktree isolation, report validation, and retry/follow-up flow.

**Exit criteria:** concurrent sessions are serialized; independent tasks continue after isolated failures; restart recovers safe work without repeating completed remote actions.

### Phase 6 — PR, review, and CI automation (P1)

Deliver branch naming, branch sync/rebase, secret scanning, self-review, PR creation, review feedback handling, CI classification/retry, and impact-aware open-PR synchronization.

**Exit criteria:** PRs are created only after acceptance criteria and all required checks pass; user owns Merge; secret findings block commits/pushes.

### Phase 7 — Operations and ecosystem (P2)

Deliver deployment/Health Check observation, approval-gated rollback, Release proposals/approval, notifications, optional GitHub Actions resumption trigger, standalone release artifacts, and marketplace adapters.

**Exit criteria:** no auto-rollback or unapproved Tag/Release; optional integrations fail safely without breaking the core Skill workflow.

## 15. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Agent Skill paths or capabilities change | Install fails or Skill is undiscoverable | Versioned adapters, confidence-based detection, doctor checks, release-time documentation verification |
| Native worker/workspace support differs | Unsafe or unavailable parallel execution | Capability-based adapter; Worktree fallback; sequential mode always available |
| Two CLI/Agent sessions operate on one repository | State corruption, branch/worktree races | Project lock, lock owner metadata, stale-lock validation, clear `LOCK_BUSY` outcome |
| GitHub operation succeeds but response is lost | Duplicate Issue/PR/Label | Stable markers, fresh remote read, idempotent retry |
| User edits Skill files | Update overwrites customization | SHA-256 manifests, three-way merge, diff preview, backup and rollback |
| Windows symlink permissions differ | Skill installation fails | Managed-copy fallback and per-platform tests |
| Project Config conflicts with existing docs | Agent applies inconsistent rules | Source conflict report and persisted user resolution |
| Worker reports success with incomplete/unsafe code | Defects reach PR | Orchestrator inspects diff and reruns tests independently |
| Secret scanner false positive/negative | Blocked work or leaked credential | Reuse known tools, redact findings, reviewed exception workflow, CI and local checks |
| GitHub API/CLI capabilities change | Remote operations break | Adapter boundary, contract tests, `gh` capability checks, dedicated test repo |
| Marketplace formats differ | Fragmented Skill copies | Canonical Skill source and per-marketplace packaging adapter |
| Large scope delays first release | No usable product delivered early | P0/P1/P2 sequencing; deliver install/config before full orchestration |

## 16. Dependencies and external assumptions

- A supported runtime (Node.js for npm install, or a verified standalone binary).
- Git installed and usable in the target repository.
- GitHub CLI (`gh`) authenticated for normal GitHub operations, or a suitable already-connected Agent GitHub tool fallback.
- Appropriate repository permissions for the requested GitHub operation.
- A supported AI Agent capable of loading the Skill. Worker delegation is optional.
- For true GitHub E2E tests, a user-owned dedicated test repository and its explicit configuration.
- For external notifications, a user-configured destination and credentials stored outside tracked Project files.

Agent-specific install paths, standalone binary targets, GitHub native dependency operations, and marketplace formats are implementation-time assumptions that must be validated against current supported versions. If an adapter capability is unknown, the product must not assume it is supported.

## 17. Acceptance and release gates

A release candidate is acceptable only when:

1. Every P0 requirement is implemented and covered by tests.
2. macOS, Linux, and Windows CI pass for supported runtime targets.
3. All installation/update/uninstall fault-injection tests preserve user-owned data.
4. Approval-required actions are blocked in both Interactive and Non-interactive modes without explicit approval.
5. No telemetry or analytics code/path is present.
6. JSON output contracts and exit codes are documented and tested.
7. CLI and Skill version compatibility is validated.
8. Secret values are redacted in output and logs.
9. Dedicated test-repository E2E tests verify idempotent GitHub behavior before enabling GitHub write automation for general use.
10. Documentation explains installation, configuration, update, recovery, limitations, and safe removal.

A release must not claim support for an Agent, OS, or architecture until its adapter/build target passes the relevant validation.

## 18. Traceability to design documents

| PRD area | Detailed source |
|---|---|
| Architecture and component ownership | [`SPEC.md`](SPEC.md) |
| Skill workflow and safety instructions | [`skills/github-convention/SKILL.md`](skills/github-convention/SKILL.md) |
| Agent paths and capabilities | [`docs/agent-adapters.md`](docs/agent-adapters.md) |
| CLI commands, flags, approvals, errors | [`docs/cli-contract.md`](docs/cli-contract.md) |
| Parent/Sub-issue templates | [`docs/issue-templates.md`](docs/issue-templates.md) |
| Consolidated product decisions | [`docs/decision-register.md`](docs/decision-register.md) |
| Implementation epics and dependencies | [`ROADMAP.md`](ROADMAP.md) |
| Config and State examples/schemas | [`examples/`](examples/) and [`schemas/`](schemas/) |

## 19. Implementation notes (not additional product questions)

The following details are intentionally delegated to implementation spikes and must not block the start of Phase 1:

- Confirm npm package-name availability and publisher scope.
- Re-verify Agent installation paths and Skill discovery behavior for the exact Agent versions tested.
- Choose specific CLI parsing, YAML, schema-validation, and three-way merge libraries after dependency/security review.
- Verify GitHub native Issue dependency operations and required permissions against the dedicated test repository.
- Validate standalone binary build targets and Windows symlink/copy behavior.
- Finalize the default fallback Branch/Commit/Label vocabulary only after analysing a target repository.
- Confirm whether an external notification provider adapter is worth including in the first P2 release.

No further product-discovery questionnaire is required to begin implementation.
