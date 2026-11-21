# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

## [0.1.1] - 2026-11-21

### Changed

- Migrated workspace package scope to `@dobbymin/github-convention-*` (`@dobbymin/github-convention-cli`, `@dobbymin/github-convention-core`, `@dobbymin/github-convention-agent-adapters`, `@dobbymin/github-convention-github-adapter`, `@dobbymin/github-convention-skill`) with public npm publish configuration (`publishConfig.access = "public"`).
- Recorded personal npm scope decision in `docs/adr/0002-personal-npm-scope-dobbymin.md`.

### Fixed

- Resolved `@dobbymin/github-convention-skill/package.json` cleanly across installed npm packages instead of relying on monorepo relative path `../../skill/package.json`.
- Bundled canonical `skill/` assets inside `@dobbymin/github-convention-skill` so `npx @dobbymin/github-convention-cli install` works in external repositories.

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
