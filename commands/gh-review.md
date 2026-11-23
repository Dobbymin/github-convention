---
description: Triage Pull Request review comments, resolve verified simple threads, resolve PR merge conflicts, and diagnose or retry CI failures.
argument-hint: "[PR number]"
---

Follow `skills/using-github-convention/SKILL.md` and `skills/review-ci-loop/SKILL.md` for:

`$ARGUMENTS`

Steps:

1. Inspect PR state, mergeability, review comments, and 6-state CI status (`gh pr view`, `gh pr checks`, `gh run view --log-failed`).
2. If merge conflicts exist (`CONFLICTING` / `DIRTY`), follow the 10-step conflict resolution flow against the target base branch without `git reset --hard` or blind `--ours`/`--theirs`, re-run tests on the new commit, and ask the user on complex design conflicts.
3. Auto-fix straightforward style/naming/exception/test review requests; ask for explicit user approval before architecture, business-logic, or requirement changes.
4. Classify CI status (`PASS`, `FAIL`, `PENDING`, `NO_TESTS`, `UNAVAILABLE`, `UNKNOWN`), always wait on `PENDING`, retry `FAIL` within bounds, propose an approval-gated follow-up Issue if retries are exhausted, or auto-merge on `PASS` / `NO_TESTS` / `UNAVAILABLE` using configured `github.merge_method` (`squash` | `merge` | `rebase`, default `squash`) when `github.auto_merge_on_ci_pass` is not `false`.
