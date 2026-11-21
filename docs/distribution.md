# Distribution and Release Architecture

## 1. Release channels

`github-convention` distributes through two primary channels:

1. **npm packages**: Workspace packages under `packages/*` (`@dobbymin/github-convention-cli`, `@dobbymin/github-convention-skill`, `@dobbymin/github-convention-core`, `@dobbymin/github-convention-agent-adapters`, `@dobbymin/github-convention-github-adapter`). Every package declares `"files"` whitelists, `"engines": { "node": ">=22" }`, `"exports"`, `"repository"`, and `"homepage"`. Internal/unreleased packages keep `"private": true` until an approved release prepares them for publishing.
2. **Standalone GitHub Release artifacts**: Platform archives, OS-specific launchers, `targets.json`, and `SHA256SUMS.txt` staged by `scripts/release/build-artifacts.mjs --out <dir>`.

## 2. Independent CLI and Skill SemVer compatibility

CLI (`@dobbymin/github-convention-cli`) and Skill (`@dobbymin/github-convention-skill`) evolve on independent SemVer schedules and declare compatibility in both directions:

- `packages/cli/package.json` defines `githubConvention.supportedSkill` (for example, `"^0.1.0"`).
- `packages/skill/package.json` defines `githubConvention.compatibleCli` (for example, `"^0.1.0"`).

`scripts/release/build-artifacts.mjs` validates both directions using `isCompatibleVersion` from `@dobbymin/github-convention-core` before packaging:

- `isCompatibleVersion(cli.version, skill.githubConvention.compatibleCli)`
- `isCompatibleVersion(skill.version, cli.githubConvention.supportedSkill)`

If either check fails, or if `npm pack --dry-run --json` includes forbidden paths (`.harness/`, `_workspace/`, `.env`, or secret/key files), packaging aborts with a non-zero exit code.

## 3. Verified OS and architecture target matrix

Only CI-verified targets are advertised in `targets.json`:

| Target         | OS       | Arch    | Archive                                            | Launcher                            |
| -------------- | -------- | ------- | -------------------------------------------------- | ----------------------------------- |
| `linux-x64`    | `linux`  | `x64`   | `github-convention-v<version>-linux-x64.tar.gz`    | `github-convention-linux-x64.sh`    |
| `darwin-arm64` | `darwin` | `arm64` | `github-convention-v<version>-darwin-arm64.tar.gz` | `github-convention-darwin-arm64.sh` |
| `darwin-x64`   | `darwin` | `x64`   | `github-convention-v<version>-darwin-x64.tar.gz`   | `github-convention-darwin-x64.sh`   |
| `win32-x64`    | `win32`  | `x64`   | `github-convention-v<version>-win32-x64.tar.gz`    | `github-convention-win32-x64.cmd`   |

Unsupported OS/architecture combinations are excluded from `targets.json` and release artifacts.

## 4. Checksum verification

Every staged release directory includes `SHA256SUMS.txt` covering all `.tar.gz` archives, launcher scripts, and `targets.json`.

Verify checksums on Linux/macOS:

```sh
sha256sum -c SHA256SUMS.txt
```

Verify a single file on Windows PowerShell:

```powershell
Get-FileHash .\github-convention-v0.1.0-win32-x64.tar.gz -Algorithm SHA256
```

## 5. Release workflow and approval gate

`.github/workflows/release.yml` runs on `workflow_dispatch` (with `dry_run: true` by default) and on `v*` tag pushes:

1. `verify-and-package` runs across `ubuntu-latest`, `macos-latest`, and `windows-latest`: `npm ci`, `npm run build`, `npm test`, `node --test scripts/release/release.test.mjs`, `node scripts/release/build-artifacts.mjs --out dist-release`, and artifact upload.
2. `publish` depends on `verify-and-package`, targets the protected `release` GitHub environment, and runs only when triggered by a `v*` tag push or when `inputs.dry_run == false`.

The protected `release` environment enforces an explicit human approval gate before any npm publish or GitHub Release publication occurs.
