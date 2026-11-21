# Agent Adapter Registry

## Adapter goals

The Skill uses an open `SKILL.md` package format. The adapter layer is responsible only for agent-specific detection, location mapping, safe install/update/uninstall, and capability reporting. The workflow itself must not fork into different GitHub conventions per Agent.

## Initial adapter set

| Adapter ID    | Agent                | Project Skill path                                     | Global Skill path                                                 | Detection hints                                         |
| ------------- | -------------------- | ------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------- |
| `codex`       | OpenAI Codex         | `.agents/skills/<name>/`                               | `~/.agents/skills/<name>/`                                        | `codex` executable and/or known Codex home config       |
| `claude-code` | Claude Code          | `.claude/skills/<name>/`                               | `~/.claude/skills/<name>/`                                        | `claude` executable and/or Claude config directory      |
| `gemini-cli`  | Gemini CLI           | `.agents/skills/<name>/` or `.gemini/skills/<name>/`   | `~/.agents/skills/<name>/` or `~/.gemini/skills/<name>/`          | `gemini` executable and Gemini config                   |
| `antigravity` | Google Antigravity   | `.agents/skills/<name>/`                               | `~/.gemini/config/skills/<name>/`                                 | `agy`/Antigravity application metadata and known config |
| `opencode`    | OpenCode             | `.agents/skills/<name>/` or `.opencode/skills/<name>/` | `~/.agents/skills/<name>/` or `~/.config/opencode/skills/<name>/` | `opencode` executable and OpenCode config               |
| `kilo`        | Kilo Code / Kilo CLI | `.agents/skills/<name>/` or `.kilo/skills/<name>/`     | `~/.agents/skills/<name>/` or `~/.kilo/skills/<name>/`            | `kilo` executable and Kilo config                       |
| `copilot`     | GitHub Copilot CLI   | `.github/skills/<name>/` or `.agents/skills/<name>/`   | `~/.copilot/skills/<name>/`                                       | `copilot` executable and `~/.copilot` config            |

Paths are discovery locations from current official documentation at the date of this specification. Do not hard-code the table as unquestionable truth: adapters must probe the path/version and expose the selected target in `doctor` and install previews.

## Canonical-source rules

- Project source of truth: `.agents/skills/github-convention/`.
- Most listed agents can discover `.agents/skills` directly or as a compatibility location.
- Claude Code uses `.claude/skills`; create a managed directory symlink to the canonical source where possible.
- If symlink is unavailable, create a manifest-tracked local copy. Do not modify the canonical source from the generated copy.
- The CLI must record whether the target is `native`, `symlink`, or `copy`.
- For a copy, record per-file hash and source version; detect manual edits before update/uninstall.

## Detection confidence

`detected` should be one of:

- `confirmed`: executable/version or authoritative config validated.
- `probable`: known config directory exists but executable not found.
- `unknown`: only a weak hint exists.
- `not_found`.

Only `confirmed` and user-selected `probable` Agents should be modified.

## Capability map

Each adapter reports:

```json
{
  "supportsAgentSkills": true,
  "supportsProjectSkills": true,
  "supportsGlobalSkills": true,
  "supportsSymlinkDiscovery": true,
  "supportsNativeWorkerDelegation": "unknown",
  "supportsNativeWorkspaceIsolation": "unknown",
  "supportsSkillReload": "unknown"
}
```

`true`, `false`, and `unknown` are distinct. Unknown features are not assumed.

## Official documentation snapshot

- Codex: https://learn.chatgpt.com/docs/build-skills
- Claude Code: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
- Gemini CLI: https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/using-agent-skills.md
- Antigravity: https://antigravity.google/docs/skills
- OpenCode: https://opencode.ai/docs/skills
- Kilo: https://github.com/Kilo-Org/kilocode/blob/main/packages/kilo-docs/pages/customize/skills.md

**Verification date:** 2026-11-21. Re-check before implementation release because Agent paths, compatibility aliases, and CLI commands may change.
