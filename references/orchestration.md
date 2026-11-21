# Orchestration Reference

## Choosing execution mode

Use Main Agent only for small or tightly coupled tasks. Use sequential execution for hard dependencies. Use Sub Agents only when meaningful independent tasks exist and the installed runtime supports safe delegation.

## Concurrency

Effective concurrency is the minimum of:

- User/Project configured cap
- Agent runtime capacity
- Safe concurrency after file-overlap/dependency analysis
- Resource budget

If no cap is configured, estimate conservatively. Never create workers simply to use available capacity.

## Isolation

Prefer verified native Agent isolation only if each worker receives a distinct writable workspace and Git remains Orchestrator-controlled. Otherwise create a separate Git Worktree per worker. Never share a writable worktree between workers.

## Authority

Orchestrator alone manages branches/worktrees, commits, pushes, Issues, Labels, dependencies, PRs, review resolution, and State. Workers only edit their assigned files and run tests. Workers do not commit or use GitHub write operations.

## Worker report (English only)

```markdown
## Task Report

- Issue: #123
- Status: completed | blocked | failed

### Summary

One or two sentences.

### Changed Files

- `path/to/file.ts`

### Tests

- Unit Tests: PASS
- Integration Tests: PASS
- Type Check: PASS

### Technical Decisions

- None.

### Known Issues

- None.

### Blockers

- None.
```

Keep reports short. Do not include secrets or verbose chain-of-thought/reasoning. Report findings, decisions, test outcomes, and blockers only.

## Failure policy

A failure stops that task and its hard dependents; independent tasks continue. Default: initial attempt plus two retries. Stop early for repeated identical errors, unsafe state, missing permissions, or external prerequisites. After retry exhaustion, prepare a new follow-up Issue under the Parent and request approval.

## Integration

Orchestrator reads each report, checks the actual diff, validates scope, reruns tests, checks secret scanning, and records state. A worker's claim is not proof of successful validation.
