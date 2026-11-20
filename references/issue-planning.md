# Issue Planning Reference

## Parent Issue

Use a Parent Issue for a cohesive feature or outcome. It should contain summary, goals, in/out of scope, Sub-issue checklist, overall acceptance criteria, and source references.

## Sub-issue

Each Sub-issue must state:
- One task summary and context
- Concrete requirements
- Checklist of implementation tasks
- Testable Acceptance Criteria
- Hard dependencies (only when actually blocking)
- Technical/interface notes
- Assumptions and references

Prefer the repository's existing Issue template. Use the bundled templates only when none exists.

## Approval

Present Issues grouped by Parent. The user can approve/reject a whole group or edit/approve/reject individual items. Only approved drafts are created. Non-approved drafts remain local and are not automatically discarded.

Before creation, check GitHub for duplicates and current labels. Use a stable plan/task marker to make retry idempotent.

## Dependencies

Use GitHub native `Blocked by`/`Blocking` relationships. Do not create a hard block merely because two tasks are related. A documented stable interface contract can permit parallel FE/BE implementation. When an upstream task is excluded, preserve downstream approval but mark it locally blocked until the dependency is resolved.

## Follow-up Issues

After a task exhausts retries, propose a new follow-up Issue under the existing Parent. Include origin Issue, completed/remaining work, retry count, failure analysis, changed files, test results, redacted logs, and recovery context. Approval is required before creation.

Priority is impact-based for failures. Code-review improvements explicitly classified as high-priority follow-ups retain `high`. A failed task is not automatically high priority merely because it failed.
