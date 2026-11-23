---
description: Verify branch naming, quality gates, secret scan, self-review, and create, conflict-resolve, or auto-merge a Pull Request linked to its Issue.
argument-hint: "[issue number or PR summary]"
---

Follow `skills/using-github-convention/SKILL.md` and `skills/git-pr-workflow/SKILL.md` for:

`$ARGUMENTS`

Steps:

1. Confirm the active branch follows repository conventions and is not the default branch.
2. Run repository quality gates (build, format, lint, typecheck, tests, secret scan) and run `agents/pr-reviewer.md` on the full diff against the base branch (optionally passing `dev-principles` `principles-reviewer`/`architecture-reviewer`/`security-reviewer` outputs if available, without duplicating those audits or triggering recursive reviewer calls).
3. Rebase onto the latest target base branch if needed, re-run impacted checks, and create/update a non-Draft PR using the repo template (or `templates/PULL_REQUEST_TEMPLATE.md` fallback) with the matching Issue closing keyword.
4. Check PR mergeability and resolve any conflicts safely via the 10-step conflict flow (re-verifying on the new commit). Evaluate CI across `PASS`, `FAIL`, `PENDING` (always wait), `NO_TESTS`, `UNAVAILABLE`, and `UNKNOWN`; when `OPEN`, non-Draft, conflict-free, zero blockers, and `PASS` / `NO_TESTS` / `UNAVAILABLE` (with `github.auto_merge_on_ci_pass` not `false`), merge via `gh pr merge <PR> --<squash|merge|rebase> --delete-branch` according to `github.merge_method` (default `squash`) and sync the local base branch. Never merge with `--admin`, raw `gh api`, or while checks are `FAIL`, `PENDING`, or `UNKNOWN`.
