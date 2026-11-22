---
name: git-pr-workflow
description: Use when creating branches, committing work units, running pre-PR quality gates and secret scans, rebasing, or creating and updating Pull Requests.
---

# Git & Pull Request Workflow

Keep Git mutations Orchestrator-owned, commit clean work units, pass all quality and secret gates, and link every PR to its Issue.

## Branch & Work-Unit Commits

- Verify the repository's default branch before branching. Never push directly to the protected default branch.
- Prefer repository branch/commit/PR conventions; otherwise use Conventional Commit style (`{type}/{issue}-{slug}` branches, `feat:`/`fix:`/`refactor:`/`docs:`/`test:`/`chore:` commits).
- Commit each independently scoped work unit once its acceptance criteria, relevant checks, and secret scan pass. A larger Issue may produce multiple clean commits on its branch.
- Verify artifact language (Korean when user writes/requests Korean; keep prefixes, identifiers, commands, and closing keywords intact).
- Never use plain `git push --force`. Use `--force-with-lease` only when required on a branch you own after verifying remote state.

## Pre-PR Checklist (All 7 Required)

1. Verify all Issue acceptance criteria are met.
2. Run existing repository quality gates (format, lint, typecheck, build, unit/integration tests). New code-caused failures must be fixed, never bypassed.
3. Run secret scan on staged/branch changes (reuse existing scanner; block on likely real secrets).
4. Inspect the complete diff against the base branch and perform self-review (delegate read-only review to `agents/pr-reviewer.md` when helpful).
5. Fetch and rebase onto the latest configured default branch.
6. Re-run tests impacted by the rebase.
7. Verify Issue/PR title, body, labels, and links.

## PR Creation & Template Precedence

- Each Sub-issue gets its own branch and PR. Do not create Draft PRs by default.
- Use the target repository's existing PR template (such as `.github/pull_request_template.md`) when present. Use `templates/PULL_REQUEST_TEMPLATE.md` only as fallback.
- Include the matching Issue closing keyword (`Closes #123` / `Fixes #123`). For a Sub-issue PR, close the child Issue rather than its Parent.
- Prefer `gh pr create`; use a connected Agent GitHub tool only if `gh` cannot perform the operation.
- Never merge a PR; the user owns Merge.

## Updating Other Open PRs After Merge

- After a PR merges, inspect changed files and the dependency graph.
- Rebase only open branches materially affected by the merged change.
- Coordinate with or pause any active worker before touching its workspace.
- Resolve simple conflicts only; ask the user on complex conflicts or design decisions.
