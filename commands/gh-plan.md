---
description: Analyze repository conventions, break down work into an Issue dependency DAG, and draft/create Issues with explicit approval.
argument-hint: "[goal or feature summary]"
---

Follow `skills/using-github-convention/SKILL.md` and `skills/issue-planning/SKILL.md` for:

`$ARGUMENTS`

Steps:

1. Inspect existing repository conventions (templates, labels, CI, branch/commit rules, and optional `.github-convention/config.yaml`) using `agents/repo-analyzer.md` when helpful.
2. Query live GitHub Issues (`gh issue list`) and labels (`gh label list`) before proposing drafts.
3. Present Parent/Sub-issue drafts, acceptance criteria, and hard `Blocked by` dependencies for explicit user approval before creating any remote Issue.
