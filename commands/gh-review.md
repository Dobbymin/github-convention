---
description: Triage Pull Request review comments, resolve verified simple threads, and diagnose or retry CI failures.
argument-hint: "[PR number]"
---

Follow `skills/using-github-convention/SKILL.md` and `skills/review-ci-loop/SKILL.md` for:

`$ARGUMENTS`

Steps:

1. Inspect PR review comments and CI check status (`gh pr view`, `gh pr checks`, `gh run view --log-failed`).
2. Auto-fix straightforward style/naming/exception/test requests; ask for explicit user approval before architecture, business-logic, or requirement changes.
3. Classify CI failures (code vs transient vs permissions/config), retry within bounds, re-run verification, and propose an approval-gated follow-up Issue if retries are exhausted.
