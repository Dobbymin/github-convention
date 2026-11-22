---
name: review-ci-loop
description: Use when triaging Pull Request review comments, resolving review threads, or diagnosing and retrying CI check failures.
---

# PR Review & CI Remediation Loop

Handle straightforward review and CI fixes autonomously within bounded retries, while escalating design decisions, permissions, and exhausted failures to the user.

## PR Review Triage

1. **Auto-fix without asking**:
   - Straightforward naming, style, formatting, simple exception handling, or missing test requests.
2. **Require explicit user approval first**:
   - Architecture changes, business-logic changes, or requirement changes requested in review.
3. **After every fix**:
   - Re-run impacted tests, quality gates, secret scan, and self-review (`agents/pr-reviewer.md`, optionally incorporating `dev-principles` reviewer outputs if available in a single Orchestrator-coordinated pass).
   - Orchestrator commits and pushes to the existing PR branch (reviewers and workers never commit or push).
4. **Review thread resolution**:
   - Auto-resolve only simple review threads that are fully addressed and verified.
   - Leave design, architecture, or open discussion threads unresolved for human confirmation.

## CI Failure Classification & Retry Policy

Inspect failing CI logs (`gh run view --log-failed`) and classify each failure:

| Failure Class | Action | Retry Bound |
| :--- | :--- | :--- |
| Code / test / lint / type / build failure | Diagnose root cause, fix, re-verify locally, push | Initial + up to **2** retries |
| Transient external / network / runner flake | Re-run failed jobs (`gh run rerun --failed`) | Up to **3** retries |
| Permissions / secrets / user-owned config | Stop retrying and ask the user with exact error | 0 retries (user input) |

- Never silence or bypass a new code-caused failure as an "environment issue".
- Never disable CI checks or hooks to make a run green.

## Retry Exhaustion

When code or CI retries are exhausted:

1. Preserve partial work and failure context (failing check, error summary, redacted logs).
2. Propose a new follow-up Issue under the existing Parent Issue (`skills/issue-planning/SKILL.md`).
3. Obtain explicit user approval before creating the follow-up Issue.
