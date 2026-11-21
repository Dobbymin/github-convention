---
description: Run read-only diagnostics and config/state validation for github-convention in the current repository.
argument-hint: "[--project <path>]"
---

Run read-only diagnostics for the current repository:

`$ARGUMENTS`

Steps:

1. Run `github-convention doctor --output json` and `github-convention validate --output json`.
2. Report detected agents, canonical Skill integrity, `.github-convention/config.yaml` schema status, and any remediation steps.
3. Do not modify files or install adapters without explicit user confirmation.
