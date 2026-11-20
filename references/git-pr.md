# Git and Pull Request Reference

## Git ownership

Orchestrator owns all branch, worktree, rebase, commit, push, PR, and Issue mutations. Workers do not perform Git/GitHub write operations. User owns PR Merge.

## Before creating a PR

1. Verify acceptance criteria.
2. Run repository quality checks and tests.
3. Run secret scan.
4. Inspect the complete diff and perform self-review.
5. Fetch and rebase latest configured default branch.
6. Re-run tests affected by the rebase.
7. Verify Issue title/body/labels/links.

Do not create Draft PRs by default. Each Sub-issue gets its own PR. Use repository naming conventions first; otherwise propose a conventional branch/commit/title scheme. PR title fallback includes the Issue number.

## Updating other open PRs

After a PR merges, inspect the changed files and dependency graph. Rebase only branches materially affected by the change. Coordinate with or pause an active worker before changing its workspace. Resolve simple conflicts only; ask on complex conflicts or design decisions.

## Review requests

Auto-fix straightforward style, naming, exception handling, or missing test requests. Ask before architecture, business-logic, or requirement changes. Re-run checks and self-review; update the same PR. Resolve only simple verified threads; keep design discussions open.

## CI failures

Classify code/test/lint/type/build problems (up to two retries), transient network/external service problems (up to three retries), and user-controlled permission/secret/configuration issues (ask user). After retry exhaustion, propose a follow-up Issue under the Parent.
