---
description: Inspect live GitHub state alongside git worktrees and optional local execution state to guide safe recovery.
argument-hint: "[--pr <number> | --issue <number>]"
---

Follow `skills/using-github-convention/SKILL.md` and `skills/release-and-recovery/SKILL.md`:

`$ARGUMENTS`

Steps:

1. Inspect local git state (`git status`, `git branch`, `git worktree list`) and optional `.github-convention/state/active/` files if present.
2. Query live GitHub Issues, PRs, branches, and CI checks (`gh issue list`, `gh pr list`, `gh pr checks`) to reconcile any drift.
3. Summarize actionable next steps without mutating remote state unless approved.
