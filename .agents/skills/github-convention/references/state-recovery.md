# State and Recovery Reference

## Source of truth

GitHub is authoritative for remote Issue, dependency, PR, Merge, and CI states. Local State stores execution detail: plan DAG, workers, worktrees, file scope, retry counts, checkpoints, report digests, approval records, and cache references.

## Storage

- Project Config: `.github-convention/config.yaml` (YAML, Git-tracked)
- Conventions: `.github-convention/conventions/` (Git-tracked)
- Cache: `.github-convention/cache/` (JSON, ignored)
- Active State: `.github-convention/state/active/` (JSON, ignored)
- Archive: `.github-convention/state/archive/` (JSON, ignored)
- Logs: `.github-convention/logs/` (redacted, ignored)

One State JSON file per execution plan/Parent run. Only Orchestrator writes it. Save after every meaningful state transition using atomic write.

## Locking

Acquire a project-level exclusive lock before any mutating workflow. Record PID, host, run ID, process start, and timestamp. Never remove a lock unless ownership is verified stale. If another live Orchestrator holds it, return `LOCK_BUSY`; do not concurrently mutate worktrees/state.

## Resume

1. Read and validate Local State.
2. Fetch current GitHub Issue/dependency/PR state.
3. Reconcile remote facts into local state.
4. Skip completed tasks verified by remote state.
5. Inspect in-progress worktree and diffs before resuming.
6. Preserve commits/uncommitted work.
7. If approval cannot be verified, ask again.
8. If ownership or status is ambiguous, stop and report.

## Archive

Move completed runs to archive. Default retention is 30 days, configurable globally and per project. Run cleanup on the next CLI invocation; do not run a background daemon. Never delete active runs. Allow inspect/restore.
