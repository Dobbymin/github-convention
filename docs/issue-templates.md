# Issue Templates

Use existing repository templates when they already express the project's conventions. These templates are defaults only when no suitable project template exists.

Generated Issue titles and bodies must use the user's language. For Korean-language requests, write the complete title and body in Korean while preserving technical identifiers and code verbatim. A Parent's Sub-issues checklist is for readability; link child Issues through GitHub's native parent-child relationship as described in the Issue planning reference.

## Repository-native GitHub templates

The templates used by this repository's GitHub UI live at:

- `.github/ISSUE_TEMPLATE/01-parent-issue.md`
- `.github/ISSUE_TEMPLATE/02-work-issue.md`
- `.github/ISSUE_TEMPLATE/03-bug-report.md`
- `.github/ISSUE_TEMPLATE/04-follow-up.md`
- `.github/ISSUE_TEMPLATE/config.yml` — disables blank Issues
- `.github/pull_request_template.md`

The prompts are Korean; titles and authored content follow the requester's language. The Parent, Work, Bug, and Follow-up templates default to `type:epic`, `type:task`, `type:bug`, and `type:task`. Change the Type Label when another category better describes the work. Priority and Scope Labels remain optional.

A Parent number or checklist in an Issue body does not create a parent-child relationship. The Orchestrator links approved Issues it creates through GitHub's Sub-issue API and verifies the relationship. For Issues created directly in GitHub UI, add the native relationship from the Parent Issue page. No GitHub Action parses template text to create that relationship.

The reusable PR body source is [`templates/PULL_REQUEST_TEMPLATE.md`](../templates/PULL_REQUEST_TEMPLATE.md). It mirrors this repository's active `.github/pull_request_template.md` and remains separate from target-repository UI templates.

## Reusable Issue structures

## Parent Issue

```markdown
## Summary

Describe the overall goal and why it matters.

## Goals

- Goal 1

## Scope

### In scope

- ...

### Out of scope

- ...

## Sub-issues

- [ ] #123 Task name

## Acceptance Criteria

- [ ] Integrated feature works as expected.

## References

- PRD / design / architecture links
```

## Sub-issue

```markdown
## Summary

One independently implementable task.

## Context

Why this task exists and relevant project context.

## Requirements

- Requirement 1

## Tasks

- [ ] Task 1

## Acceptance Criteria

- [ ] Observable, testable condition 1

## Dependencies

- Blocked by: #123 (only if this is a hard dependency)

## Technical Notes

- API/schema/contracts, affected modules, allowed scope.

## Assumptions

- Explicit assumptions; use `None` when there are none.

## References

- Relevant docs, PRs, code paths.
```

## Generated follow-up Issue

When a worker or CI task fails repeatedly, create a new follow-up Issue (approval required) and connect it under the existing Parent:

```markdown
## Summary

Follow-up task created after the original task could not be completed safely.

## Origin

- Original Issue: #123
- Parent Issue: #100

## Completed Work

- ...

## Remaining Work

- ...

## Failure Analysis

- Failure class:
- Attempts:
- Root cause / unknowns:

## Recovery Context

- Changed files:
- Tests and results:
- Relevant redacted logs:
- Worktree/branch reference:

## Acceptance Criteria

- [ ] ...
```
