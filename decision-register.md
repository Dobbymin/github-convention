# Consolidated Decision Register

This register groups the decisions made during product discovery. It records the resulting policy rather than repeating the original question/answer wording.

## Workflow and GitHub

- Issue decomposition is based on independently implementable, verifiable work; avoid unnecessary splitting.
- Parent Issue and Sub-issue use separate templates.
- Issue drafts are presented by Parent group; users can approve/reject groups and edit/approve/reject individual items.
- Only approved Issue drafts are created. Unapproved drafts remain in local State until explicitly discarded.
- GitHub native Issue dependencies represent hard blockers; no `blocked` Label is required. Local State tracks runtime status.
- If a required upstream task is not approved, dependent tasks remain approved but blocked.
- Code-dependent work starts only after its dependency PR is merged to the default branch and the Issue is closed. Stable API/interface contracts may allow FE/BE parallel work without a hard blocking edge.
- Parent closes when all Sub-issues close and reopens when a new Sub-issue is added.
- `gh` CLI auth is preferred; connected Agent GitHub tools are fallback. Do not create/store an additional token by default.
- Each Sub-issue gets a separate branch and PR. No Draft PR by default. PR title follows project rules; otherwise use Conventional Commit style plus Issue number.
- Orchestrator performs all Git/GitHub mutations; user merges PRs.
- Fetch/rebase the latest default branch before PR creation. Rebase open PR branches after another merge only when changed paths/dependencies materially affect them.
- Inspect Branch Protection first; propose changes and apply only after approval.

## Orchestration

- Sub Agents are optional. Main Agent may work alone, sequentially, or delegate independent tasks.
- Concurrency is dynamic and capped by Global/Project user configuration; agent capacity, resource budget, dependencies, and file overlap can lower the cap.
- Prefer verified native isolation; otherwise use Git Worktree.
- Each worker gets one isolated workspace. Workers only implement/test and report in concise English.
- Orchestrator owns branch/worktree, commit, push, PR and Local State writes.
- Worker output uses the standard English Task Report.
- A failed worker and its hard dependents stop; independent tasks continue. Default is initial attempt plus up to two retries. Repeated failure becomes a new follow-up Issue under the Parent after user approval.
- Code-review follow-up improvements are `high` when classified that way; failure Issues get priority based on impact, not automatically high.

## Approval and safety

- Approval is required for Issue creation, new scanner/hook/tool installation, Branch Protection changes, architecture/business-logic/requirements changes, rollback, Release/Tag creation, and destructive ambiguity.
- PR Merge is always user-owned.
- Hook bypass is allowed only for diagnosed environment/tool failures and must be recorded; do not bypass new code-caused failures.
- Secret scanner is required: reuse an existing one, otherwise propose install and get approval. Secret findings block commit/push; values are redacted.
- No telemetry.
- `--dry-run` on all mutating CLI operations.
- Non-interactive mode must not infer approval.

## Installation and packaging

- Independent Skill package plus CLI, usable like an installable plugin.
- Distribution: GitHub source, npm CLI, GitHub Releases standalone binaries; marketplace adapters later.
- Detect Agents automatically and support multi-select.
- Global, Project, or Both install scope; scope can differ per selected Agent.
- Project canonical Skill lives at `.agents/skills/github-convention/` and is Git-tracked.
- Agent-specific paths use native discovery when possible; symlink to canonical source when supported, otherwise managed copy.
- CLI is Node.js + TypeScript; npm and standalone executables are both supported.
- CLI and Skill versions are independent SemVer with compatibility checks.
- Global follows latest, Project pins version; updates are previewed and approved.
- SHA-256 manifests, protected three-way merge, backup/rollback, preserve edited files on uninstall.

## Configuration and local data

- Global + Project Config; Project overrides only specified keys.
- Recursive object merge; arrays replace completely.
- Project-specific conventions live outside base Skill in `.github-convention/conventions/`.
- Safety guardrails cannot be overridden.
- Existing project docs that conflict with Project Config are shown to the user; resolution is recorded.
- Local project analysis is SHA-256 cached; remote GitHub state is queried fresh before actions.
- Cache and execution State are JSON, user config YAML.
- Cache, State, logs, and archive are Git-ignored.
- One JSON State per execution plan/Parent run; only Orchestrator writes it and saves after every transition.
- GitHub is remote source of truth; State restores execution detail. Unclear approval is treated as not approved.
- Completed State is archived, default 30-day retention, cleaned on CLI invocation.

## PR, CI, deployment, and release

- Self code review is mandatory before PR creation.
- Review comments are auto-fixed only when straightforward; design/business/requirement changes need approval. Resolve only straightforward verified threads.
- CI failure is classified and remediated within bounded retries; unresolved issues become follow-up Issues.
- Parent/PR/Issue status is reconciled on next Agent/CLI run; optional GitHub Actions triggers can be added later.
- Deployment retries transient failures; health-check failure stops further actions; rollback requires approval.
- Existing Release policy wins; otherwise SemVer. Release notes/changelog are drafted and Release creation requires approval.

## Runtime, tooling, and testing

- macOS, Linux, Windows support.
- CLI has interactive and non-interactive modes, text and JSON output.
- Strict validation for known settings; unknown settings warn.
- Unit, Integration, E2E tests on OS matrix; real GitHub test uses a dedicated user-owned repository.
- Successful test run cleans up only its own artifacts; failed run preserves artifacts for diagnosis.
- No permanent background daemon; resume on next run by default.
