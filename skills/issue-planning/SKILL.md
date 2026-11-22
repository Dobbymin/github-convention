---
name: issue-planning
description: Use when analyzing repository conventions, splitting work into Parent and Sub-issues, defining dependency DAGs, or drafting Issues for user approval.
---

# Issue Planning

Analyze existing repository conventions before proposing any GitHub Issues, decompose work into verifiable tasks, and obtain explicit approval before remote creation.

## Convention Inspection

1. Inspect existing project instructions, `.github/ISSUE_TEMPLATE/`, `config.yml`, `.github/pull_request_template.md`, commit/branch patterns, scripts, quality gates, labels, CI workflows, and release policy. Delegate read-only discovery to `agents/repo-analyzer.md` when helpful.
2. If project documents conflict with `.github-convention/config.yaml` or each other, show the conflicting sources, ask the user, and record the resolution so it is not asked again.

## Task Decomposition & Dependency DAG

- Decompose work into independently implementable and verifiable tasks. Never split work merely to increase parallelism.
- Create one Parent Issue for a cohesive feature/outcome, then Sub-issues for each independent task. Use a standalone Issue only when no parent outcome groups the work.
- Create a hard `Blocked by` / `Blocking` dependency only when a downstream task truly cannot proceed before upstream completes. Parent-child grouping alone is not a blocker.
- FE/BE work may run in parallel when an API/interface contract is settled and documented. If uncertain, resolve the contract first or mark the implementation a true dependency.

## Issue Content & Template Precedence

1. Prefer the target repository's existing Issue templates (`.github/ISSUE_TEMPLATE/`). Reuse bundled templates (`docs/issue-templates.md`, `templates/labels.yaml`) only when no suitable template exists. Never overwrite target `.github/` templates automatically.
2. **Parent Issue**: summary, goals, in/out of scope, Sub-issue checklist, overall acceptance criteria, and source references.
3. **Sub-issue**:
   - One task summary and context
   - Concrete requirements and implementation checklist
   - Testable Acceptance Criteria
   - Hard dependencies (only when actually blocking)
   - Technical/interface notes, assumptions, and references

## Approval & Idempotent Creation

1. Present draft Issues grouped by Parent. Support group-level approval as well as per-Issue edit/approve/reject/exclude.
2. **Label Precedence & Creation Approval**: Inspect live repository labels (`gh label list`) and prefer existing labels first. Obtain explicit user approval before creating new remote labels (including optional sets from `templates/labels.yaml`).
3. Create **only** explicitly approved Issues. Keep unapproved drafts locally (for example in `.github-convention/state/active/` if used) without silently discarding them.
4. If an approved Issue depends on an excluded/unapproved Issue, keep it approved but mark it blocked; never silently remove the dependency.
5. Before every remote write, query live GitHub Issues and labels to prevent duplicates. Use a stable plan/task marker so retries stay idempotent.

## Native Sub-issue & Dependency Links

- Markdown checklists or text references alone do not create GitHub relationships.
- After creating approved Parent and Sub-issues, link each child via GitHub's native Sub-issue REST API (`POST /repos/{owner}/{repo}/issues/{parent_number}/sub_issues` with the child Issue ID, or `parent_issue_id` at creation) and verify by reading the child's parent Issue.
- Keep the Parent Issue checklist synchronized for readability, while treating the native relationship as authoritative.
- Apply native `Blocked by` / `Blocking` relationships for hard dependencies.

## Follow-up Issues

- After a task exhausts retries, draft a follow-up Issue under the existing Parent containing: origin Issue, completed/remaining work, retry count, failure analysis, changed files, test results, redacted logs, and recovery context.
- Priority is impact-based (failed tasks are not automatically `priority:high`; explicit high-priority code-review follow-ups retain `high`). Obtain user approval before creation.
