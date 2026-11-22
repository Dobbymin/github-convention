---
description: Verify branch naming, quality gates, secret scan, self-review, and create or update a Pull Request linked to its Issue.
argument-hint: "[issue number or PR summary]"
---

Follow `skills/using-github-convention/SKILL.md` and `skills/git-pr-workflow/SKILL.md` for:

`$ARGUMENTS`

Steps:

1. Confirm the active branch follows repository conventions and is not the default branch.
2. Run repository quality gates (build, format, lint, typecheck, tests, secret scan) and run `agents/pr-reviewer.md` on the full diff against the base branch (optionally passing `dev-principles` `principles-reviewer`/`architecture-reviewer`/`security-reviewer` outputs if available, without duplicating those audits or triggering recursive reviewer calls).
3. Rebase onto the latest target base branch if needed, re-run impacted checks, and create/update a non-Draft PR using the repo template (or `templates/PULL_REQUEST_TEMPLATE.md` fallback) with the matching Issue closing keyword.
4. Monitor `gh pr checks`; once all tests and CI checks pass with zero unresolved blockers (and `github.auto_merge_on_ci_pass` is not `false`), merge the PR (`gh pr merge --squash --delete-branch`) and sync the local base branch. Never merge with `--admin` or failing/pending checks.
