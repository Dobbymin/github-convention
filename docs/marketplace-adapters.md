# Marketplace Packaging Adapters

## 1. Optional packaging model

Marketplace packaging in `@dobbymin/github-convention-agent-adapters` is strictly optional. The canonical `github-convention` Skill works directly through `.agents/skills/github-convention/` and the standard agent adapters (`docs/agent-adapters.md`) without requiring any marketplace bundle.

Marketplace adapters exist only to stage format-specific metadata around the canonical Skill for external distribution channels when explicitly requested.

## 2. Single canonical source guarantee

Every marketplace adapter reads `.agents/skills/github-convention/` as its single canonical source using `computeDirectoryManifest` from `@dobbymin/github-convention-core`:

- Adapters **never** fork, rewrite, or maintain separate copies of `SKILL.md` or `references/*.md`.
- Every staged bundle computes an aggregate `canonicalSourceSha256` digest across all sorted canonical file hashes and sizes.
- Copied files in a staged `outDir` must match the canonical SHA-256 hashes byte-for-byte.

## 3. Verified marketplace formats

Only verified formats are registered and advertised by `listMarketplaceAdapters()` and `getMarketplaceAdapter(formatId)`:

| Format ID             | Name                      | Adapter Metadata File        | Staged Skill Path           |
| --------------------- | ------------------------- | ---------------------------- | --------------------------- |
| `claude-plugin`       | Claude Code Plugin Bundle | `.claude-plugin/plugin.json` | `skills/github-convention/` |
| `agents-skill-bundle` | Open Agents Skill Bundle  | `bundle.json`                | `github-convention/`        |

Unverified or unknown format IDs are rejected with an error.

## 4. Dry-run planning, staging, and cleanup

Each `MarketplacePackagingAdapter` supports:

- `planPackage(options)` / `packageForMarketplace({ ...options, dryRun: true })`:
  - Performs **zero** filesystem mutations.
  - Returns the canonical file manifest, `canonicalSourceSha256`, and planned adapter-owned output paths.
- `packageForMarketplace({ ...options, outDir })`:
  - Writes only adapter metadata, verbatim canonical Skill files, and `.marketplace-manifest.json` (recording `canonicalSourceSha256` and `ownedFiles`) into `outDir`.
- `cleanMarketplaceArtifacts(outDir)`:
  - Reads `.marketplace-manifest.json` and deletes **only** unmodified adapter-owned files whose SHA-256 matches the manifest record.
  - Preserves unrelated user files and any adapter-owned files modified after staging.

## 5. Approval gate before publication

Marketplace adapters **only** stage local artifacts and never publish to any external registry or marketplace. Any marketplace submission or publication requires explicit user approval before execution.

## 6. Repository root manifests vs. local staging adapters

This repository also ships root marketplace manifests (`.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.codex-plugin/plugin.json`, `gemini-extension.json`, `plugin.json`) so supported platforms can install `skills/github-convention/` directly from GitHub without running the CLI first.

- **Root marketplace manifests**: Distribute this repository's authoring Skill (`skills/github-convention/`) directly. Their versions and paths are verified against `packages/skill/package.json` by `npm run verify:manifests`.
- **Local staging adapters (`@dobbymin/github-convention-agent-adapters`)**: Stage a target project's installed `.agents/skills/github-convention/` into an explicit `outDir` as described in Sections 1–5 above.
