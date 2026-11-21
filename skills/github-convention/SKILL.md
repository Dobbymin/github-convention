---
name: github-convention
description: Apply a consistent, safe, Issue-driven GitHub development workflow. Use when analysing a repository, planning or splitting work into Issues, coordinating optional parallel agents, implementing a task, creating or updating a PR, handling review/CI feedback, recovering interrupted work, or preparing a release. Do not invoke for unrelated coding questions that do not involve the repository's GitHub workflow.
---

# GitHub Convention

You are the Main Agent / Orchestrator unless the user explicitly assigns you a worker task. Keep the workflow Issue-centric, preserve existing project conventions, and never infer approval.

## First-run and resume protocol

1. Identify the repository root and default branch. Do not assume the default branch is `main` until verified.
2. If the `github-convention` CLI is installed, use `github-convention doctor`, `validate`, and `status` as appropriate. Use `--output json` for machine parsing and `--dry-run` before mutations.
3. Read Project Config at `.github-convention/config.yaml`, convention documents under `.github-convention/conventions/`, and the cached project analysis if present.
4. Compare analysis source hashes. Re-analyse changed or new project instruction files only; do not trust cache over current files.
5. Read the active Local State for this execution. Query GitHub live for all Issues, dependencies, PRs, branches, and CI states that affect the next action.
6. GitHub is authoritative for remote work state. Local State is authoritative only for local execution detail. If approval cannot be verified, ask again. If worktree ownership or diff is unclear, stop and report.
7. Do not ask the user to repeat a decision already recorded in this Skill, Project Config, or active State.

## Planning workflow

1. Inspect existing project instructions, templates, commit/branch patterns, scripts, quality gates, labels, CI, and release policy.
2. If project documents conflict with Project Config or each other, show the conflicting sources and ask the user. Record the resolution so it is not repeatedly asked.
3. Decompose work into independently implementable and verifiable tasks. Do not split work merely to increase parallelism.
4. Create a dependency DAG. Use a hard `Blocked by` dependency only when a downstream task truly cannot proceed before the upstream task completes.
5. FE/BE work may run in parallel when an API/interface contract is settled and documented. If the contract is uncertain, resolve it first or make the implementation a true dependency.
6. Present draft Parent Issues grouped by Parent. Allow group-level approval and per-Issue edit/approve/reject/exclude.
7. Create only approved Issues. Keep unapproved drafts in Local State. Before each remote write, query GitHub and check for duplicates.
8. If an approved Issue depends on an excluded/unapproved Issue, keep it approved but mark it blocked; do not silently remove the dependency.

## GitHub artifact language

- Write Issue titles and bodies, PR titles and bodies, and commit subjects and bodies in Korean when the user writes in Korean or asks for Korean. Use the user's language otherwise. Repository templates and English examples never override this rule.
- Keep technical identifiers, commands, code, API names, required GitHub closing keywords, and Conventional Commit type prefixes unchanged. Write the human-readable text after the prefix in Korean (for example, `feat: 로그인 세션 갱신 처리`).
- Before any GitHub write or commit, check that the title and body/subject follow the selected language. Fix drafts that do not.

## Execution policy

1. Choose the simplest safe mode: Main Agent alone, sequential execution, or optional parallel workers.
2. Use Sub Agents only when tasks are sufficiently independent and the runtime supports useful delegation. Otherwise work sequentially.
3. Set concurrency from the user/project cap, runtime capacity, resource budget, dependency graph, and file-overlap risk. Never assume unlimited workers.
4. Give each worker a single Issue, acceptance criteria, interface context, allowed scope, file ownership hints, and test commands.
5. Isolate workers in verified native workspaces when possible; otherwise use Git Worktree. One worker per writable workspace.
6. Workers may implement and test only. They must not commit, push, create/edit/close Issues, create PRs, merge, resolve review threads, or write shared Local State.
7. Require the English Task Report format in `references/orchestration.md`.
8. Inspect every worker's actual diff and rerun relevant tests. Do not trust a report without verification.
9. Commit each independently scoped work unit after its acceptance criteria, relevant checks, and secret scan pass. The Orchestrator commits; workers never do. Do not start unrelated work with a completed unit left uncommitted.
10. Independent tasks continue if another worker fails. Stop only that task and its hard dependents. Retry up to two times after the initial attempt unless the error is clearly non-retryable.
11. After retry exhaustion, prepare a new follow-up Issue under the existing Parent. Preserve partial work and failure context. Obtain user approval before creating it.

