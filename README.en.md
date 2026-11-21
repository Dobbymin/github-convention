# github-convention

[![npm version](https://img.shields.io/npm/v/@dobbymin/github-convention-cli)](https://www.npmjs.com/package/@dobbymin/github-convention-cli)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-339933)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[한국어](README.md) | [English](README.en.md)

**An AI agent Skill and CLI that applies a consistent, Issue-driven GitHub development workflow without forking your repository's conventions.**

The Main Agent (Orchestrator) owns repository analysis, Issue planning, explicit approval gates, state tracking, and PR/release coordination, while optional parallel workers stay isolated to implementation and testing.

---

## Quick Start

See [`INSTALL.md`](INSTALL.md) for detailed platform instructions and uninstallation options.

### 1. Direct Marketplace / Plugin Install (Claude Code, etc.)

```text
/plugin marketplace add Dobbymin/github-convention
/plugin install github-convention
```

### 2. Project Setup via Node CLI (`Node >= 22`)

```bash
npx @dobbymin/github-convention-cli doctor --project .
npx @dobbymin/github-convention-cli init --project .
npx @dobbymin/github-convention-cli install --project .
```

### 3. Lightweight Shell Installer (Skill-only, no Node CLI required)

```bash
./install.sh --scope project
```

---

## Slash Commands & Conditional Session Hook

- **`commands/` slash commands:** Thin entry points wired to `skills/github-convention/SKILL.md` and `references/`:
  - `gh-plan`: Analyze repository conventions and draft an Issue dependency DAG
  - `gh-pr`: Verify branch rules, quality gates, secret scan, and create/update a PR
  - `gh-status`: Reconcile live GitHub state with local execution state
  - `gh-doctor`: Run read-only `doctor` and `validate` diagnostics
- **`hooks/` conditional `SessionStart` hook:** Emits a short workflow reminder only when `.github-convention/config.yaml` exists in the current working directory; exits silently in unrelated repositories.

---

## Workflow & Approval Boundaries

1. **Analyze:** Inspect existing Issue/PR templates, labels, branch/commit conventions, and CI gates with local hash caching.
2. **Plan:** Propose bounded Issues and `Blocked by` dependencies; never create remote Issues without explicit approval.
3. **Execute:** Isolate optional parallel workers in dedicated worktrees; workers cannot commit, push, merge, or mutate shared state.
4. **PR & Release:** Create PRs only after build, lint, typecheck, tests, and secret scans pass; merging, tagging, and publishing always require explicit approval.

---

## Supported Agents & Docs

Supports `codex`, `claude-code`, `gemini-cli`, `antigravity`, `opencode`, `kilo`, and `copilot` (see [`docs/agent-adapters.md`](docs/agent-adapters.md)).

- [Install Guide (`INSTALL.md`)](INSTALL.md)
- [CLI Contract (`docs/cli-contract.md`)](docs/cli-contract.md)
- [Marketplace Adapters (`docs/marketplace-adapters.md`)](docs/marketplace-adapters.md)
- [Distribution (`docs/distribution.md`)](docs/distribution.md) · [Release Workflow (`docs/release-workflow.md`)](docs/release-workflow.md)
- [Issue Templates (`docs/issue-templates.md`)](docs/issue-templates.md) · [Label Policy (`docs/label-policy.md`)](docs/label-policy.md) · [PR Template (`templates/PULL_REQUEST_TEMPLATE.md`)](templates/PULL_REQUEST_TEMPLATE.md)
- [Examples (`examples/config.yaml`, `examples/state.json`)](examples/config.yaml) · [Schemas (`schemas/config.schema.json`, `schemas/state.schema.json`)](schemas/config.schema.json)

---

## Local Development

Requires Node.js 22+:

```bash
npm ci
npm run build
npm run format:check
npm run lint
npm run typecheck
npm test
npm run verify:manifests
npm run test:scripts
```

## License

[MIT License](LICENSE)
