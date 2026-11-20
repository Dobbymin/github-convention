# GitHub Convention

**Cross-agent GitHub workflow Skill + CLI**  
Design specification · 2026-11-21 · Draft v1.0

`github-convention` is an installable, agent-independent Skill package and companion CLI for applying consistent GitHub development workflows across AI coding agents and projects.

It is designed around one principle:

> The Main Agent owns planning, orchestration, Git, and GitHub mutations. Worker/Sub Agents may implement and test isolated tasks, but they do not commit, push, create PRs, or mutate GitHub state.

## Contents

- [System specification](SPEC.md) — goals, architecture, workflows, safety, state, and implementation defaults.
- [Initial Skill package](skills/github-convention/SKILL.md) — installable `SKILL.md` draft and focused references.
- [Consolidated decisions](docs/decision-register.md) — grouped record of agreed policies.
- [CLI contract](docs/cli-contract.md) — commands, flags, output, errors, and approval behavior.
- [Agent adapters](docs/agent-adapters.md) — detection, capability model, and verified Skill locations.
- [Issue templates](docs/issue-templates.md) — Parent Issue and Sub-issue templates.
- [Implementation roadmap](ROADMAP.md) — proposed epics and implementation order. These are drafts, not GitHub Issues already created.
- [Default configuration](examples/config.yaml) — example Global/Project settings.
- [Example execution state](examples/state.json) — example local state document.
- [Config schema](schemas/config.schema.json) and [state schema](schemas/state.schema.json).

## Product shape

- **Skill:** `SKILL.md` plus focused references and templates. It gives the AI Agent the workflow and decision rules.
- **CLI:** TypeScript/Node.js utility for deterministic installation, validation, state handling, file integrity, Git operations, and GitHub operations.
- **Adapters:** Agent-specific installation/discovery/capability mappings; GitHub access prefers the user's existing `gh` authentication.
- **Marketplace publishing:** supported as a later distribution adapter where a platform exposes a suitable marketplace format.

## Important boundaries

- No telemetry or analytics.
- No background daemon is required.
- No user approval is inferred in non-interactive mode.
- No real Project/GitHub Issue is created by reading this specification.
- The repository's canonical Project Skill source is `.agents/skills/github-convention/` and is Git-tracked. Generated compatibility copies are derived files and should be ignored by Git.

## Development

The repository is an npm workspace and requires Node.js 22 or later.

```bash
npm ci
npm run build
npm run format:check
npm run lint
npm run typecheck
npm test
```

`packages/cli` and `packages/skill` keep independent package versions. The CLI validates the Skill compatibility range before it executes.

## Status

The package foundation is in progress. Platform paths and discovery behavior can evolve; the CLI must validate the installed agent's actual capabilities and avoid relying on a hard-coded assumption when detection is ambiguous.
