# Issue Templates

Use existing repository templates when they already express the project's conventions. These templates are defaults only when no suitable project template exists.

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
