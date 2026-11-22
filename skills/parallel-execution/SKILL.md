---
name: parallel-execution
description: Use when coordinating implementation tasks across sequential or parallel workers, isolating workspaces with git worktrees, and verifying worker diffs.
---

# Parallel Execution & Orchestration

Choose the simplest safe execution mode for the task graph, isolate any parallel workers, and verify every diff and test before committing.

## Choosing Execution Mode

- **Main Agent alone**: small or tightly coupled tasks.
- **Sequential**: tasks with hard `Blocked by` dependencies or high file overlap.
- **Parallel Sub Agents**: only when truly independent tasks exist, file scopes are disjoint, and the runtime supports safe delegation.

## Dynamic Concurrency Cap

Never assume unlimited workers or spawn workers just to fill capacity. Effective concurrency is the minimum of:

1. User or `.github-convention/config.yaml` cap (`execution.max_parallel_agents`, default conservative estimate if unset).
2. Agent runtime capacity.
3. Safe concurrency after file-overlap and dependency analysis.
4. Resource budget.

## Workspace Isolation

- Prefer verified native workspace isolation only when each worker gets a distinct writable workspace and Git remains Orchestrator-controlled.
- Otherwise, create a dedicated Git Worktree per worker (`git worktree add`). Never share a writable worktree between workers.

## Authority & Worker Contract

- **Orchestrator** owns all branches, worktrees, rebases, commits, pushes, Issues, labels, dependencies, PRs, review-thread resolution, and shared Local State.
- **Workers** (`agents/task-worker.md`) implement and run tests only. Workers must never commit, push, create/edit/close Issues, create PRs, merge, resolve review threads, or write shared Local State.
- Give each worker: single Issue, acceptance criteria, interface context, allowed scope, file ownership hints, and exact test commands.

## Mandatory Worker Report (English Only)

Require every worker to reply with this concise format (no secrets, no verbose reasoning):

```markdown
## Task Report

- Issue: #123
- Status: completed | blocked | failed

### Summary

One or two sentences.

### Changed Files

- `path/to/file`

### Tests

- Unit Tests: PASS
- Type Check: PASS

### Technical Decisions

- None.

### Known Issues

- None.

### Blockers

- None.
```

## Verification, Commits & Failure Policy

1. Never trust a worker report without verification. Inspect the actual `git diff`, verify file scope, rerun relevant tests, and run secret scanning.
2. Commit each independently scoped work unit after acceptance criteria, checks, and secret scan pass. Do not start unrelated work with a completed unit left uncommitted. Keep incomplete/blocked work uncommitted.
3. Independent tasks continue when another worker fails; stop only the failed task and its hard dependents.
4. Retry policy: initial attempt plus up to 2 retries. Stop early on repeated identical errors, unsafe state, missing permissions, or external prerequisites.
5. After retry exhaustion, preserve partial work/failure context and propose an approval-gated follow-up Issue under the existing Parent.
