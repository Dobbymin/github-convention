# GitHub Label Policy

## Governance

- Every Issue must have exactly one Type Label.
- A Parent Issue uses `type:epic`. A Sub-issue uses the Type that describes its actual work.
- Repository template defaults are `type:epic` for Parent, `type:task` for Work and Follow-up, and `type:bug` for Bug. Change the default when another Type better describes the work.
- Priority is optional. At most one Priority Label may be applied. Leave it unset when priority is unclear.
- Scope is optional. Multiple Scope Labels may be applied.
- When the repository has no project-specific taxonomy, use [`../templates/labels.yaml`](../templates/labels.yaml) as the default catalog.
- Reuse an existing project Label when its meaning matches a catalog entry. Do not create a second Label with the same meaning.
- Do not delete or rename an existing Label without explicit user approval. Propose description or color changes separately.
- GitHub native Issue dependencies express blockers. Do not create a `blocked` Label.
- Do not use Status Labels by default.
- Before creating Labels, compare the catalog with live repository Labels and report compatible, missing, conflicting, deprecated-candidate, and duplicate-candidate entries. Create only missing, non-conflicting Labels after explicit user approval.

## Catalog fields

Each catalog entry defines `name`, `description`, `color` (six-digit hex without `#`), `category`, `applicability`, and `required`. Optional `migrated_from` records an existing Label name that was renamed into the catalog entry.

`required` means the category requirement applies to an Issue when the entry's applicability matches; it does not mean every entry in that category is applied. For Type, select exactly one applicable entry. For Priority and Scope, entries are optional.

## Repository reconciliation (2026-11-21)

Repository: [`Dobbymin/github-convention`](https://github.com/Dobbymin/github-convention)

Live state was re-read with `gh label list --limit 100 --json name,color,description` after the approved bootstrap.

- Created 17 missing, non-conflicting Labels from the catalog.
- Renamed `bug` to `type:bug`, `enhancement` to `type:feature`, and `documentation` to `type:docs`.
- Renamed `priority: P0` to `priority:high` and updated its description to the catalog definition. This resolves the prior scale conflict by treating P0 as high priority.
- Renaming preserved the existing Label association on Issues and removed the legacy duplicate names. No Issue label associations were discarded.
- No standalone Label deletion was needed. No other existing Label was changed.

### Remaining existing project Labels

These remain unchanged and are not entries in the default catalog:

| Name                | Color    | Description                                |
| ------------------- | -------- | ------------------------------------------ |
| `accessibility`     | `f143ab` | Barrier affecting people with disabilities |
| `duplicate`         | `cfd3d7` | This issue or pull request already exists  |
| `good first issue`  | `7057ff` | Good for newcomers                         |
| `help wanted`       | `008672` | Extra attention is needed                  |
| `invalid`           | `e4e669` | This doesn't seem right                    |
| `question`          | `d876e3` | Further information is requested           |
| `scope: foundation` | `1d76db` | Repository and package foundation work     |
| `wontfix`           | `ffffff` | This will not be worked on                 |

The default catalog now has no missing, conflicting, deprecated, or duplicate candidates in this repository. `scope: foundation` remains a project-specific extension.

## Bootstrap result

The live repository now contains all 21 catalog Labels. Existing compatible Labels were migrated by renaming them, preserving their Issue associations. The bootstrap commands are recorded by the repository state; do not rerun creation or rename operations unless a later reconciliation identifies drift.
