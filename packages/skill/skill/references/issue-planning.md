# Issue Planning Reference

## Parent and Sub-issue structure

- Create one Parent Issue for a cohesive outcome, then create a Sub-issue for each independently implementable task. Use a standalone Issue only when no parent outcome groups the work.
- A markdown checklist or a draft display grouped by Parent is not a GitHub parent-child relationship. After the approved Issues exist, create the native Sub-issue relationship using GitHub's REST API (`POST /repos/{owner}/{repo}/issues/{parent_number}/sub_issues` with the child Issue ID), or set `parent_issue_id` when creating the child. Verify each relationship by reading the child’s parent Issue.
- Use GitHub native `Blocked by`/`Blocking` relationships only for hard execution dependencies. Parent-child grouping alone does not imply a blocker.
- Keep the Parent Issue's checklist synchronized for readability, but treat the native relationship as authoritative.

## Template precedence and native links

- Prefer the target repository's existing Issue templates. GitHub UI Markdown templates commonly live in `.github/ISSUE_TEMPLATE/`; `config.yml` can disable blank Issues. A PR body template commonly lives at `.github/pull_request_template.md`.
- Reuse bundled templates only when the target repository has no suitable template. Do not overwrite or copy repository-specific `.github` templates automatically.
- Parent numbers and body checklists are descriptive only. For Issues created by the Orchestrator, create the approved Issue first, add the child through GitHub's native Sub-issue API, and verify its parent. For Issues created manually in GitHub UI, use the native relationship control; do not add an Action that infers relationships from body text.

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
