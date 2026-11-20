# Security, Deployment, Release, and Notifications

## Secret scanning

Reuse the project's existing scanner. If none exists, propose a scanner and obtain approval before installation. Scan staged changes before commit, again before push/PR, and in CI. A likely real secret blocks commit/push. Redact values from all logs/reports. If a secret was pushed, advise immediate revocation/rotation; removing the line is insufficient.

## Hooks

Reuse existing hooks. Propose installation/change only with approval. Bypass only a diagnosed tool/environment problem, recording command and reason. Never bypass new code-caused failures or permanently disable hooks.

## Branch protection

Inspect existing rules and propose changes. Apply only after user approval. Never silently modify team repository settings.

## Deployment

After merge, inspect configured deployment and Health Check results. Retry transient failures within bounds. Ask for missing user-controlled settings. If Health Check fails, stop further deployment actions and report. Rollback requires user approval.

## Release

Existing project release convention wins. If absent, use SemVer. Analyse Conventional Commits and Breaking Changes, draft CHANGELOG and Release Notes, show proposed version and obtain approval before Tag/GitHub Release creation.

## Notifications

Notify only on important events: overall start/finish, approval needed, repeated worker failure, unrecoverable CI failure, PR ready/Merge waiting, and deployment failure. Session/CLI output is default. External notification providers are optional adapters and must not be required for core operation. No telemetry.
