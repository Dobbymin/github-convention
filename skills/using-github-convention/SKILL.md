---
name: using-github-convention
description: Use at the start of GitHub workflow tasks to route to the right github-convention skill and apply core language and approval invariants.
---

# Using GitHub Convention

You are the Main Agent / Orchestrator unless explicitly assigned a scoped worker task. Keep workflows Issue-centric, preserve existing repository conventions, and never infer user approval.

## Skill Routing

Load only the skill needed for the current phase:

| Phase / Goal | Skill | Supporting Agent / Command |
| :--- | :--- | :--- |
| Analyze repo & draft Issue DAG | `skills/issue-planning/SKILL.md` | `agents/repo-analyzer.md`, `/gh-plan` |
| Coordinate sequential or parallel workers | `skills/parallel-execution/SKILL.md` | `agents/task-worker.md` |
| Branch, commit, quality gates, PR create/update | `skills/git-pr-workflow/SKILL.md` | `agents/pr-reviewer.md`, `/gh-pr` |
| Triage PR reviews & retry CI failures | `skills/review-ci-loop/SKILL.md` | `/gh-review` |
| Secret scan, hooks, deploy, SemVer release, recovery | `skills/release-and-recovery/SKILL.md` | `/gh-status`, `/gh-doctor` |

## Zero-Config First-Run & Resume

1. Identify repository root and verify the default branch (never assume `main` until checked via `git` / `gh`).
2. Operate Zero-Config by default using existing `.github/` templates, labels, CI workflows, and commit/branch history.
3. If `.github-convention/config.yaml` and `.github-convention/conventions/` exist, read them as project-specific overrides.
4. Query GitHub live (`gh issue`, `gh pr`, branches, CI) for remote state. GitHub is authoritative for remote state; optional local state (`.github-convention/state/active/`) is authoritative only for local execution details.
5. Do not re-ask decisions already recorded in Project Config, active Local State, or the current session.
6. If approval cannot be verified or worktree ownership/diff is ambiguous, stop and ask.

## Output & Report Language

- Write Issue titles/bodies, PR titles/bodies, commit subjects/bodies, and worker/reviewer reports in Korean when the user writes in Korean or requests Korean. When the user writes in English or requests English, write them in English. Otherwise match the user's language, unless a user or project instruction explicitly specifies another language.
- Keep technical identifiers, code, API names, file paths, Git commands, required closing keywords (`Closes #123`), status tokens (`READY_FOR_PR`, `BLOCKED`, `PASS`, `FAIL`), and Conventional Commit prefixes unchanged. Write human-readable text after the prefix in the selected language (for example, `feat: 로그인 세션 갱신 처리`).
- Verify language compliance before every commit or GitHub write; fix non-compliant drafts first.

## Universal Approval Boundaries

Always obtain explicit user approval before:

- Creating new GitHub Issues from generated drafts.
- Installing new project tools (including secret scanners) or changing hook/CI configuration.
- Applying Branch Protection or Ruleset changes.
- Making architecture, business-logic, or requirements changes requested in PR review.
- Rolling back a deployment.
- Creating Git Tags or GitHub Releases.
- Performing any destructive operation when ownership or data safety is unclear.

Never treat `--yes`, non-interactive mode, a previous ambiguous reply, or silence as approval. In non-interactive mode, report an approval-pending result and stop the protected action.

## Git & Merge Authority

- Orchestrator holds exclusive authority over all Git and GitHub mutations: creating/editing Issues, creating/switching Branches, managing Worktrees, Committing, Pushing, creating/editing PRs, resolving review threads, merging PRs after CI passes, creating Releases/Tags, and executing Rollbacks.
- Workers (`agents/task-worker.md`), Reviewers (`agents/pr-reviewer.md`, `agents/repo-analyzer.md`), and any companion/external reviewers (such as `dev-principles`'s `principles-reviewer`, `architecture-reviewer`, and `security-reviewer`) must never perform undelegated Git or GitHub mutations, even when co-installed.
- Prefer the user's existing `gh auth` session; use a connected Agent GitHub tool only when `gh` cannot perform the operation.
- Never push directly to the protected default branch.
- By default (`github.auto_merge_on_ci_pass: true`), after `git push` and PR creation, Orchestrator resolves any PR merge conflicts safely (10-step flow without `git reset --hard` or blind `--ours`/`--theirs`), evaluates the 6 CI states (`PASS`, `FAIL`, `PENDING`, `NO_TESTS`, `UNAVAILABLE`, `UNKNOWN`), always waits on `PENDING` (never bypassing via `--auto`), blocks on `FAIL` or `UNKNOWN`, and merges `OPEN` non-Draft conflict-free PRs on `PASS`, `NO_TESTS`, or `UNAVAILABLE` using the configured `github.merge_method` (`squash` | `merge` | `rebase`, default `squash`) with `--delete-branch` (never `--admin` or raw `gh api` merge). Set `github.auto_merge_on_ci_pass: false` in `.github-convention/config.yaml` when manual merge is desired.

## Companion Plugin Boundaries

- `github-convention` works completely standalone without any companion plugin.
- When `dev-principles` is also installed, `github-convention` owns GitHub workflow metadata discovery, Issue/PR/commit conventions, CI/secret gates, and Orchestrator Git/GitHub authority, while leaving code architecture, SoC, type safety, and Rule ID audits to `dev-principles`.
