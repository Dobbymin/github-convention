# CLI Contract

## 1. Command surface

| Command | Purpose | Mutates? |
|---|---|---:|
| `install` | Detect/select Agents; install Global/Project Skill | Yes |
| `update` | Preview and apply CLI/Skill updates with integrity and 3-way merge | Yes |
| `uninstall` | Remove only unchanged CLI-owned installation files | Yes |
| `list` | Show installed Agents, scopes, versions, and link/copy status | No |
| `doctor` | Diagnose OS, Node, Git, gh auth, Agent paths, permissions, schema, integrity | No (except optional cleanup if explicitly requested) |
| `init` | Initialise Project Config, canonical Skill folder, ignore rules, and analysis | Yes |
| `validate` | Validate config, skill metadata, manifests, State, and conventions | No |
| `status` | Show run/Issue/PR/Agent status | No |
| `cleanup` | Expired archive cleanup and verified temporary artifact cleanup | Yes |
| `plan validate` | Validate a generated workflow/Issue plan | No |
| `plan apply` | Apply an approved plan to GitHub, idempotently | Yes |
| `state list|show|restore` | Inspect or restore archived execution state | Restore mutates local state |

The AI Agent performs semantic project analysis and decides what the plan should contain. The CLI validates and applies deterministic parts of the plan; it must not invent requirements or silently approve actions.

## 2. Common flags

```text
--agent <id[,id...]>          one or more adapter IDs
--scope <global|project|both> install scope; interactive mode can set per Agent
--non-interactive             never prompt; return approval_required when needed
--output <text|json>          default text
--dry-run                     calculate and display intended changes without mutation
--yes                         confirm only non-policy prompts; never bypass protected approvals
--project <path>              explicit Project root; default detected Git root
--config <path>               explicit config path for diagnosis/validation
--verbose                     more local diagnostic detail; still redact secrets
```

`--dry-run` is supported for every mutating command. It may perform read-only inspection but must not create directories, change files, create GitHub resources, alter settings, or acquire long-lived state.

## 3. Interactive behavior

`install` flow:

1. Detect candidate Agents.
2. Show confidence/status for each candidate.
3. Allow multi-select.
4. Let the user choose Global/Project/Both separately per selected Agent.
5. Show target paths and symlink/copy strategy.
6. Preview file changes.
7. Apply only after required confirmation.

If a Project root is not detected, ask for it interactively. In non-interactive mode, require `--project` or a valid current repository root.

## 4. Approval semantics

The following remain human approvals in both Interactive and Non-interactive modes:

- Creating new GitHub Issues from generated drafts
- Installing a new project tool such as a Secret Scanner or modifying hook/CI configuration
- Applying Branch Protection/Ruleset changes
- Architecture/business-logic/requirements changes arising from review comments
- Rollback after deployment/Health Check failure
- Creating a GitHub Release/Tag
- Any unresolved destructive/data-loss conflict

In non-interactive mode, the CLI returns `status: "approval_required"` and performs no protected mutation. `--yes` must not bypass this policy.

## 5. JSON output envelope

Successful or approval-pending output follows a stable envelope:

```json
{
  "schemaVersion": 1,
  "success": true,
  "status": "completed",
  "command": "install",
  "data": {},
  "warnings": [],
  "errors": []
}
```

For approval:

```json
{
  "schemaVersion": 1,
  "success": false,
  "status": "approval_required",
  "command": "plan apply",
  "data": { "approvalId": "approval-...", "summary": "Create 6 Issues" },
  "warnings": [],
  "errors": [{ "code": "APPROVAL_REQUIRED", "message": "Explicit user approval is required." }]
}
```

When `--output json` is set, stdout must contain valid JSON only. Human progress/detail goes to stderr only when explicitly enabled; default JSON runs keep stdout parseable.

## 6. Exit codes

| Exit | Meaning |
|---:|---|
| 0 | Completed successfully, including a valid dry-run plan |
| 1 | General operation failure |
| 2 | Invalid arguments or invalid known configuration |
| 3 | Approval required / pending |
| 4 | Authentication or permission failure |
| 5 | Integrity, merge, or unsafe path conflict |
| 6 | Lock busy / concurrent operation |
| 7 | External GitHub/Agent dependency unavailable |

A machine-readable error code in the JSON envelope is more specific than the process exit code.

## 7. Idempotency

Remote writes must be safe to retry. Before creating an Issue/PR/Label/dependency, query current remote state. Include a stable plan/task marker in generated Issue bodies. If the matching object exists, reuse/update only after verifying repository, marker, and content; never create a duplicate merely because a previous response was lost.

## 8. Example invocations

```bash
# Detect and install interactively
github-convention install

# Install into two Agents at Project scope
github-convention install --agent codex,claude-code --scope project --dry-run

# JSON diagnostics
github-convention doctor --output json --non-interactive

# Validate Project configuration
github-convention validate --project . --output json

# Preview update
github-convention update --scope project --dry-run

# List installed adapters and versions
github-convention list --output json
```