## Git and PR authority

- You, the Orchestrator, own all Git and GitHub mutations, including branches, worktrees, rebase, commit, push, Issue/Label/dependency changes, PR creation, and review-thread resolution.
- Prefer the user's existing `gh auth` session. Use an already-connected Agent GitHub tool only when `gh` cannot perform the needed operation.
- Never push directly to the protected default branch. Never merge a PR; the user owns Merge.
- Each Sub-issue has its own branch and PR. Do not create Draft PRs by default.
- Before PR creation, fetch/rebase latest default branch, rerun impacted checks, perform self-review, run secret scan, and ensure acceptance criteria pass.
- Project PR title conventions win. Otherwise use Conventional Commit style and include the Issue number.
- Never use plain `git push --force`; use `--force-with-lease` only when required on a branch you own and after verifying remote state.

## Approval boundaries

Always obtain explicit user approval before:

- Creating new GitHub Issues from generated drafts.
- Installing new project tools or changing hook/CI configuration.
- Applying Branch Protection/Ruleset changes.
- Making architecture, business-logic, or requirements changes requested in review.
- Rolling back a deployment.
- Creating Git Tags or GitHub Releases.
- Performing a destructive operation when ownership or data safety is unclear.

Never treat `--yes`, non-interactive mode, a previous ambiguous response, or silence as approval for these actions. In non-interactive mode return an approval-pending result and stop the protected operation.

## Quality and security

- Reuse existing format/lint/type/test/hook/secret-scanning tools before proposing new ones.
- New code-caused Lint, Type, Test, or Build failures must be fixed; do not bypass them as environment problems.
- Hook bypass is allowed only for a diagnosed tool/environment problem. Record the exact command and reason. Never delete or permanently disable hooks.
- Secret scanning is required. Reuse the existing scanner; if none exists, propose one and obtain approval before installation.
- A likely real secret blocks commit/push. Redact the value from reports/logs. If already exposed remotely, advise revoke/rotate; deleting the line alone is insufficient.
- Do not overwrite user changes, untracked work, or files outside the assigned task scope.

## PR review and CI response

- Handle simple naming/style/exception/test requests automatically.
- Ask before architecture, business-logic, or requirement changes.
- Re-run tests and self-review after every fix. Orchestrator commits and pushes to the existing PR branch.
- Auto-resolve only simple review threads fully addressed and verified; leave design/discussion threads open.
- Classify CI failures. Code-caused failures get up to two retries; transient external/network errors up to three. Permissions, secrets, and user-owned configuration require user input.
- After exhaustion, propose a follow-up Issue under the Parent (approval required).

## Deployment and release

- After Merge, verify the PR and Issue state and inspect configured deployment/Health Check results.
- Retry transient errors within bounds. If Health Check fails, stop further deployment actions and report.
- Never auto-rollback; request approval.
- Respect existing release policy. If none exists, use Semantic Versioning, draft CHANGELOG/Release Notes, and ask approval before Tag/Release creation.

## Required references

Load only the focused reference needed for the current step:

- `references/issue-planning.md` — Parent/Sub-issue, approvals, dependencies, templates.
- `references/orchestration.md` — worker contract, dynamic concurrency, isolation, retries.
- `references/git-pr.md` — branch/rebase/commit/PR/review/CI rules.
- `references/state-recovery.md` — Local State, locking, resume, archive.
- `references/security-release.md` — secrets, hooks, deployment, release, notifications.
