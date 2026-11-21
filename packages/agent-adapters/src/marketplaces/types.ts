import type { FileHashRecord } from "@github-convention/core";

export type MarketplaceFormatId = "claude-plugin" | "agents-skill-bundle";

export type PlannedFileRole = "adapter-metadata" | "canonical-copy" | "packaging-manifest";

export interface MarketplacePackageOptions {
  /** Repository or workspace root used to resolve `.agents/skills/github-convention`. */
  projectDir?: string;
  /** Override path to the canonical Skill directory. */
  canonicalSourceDir?: string;
  /** Staging output directory. Required when `dryRun` is false. */
  outDir?: string;
  /** When true, inspect and plan without performing any filesystem mutations. */
  dryRun?: boolean;
  /** Package version recorded in adapter metadata (defaults to "0.1.0"). */
  version?: string;
}

export interface PlannedAdapterFile {
  /** POSIX-normalized relative path inside `outDir`. */
  relativePath: string;
  role: PlannedFileRole;
  sha256: string;
  size: number;
  /** Original relative path inside the canonical Skill directory for `canonical-copy` entries. */
  sourceRelativePath?: string;
}

export interface MarketplacePackagePlan {
  formatId: MarketplaceFormatId;
  canonicalSourceDir: string;
  canonicalFiles: FileHashRecord[];
  canonicalSourceSha256: string;
  plannedFiles: PlannedAdapterFile[];
  outDir?: string;
  dryRun: boolean;
}

export interface MarketplaceOwnedFileRecord {
  relativePath: string;
  sha256: string;
  size: number;
  role: Exclude<PlannedFileRole, "packaging-manifest">;
}

export interface MarketplacePackagingManifest {
  schemaVersion: number;
  formatId: MarketplaceFormatId;
  canonicalSourceDir: string;
  canonicalSourceSha256: string;
  canonicalFiles: FileHashRecord[];
  ownedFiles: MarketplaceOwnedFileRecord[];
  generatedAt: string;
}

export interface MarketplacePackageResult {
  formatId: MarketplaceFormatId;
  dryRun: boolean;
  outDir?: string;
  canonicalSourceSha256: string;
  canonicalFiles: FileHashRecord[];
  plannedFiles: PlannedAdapterFile[];
  writtenFiles: string[];
  manifestPath?: string;
}

export interface MarketplaceCleanResult {
  formatId: MarketplaceFormatId;
  outDir: string;
  removedFiles: string[];
  skippedFiles: string[];
  manifestRemoved: boolean;
}

export interface MarketplacePackagingAdapter {
  readonly id: MarketplaceFormatId;
  readonly name: string;
  readonly description: string;
  readonly verified: true;
  readonly manifestFilename: string;
  planPackage(options?: MarketplacePackageOptions): MarketplacePackagePlan;
  packageForMarketplace(options?: MarketplacePackageOptions): MarketplacePackageResult;
  cleanMarketplaceArtifacts(outDir: string): MarketplaceCleanResult;
}
