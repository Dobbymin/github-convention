---
name: review-ci-loop
description: Use when triaging Pull Request review comments, resolving review threads, resolving PR merge conflicts, or diagnosing and retrying CI check failures.
---

# PR Review, Conflict & CI Remediation Loop

Handle straightforward review, conflict, and CI fixes autonomously within bounded retries, while escalating design decisions, complex conflicts, permissions, and exhausted failures to the user.

## PR Review Triage

1. **Auto-fix without asking**:
   - Straightforward naming, style, formatting, simple exception handling, or missing test requests.
2. **Require explicit user approval first**:
   - Architecture changes, business-logic changes, or requirement changes requested in review.
3. **After every fix**:
   - Re-run impacted tests, quality gates, secret scan, and self-review (`agents/pr-reviewer.md`, optionally incorporating `dev-principles` reviewer outputs if available in a single Orchestrator-coordinated pass).
   - Orchestrator commits and pushes to the existing PR branch (reviewers and workers never commit or push).
   - Re-evaluate CI on the new commit (`PASS`, `NO_TESTS`, or `UNAVAILABLE`) and proceed to auto-merge (`skills/git-pr-workflow/SKILL.md`) using configured `github.merge_method` (`squash` | `merge` | `rebase`, default `squash`) unless `github.auto_merge_on_ci_pass: false`.
4. **Review thread resolution**:
   - Auto-resolve only simple review threads that are fully addressed and verified.
   - Leave design, architecture, or open discussion threads unresolved for human confirmation.

## PR Merge Conflict Resolution

When PR inspection shows merge conflicts (`CONFLICTING` / `DIRTY`):

1. Check target base branch, fetch latest remote base, compare diffs, and analyze conflict causes.
2. Resolve straightforward conflicts without `git reset --hard` or blind `--ours`/`--theirs`, preserving both upstream changes and Issue requirements without adding out-of-scope features.
3. Ask the user when a conflict involves complex design trade-offs or ambiguous intent.
4. Re-verify full diff, run local tests and quality gates, commit/push within Issue scope, confirm conflict clearance, and wait for fresh CI evaluation on the new commit before merging.

## CI Status & Failure Classification

Evaluate CI status across the 6 canonical states (`PASS`, `FAIL`, `PENDING`, `NO_TESTS`, `UNAVAILABLE`, `UNKNOWN`):

- **`PENDING`**: Always wait until checks finish; never use `--auto` to bypass pending tests or classify `PENDING` as `UNAVAILABLE`.
- **`NO_TESTS` / `UNAVAILABLE`**: When no tests exist (`NO_TESTS`) or GitHub Actions cannot start jobs due to quota/billing limits or disabled Actions (`UNAVAILABLE`, with 0 executed steps and no actual test failure), auto-merge is permitted once local verification and conflict/blocker checks pass.
- **`UNKNOWN`**: Distinguish CI query failure from PR state failure. If PR is not confirmed `OPEN` or check status cannot be trusted, block merge and diagnose.
- **`FAIL`**: Inspect failing logs (`gh run view --log-failed`) and classify:

| Failure Class | Action | Retry Bound |
| :--- | :--- | :--- |
| Code / test / lint / type / build failure | Diagnose root cause, fix, re-verify locally, push | Initial + up to **2** retries |
| Transient external / network / runner flake | Re-run failed jobs (`gh run rerun --failed`) | Up to **3** retries |
| Permissions / secrets / user-owned config | Stop retrying and ask the user with exact error | 0 retries (user input) |

- Never misclassify a real test failure as `UNAVAILABLE` or silence a new code-caused failure as an "environment issue".
- Never disable CI checks or hooks to make a run green.

## Retry Exhaustion

When code or CI retries are exhausted:

1. Preserve partial work and failure context (failing check, error summary, redacted logs).
2. Propose a new follow-up Issue under the existing Parent Issue (`skills/issue-planning/SKILL.md`).
3. Obtain explicit user approval before creating the follow-up Issue.
