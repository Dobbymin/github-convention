# Release Workflow and Approval Gate

## 1. Release Policy Precedence

When proposing a release with `proposeRelease` in `@dobbymin/github-convention-core`, existing repository release policy takes precedence over commit-derived versioning:

1. **Existing policy version (`existingPolicyVersion`)**: If configured, `proposedVersion` uses the policy-specified version (stripping an optional leading `v`) and sets `versionSource` to `"existing_policy"`.
2. **Existing tag format (`existingPolicyTagFormat`)**: Formats `tagName` using `{version}` substitution (for example, `release-{version}`) or prefix concatenation, defaulting to `v{version}` when omitted.
3. **Fallback to Conventional Commits**: When no `existingPolicyVersion` is present, `proposeRelease` derives the SemVer bump from the commit set and sets `versionSource` to `"conventional_commits"`.

## 2. SemVer Derivation and Changelog Drafting

When deriving the next version from Conventional Commits:

| Commit Signal                                                                   | SemVer Bump |
| ------------------------------------------------------------------------------- | ----------- |
| Any commit with `!` in header or `BREAKING CHANGE:` / `BREAKING-CHANGE:` footer | `major`     |
| Any `feat` commit (without breaking changes)                                    | `minor`     |
| `fix`, other Conventional Commit types, or uncategorized commits                | `patch`     |

`proposeRelease` groups parsed commits into **Breaking Changes**, **Features**, **Fixes**, and **Other Changes**, and drafts both:

- `changelog`: A Keep a Changelog-compatible Markdown section (`## [<tagName>] - <YYYY-MM-DD>`).
- `releaseNotes`: A GitHub Release summary (`# Release <tagName>`) including version provenance and categorized entries.

## 3. Explicit Approval Gate Before Tag and Release Creation

Tag creation and GitHub Release publication are strictly gated by `executeGatedRelease` in `@dobbymin/github-convention-github-adapter`:

- **Explicit approval required**: `explicitApproval: true` is mandatory before any `git tag`, `git push`, or `gh release create` command is invoked.
- **Non-interactive safety (`--non-interactive`)**: Running with `nonInteractive: true` and without `explicitApproval: true` returns `status: "approval_required"`, `executed: false`, and performs zero local git or remote GitHub mutations.
- **Dry-run preview (`dryRun: true`)**: Returns `status: "dry_run"` and `executed: false` along with `plannedCommands` so operators can inspect the exact `git` and `gh` invocations before approving.
- **Secret redaction**: Release notes are passed through `redactSecrets` before being included in planned or executed `gh release create` arguments.
