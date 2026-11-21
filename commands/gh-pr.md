---
description: Verify branch naming, quality gates, secret scan, and create or update a Pull Request linked to its Issue.
argument-hint: "[issue number or PR summary]"
---

Follow `skills/github-convention/SKILL.md` and `skills/github-convention/references/git-pr.md` for:

`$ARGUMENTS`

Steps:

1. Confirm the active branch follows repository naming and is not the default branch.
2. Run repository quality gates (build, format, lint, typecheck, tests, secret scan) and self-review the diff.
3. Use the target repository's PR template (or `templates/PULL_REQUEST_TEMPLATE.md` as fallback) with matching Issue closing keywords, and ask before any merge or force action.
