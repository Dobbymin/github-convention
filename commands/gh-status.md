---
description: Inspect live GitHub state alongside local execution state and guide safe recovery of interrupted work.
argument-hint: "[--project <path>]"
---

Follow `skills/github-convention/SKILL.md` and `skills/github-convention/references/state-recovery.md`:

`$ARGUMENTS`

Steps:

1. Run `github-convention status --output json` (or `github-convention state list` / `show`) to inspect local execution state.
2. Query live GitHub Issues, PRs, branches, and CI checks to reconcile any drift with local state.
3. Summarize actionable next steps without mutating remote state unless approved.
