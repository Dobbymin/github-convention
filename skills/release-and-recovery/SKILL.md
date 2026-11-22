---
name: release-and-recovery
description: Use when running secret scans, managing hooks or branch protection, verifying post-merge deployments, preparing SemVer releases, or recovering interrupted workflow state.
---

# Security, Release & State Recovery

Protect secrets and hooks, gate releases and rollbacks on explicit approval, and reconcile interrupted local work against live GitHub state.

## Secret Scanning & Hooks

- Reuse the repository's existing secret scanner before commits, pushes, PRs, and in CI. If none exists, propose one and obtain user approval before installing it.
- A likely real secret blocks commit/push. Redact secret values from all logs and reports. If already exposed remotely, advise immediate revocation/rotation (removing the line is insufficient).
- Reuse existing Git hooks. Propose hook/CI installation or edits only with approval.
- Hook bypass (`--no-verify`) is permitted only for a diagnosed tool/environment failure: record the exact command and reason, never bypass new code-caused failures, and never delete or permanently disable hooks.

## Branch Protection, Deployment & Release

- **Branch protection**: Inspect existing rules and propose changes; apply only after user approval.
- **Post-merge deployment**: Verify PR/Issue state and inspect configured deployment and Health Check results. Retry transient errors within bounds; ask for missing user-controlled settings. If Health Check fails, stop further deployment actions and report. Never auto-rollback without explicit approval.
- **Release**: Respect existing project release policy. If none exists, use Semantic Versioning, analyze Conventional Commits and Breaking Changes, draft `CHANGELOG.md` and Release Notes, show the proposed version, and obtain explicit approval before creating Git Tags or GitHub Releases.
- **Notifications & Privacy**: Notify only on key lifecycle events (start/finish, approval needed, repeated worker failure, unrecoverable CI failure, PR ready/merge waiting, deployment failure). Session output is default; external adapters are optional. Zero telemetry.

## Lightweight Local State & Interrupted Work Recovery

- GitHub is authoritative for remote Issue, dependency, PR, Merge, and CI state.
- Optional project overrides live at `.github-convention/config.yaml` and `.github-convention/conventions/`.
- Optional local execution state (unapproved Issue drafts, worktree/worker tracking, retry counts, approval records) may live under `.github-convention/state/active/` (gitignored). Save atomically after meaningful transitions.
- **Resume protocol**:
  1. Read `.github-convention/state/active/` if present, plus `git worktree list` and `git status`.
  2. Query live GitHub Issues, dependencies, PRs, and CI states; reconcile remote facts over stale local cache.
  3. Skip tasks already verified complete on GitHub.
  4. Inspect in-progress worktrees and diffs before resuming; preserve existing commits and uncommitted work.
  5. If approval cannot be verified, ask again. If worktree ownership or status is ambiguous, stop and report.
  6. Archive completed runs or clean stale state only after confirming no active work remains.
