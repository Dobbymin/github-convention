---
description: Run read-only diagnostics for git, gh authentication, repository conventions, and github-convention plugin integrity.
argument-hint: "[--verbose]"
---

Run read-only diagnostics for the current repository:

`$ARGUMENTS`

Steps:

1. Verify `git --version`, repository root, default branch, and `gh auth status`.
2. Inspect `.github/ISSUE_TEMPLATE/`, `.github/pull_request_template.md`, labels, CI workflows, optional `.github-convention/config.yaml`, and any detected companion plugin (`dev-principles`) boundary status.
3. Report detected conventions, plugin/hook readiness, and any remediation steps without modifying files.
