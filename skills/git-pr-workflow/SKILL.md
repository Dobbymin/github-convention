---
name: git-pr-workflow
description: Use when creating branches, committing work units, running pre-PR quality gates and secret scans, rebasing, resolving PR merge conflicts, or creating and auto-merging Pull Requests.
---

# Git & Pull Request Workflow

Keep Git mutations Orchestrator-owned, commit clean work units, pass all quality and secret gates, and link every PR to its Issue.

## Branch & Work-Unit Commits

- Verify the repository's default branch before branching. Never push directly to the protected default branch.
- **Target Base Branch vs. Default Branch**: When the user specifies a non-default base branch (`develop`, `release/*`, `test/*`), branch from it, rebase onto it, and target the PR at that base branch instead of the default branch.
- Prefer repository branch/commit/PR conventions; otherwise use Conventional Commit style (`{type}/{issue}-{slug}` branches, `feat:`/`fix:`/`refactor:`/`docs:`/`test:`/`chore:` commits).
- Commit each independently scoped work unit once its acceptance criteria, relevant checks, and secret scan pass. A larger Issue may produce multiple clean commits on its branch.
- Verify artifact language (Korean when user writes/requests Korean; keep prefixes, identifiers, commands, and closing keywords intact).
- Never use plain `git push --force`. Use `--force-with-lease` only when required on a branch you own after verifying remote state.

## Pre-PR Checklist (All 7 Required)

1. Verify all Issue acceptance criteria are met.
2. Run existing repository quality gates (format, lint, typecheck, build, unit/integration tests). New code-caused failures must be fixed, never bypassed.
   - **Pre-existing vs. New Gate Failures**: When a repository-wide check fails on untouched files, verify that the failure pre-exists on the base branch or outside your diff, run scoped checks on your changed files to confirm zero new regressions, and record the exact pre-existing failure scope in the PR body without editing unrelated files.
3. Run secret scan on staged/branch changes (reuse existing scanner; block on likely real secrets).
4. Inspect the complete diff against the base branch and perform self-review (delegate read-only GitHub workflow review to `agents/pr-reviewer.md` in a single pass; if `dev-principles` reviewer outputs from `principles-reviewer`, `architecture-reviewer`, or `security-reviewer` are also available, pass them to `pr-reviewer` without re-auditing design/architecture/security-design or triggering recursive reviewer calls).
5. Fetch and rebase onto the latest target base branch (or default branch when no separate base branch is specified).
6. Re-run tests impacted by the rebase.
7. Verify Issue/PR title, body, labels, and links.

## PR Creation & Template Precedence

- Each Sub-issue gets its own branch and PR. Do not create Draft PRs by default.
- Use the target repository's existing PR template (such as `.github/pull_request_template.md`) when present. Use `templates/PULL_REQUEST_TEMPLATE.md` only as fallback.
- Include the matching Issue closing keyword (`Closes #123` / `Fixes #123`). For a Sub-issue PR, close the child Issue rather than its Parent. Note that GitHub only auto-closes `Closes #N` when merging into the default branch; for non-default base branches, keep the keyword for traceability and note the base branch.
- Prefer `gh pr create`; use a connected Agent GitHub tool only if `gh` cannot perform the operation.

## CI Status Classification & Auto-Merge Policy

Classify PR CI status (`gh pr view <pr> --json isDraft,state,mergeable,mergeStateStatus,statusCheckRollup`) into 6 states:

| Status | Meaning | Merge Action |
| :--- | :--- | :--- |
| `PASS` | All configured CI checks passed | Allow merge |
| `FAIL` | Any CI check/test failed | Block merge; enter `skills/review-ci-loop/SKILL.md` |
| `PENDING` | One or more checks still running/queued | Always wait (never bypass with `--auto`) |
| `NO_TESTS` | Project has no configured CI checks or tests | Allow merge |
| `UNAVAILABLE` | CI cannot run (Actions quota/billing limit or Actions disabled) | Allow merge after local verification |
| `UNKNOWN` | PR or CI status query failed or check state cannot be trusted | Block merge; diagnose cause safely |

- **Critical distinctions**: Priority order is `FAIL > PENDING > UNKNOWN > UNAVAILABLE > NO_TESTS > PASS` (so `PASS + UNAVAILABLE` classifies as `UNAVAILABLE`, while any confirmed `FAIL` or `PENDING` always wins). Never confuse `NO_TESTS` with `UNAVAILABLE`, never treat `PENDING` as `UNAVAILABLE`, never misclassify a real test failure (`FAIL`) as `UNAVAILABLE`, and classify CI lookup failures on `FAILURE` checks (missing/malformed Check Run or Job ID, auth 401/403, 404, network/timeout, invalid response) as `UNKNOWN` (unless another check confirms real `FAIL`), separate from PR state query failure (never merge if PR cannot be verified `OPEN`).
- **Auto-merge preconditions**: PR is `OPEN`, not Draft, zero failing tests (`PASS`, `NO_TESTS`, or `UNAVAILABLE`), conflicts resolved (`MERGEABLE`), zero unresolved blockers, and `github.auto_merge_on_ci_pass` is not `false`.
- **`merge_method` selection & precedence**: `repo allowed merge methods > explicit project config (github.merge_method) > explicit CLI flag > default (squash)`. Invalid or omitted config defaults to `squash`:
  - `gh pr merge <PR> --squash --delete-branch`
  - `gh pr merge <PR> --merge --delete-branch`
  - `gh pr merge <PR> --rebase --delete-branch`
- Never use `--admin` or raw `gh api` merge endpoints, and do not rely on `gh pr merge --auto` to skip waiting for `PENDING` checks.
- If `github.auto_merge_on_ci_pass: false`, leave the PR open for manual user merge.

## Automatic PR Conflict Resolution (10-Step Flow)

When a PR has merge conflicts (`CONFLICTING` / `DIRTY`), resolve them before merging:

1. Identify the PR's target base branch.
2. Fetch the latest remote base branch (`git fetch origin <base>`).
3. Compare current working branch changes against the base branch.
4. Analyze conflicting files and root cause of each conflict.
5. Resolve conflicts carefully while preserving both upstream intent and Issue changes.
6. Verify that all existing branch changes and Issue requirements remain intact.
7. Run impacted tests and quality gates locally.
8. Commit (if merge/rebase requires) within the Issue scope and push (`--force-with-lease` only if rebased on an owned branch).
9. Re-verify PR mergeability (`gh pr view --json mergeable,mergeStateStatus`).
10. Re-evaluate CI and auto-merge conditions on the **new commit** (never treat a previous commit's CI result as valid for the new commit).

**Conflict safety rules**:
- Never run `git reset --hard` to discard work, and never blindly apply `git checkout --ours` or `--theirs`.
- Never overwrite another contributor's changes arbitrarily or add features outside the Issue scope.
- Review the full diff after resolution; ask the user on complex design conflicts or ambiguous intent.
