# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

## [0.1.0] - 2026-11-21

### Added

- TypeScript/Node.js npm workspace foundation (`@github-convention/core`, `@github-convention/cli`, `@github-convention/agent-adapters`, `@github-convention/github-adapter`, `@github-convention/skill`) and cross-platform CI (Linux, macOS, Windows).
- CLI command framework (`--output text|json`, `--non-interactive`, `--dry-run`) and wired commands: `install`, `update`, `uninstall`, `list`, `doctor`, `init`, `validate`, `status`, `cleanup`, `plan validate|apply`, and `state list|show|restore`.
- Config YAML parser, recursive merge, safety invariants, schema migrations, atomic `StateManager` with file locking, and recovery archive lifecycle.
- Agent adapter registry and capability prober supporting 7 agents: `codex`, `claude-code`, `gemini-cli`, `antigravity`, `opencode`, `kilo`, and `copilot`.
- Marketplace packaging adapters (`claude-plugin`, `agents-skill-bundle`) and standalone release artifact builder (`scripts/release/build-artifacts.mjs`).
- GitHub adapter, dependency scheduler, worktree isolation, worker contract verification, secret-scan/PR quality gates, review/CI remediation loop, branch protection & deployment observer, approval-gated release planner, and opt-in lifecycle notifications.
- Repository domain glossary (`GLOSSARY.md`) and ADR (`docs/adr/0001-copilot-adapter-skill-paths.md`).

### Fixed

- Resolved bundled canonical skill lookup during `install` on external repositories so `validate` succeeds without requiring a local `skills/` folder in the target repo.
- Removed 3 tracked `.DS_Store` files from Git index.
