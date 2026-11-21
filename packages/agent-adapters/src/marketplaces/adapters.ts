import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import {
  atomicWriteJson,
  computeDirectoryManifest,
  computeFileHash,
  type FileHashRecord,
} from "@dobbymin/github-convention-core";
import adapterPackage from "../../package.json" with { type: "json" };
import type {
  MarketplaceCleanResult,
  MarketplaceFormatId,
  MarketplaceOwnedFileRecord,
  MarketplacePackageOptions,
  MarketplacePackagePlan,
  MarketplacePackageResult,
  MarketplacePackagingAdapter,
  MarketplacePackagingManifest,
  PlannedAdapterFile,
} from "./types.js";

export const MARKETPLACE_MANIFEST_FILENAME = ".marketplace-manifest.json";
const DEFAULT_SKILL_NAME = "github-convention";
const require = createRequire(import.meta.url);

const resolveDefaultPackageVersion = (): string => {
  try {
    const skillPkg = require("@dobbymin/github-convention-skill/package.json") as {
      version?: unknown;
    };
    if (typeof skillPkg.version === "string" && skillPkg.version.trim()) {
      return skillPkg.version;
    }
  } catch {
    // Fallback to adapter package version
  }
  return adapterPackage.version;
};
const SKILL_DESCRIPTION =
  "Apply a consistent, safe, Issue-driven GitHub development workflow without forking repository conventions.";

const toPosixPath = (p: string): string => p.split(path.sep).join("/");

const sha256Buffer = (content: string | Buffer): { sha256: string; size: number } => {
  const buf = typeof content === "string" ? Buffer.from(content, "utf-8") : content;
  return {
    sha256: crypto.createHash("sha256").update(buf).digest("hex"),
    size: buf.length,
  };
};

export const resolveCanonicalSkillDir = (options?: MarketplacePackageOptions): string => {
  if (options?.canonicalSourceDir) {
    return path.normalize(path.resolve(options.canonicalSourceDir));
  }
  const projectDir = options?.projectDir ? path.resolve(options.projectDir) : process.cwd();
  return path.normalize(path.join(projectDir, ".agents", "skills", DEFAULT_SKILL_NAME));
};

export const computeAggregateCanonicalSha256 = (canonicalFiles: FileHashRecord[]): string => {
  const sorted = [...canonicalFiles].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const hash = crypto.createHash("sha256");
  for (const record of sorted) {
    hash.update(`${toPosixPath(record.relativePath)}:${record.sha256}:${record.size}\n`);
  }
  return hash.digest("hex");
};

interface FormatDescriptor {
  id: MarketplaceFormatId;
  name: string;
  description: string;
  metadataRelativePath: string;
  skillTargetPrefix: string;
  buildMetadata: (params: {
    version: string;
    canonicalSourceSha256: string;
  }) => Record<string, unknown>;
}

const FORMAT_DESCRIPTORS: FormatDescriptor[] = [
  {
    id: "claude-plugin",
    name: "Claude Code Plugin Bundle",
    description:
      "Optional Claude Code plugin marketplace package referencing the canonical github-convention Skill.",
    metadataRelativePath: ".claude-plugin/plugin.json",
    skillTargetPrefix: `skills/${DEFAULT_SKILL_NAME}`,
    buildMetadata: ({ version, canonicalSourceSha256 }) => ({
      name: DEFAULT_SKILL_NAME,
      version,
      description: SKILL_DESCRIPTION,
      skills: "./skills",
      canonicalSourceSha256,
    }),
  },
  {
    id: "agents-skill-bundle",
    name: "Open Agents Skill Bundle",
    description:
      "Optional .agents/skills distribution bundle packaging the canonical github-convention Skill.",
    metadataRelativePath: "bundle.json",
    skillTargetPrefix: DEFAULT_SKILL_NAME,
    buildMetadata: ({ version, canonicalSourceSha256 }) => ({
      name: DEFAULT_SKILL_NAME,
      version,
      description: SKILL_DESCRIPTION,
      skillPath: `./${DEFAULT_SKILL_NAME}/SKILL.md`,
      canonicalSourceSha256,
    }),
  },
];

interface BuiltPlanInternal {
  plan: MarketplacePackagePlan;
  metadataJson: string;
  ownedFiles: MarketplaceOwnedFileRecord[];
}

class BaseMarketplaceAdapter implements MarketplacePackagingAdapter {
  readonly id: MarketplaceFormatId;
  readonly name: string;
  readonly description: string;
  readonly verified = true as const;
  readonly manifestFilename = MARKETPLACE_MANIFEST_FILENAME;
  private readonly descriptor: FormatDescriptor;

  constructor(descriptor: FormatDescriptor) {
    this.descriptor = descriptor;
    this.id = descriptor.id;
    this.name = descriptor.name;
    this.description = descriptor.description;
  }

  private buildPlanInternal(options?: MarketplacePackageOptions): BuiltPlanInternal {
    const canonicalSourceDir = resolveCanonicalSkillDir(options);
    if (!fs.existsSync(canonicalSourceDir)) {
      throw new Error(`Canonical skill source directory not found: ${canonicalSourceDir}`);
    }

    const canonicalFiles = computeDirectoryManifest(canonicalSourceDir);
    if (canonicalFiles.length === 0) {
      throw new Error(`Canonical skill source directory is empty: ${canonicalSourceDir}`);
    }

    const canonicalSourceSha256 = computeAggregateCanonicalSha256(canonicalFiles);
    const version = options?.version ?? resolveDefaultPackageVersion();
    const dryRun = options?.dryRun ?? false;
    const outDir = options?.outDir ? path.normalize(path.resolve(options.outDir)) : undefined;

    const metadataObj = this.descriptor.buildMetadata({
      version,
      canonicalSourceSha256,
    });
    const metadataJson = `${JSON.stringify(metadataObj, null, 2)}\n`;
    const metadataHash = sha256Buffer(metadataJson);
    const metadataRelPath = toPosixPath(this.descriptor.metadataRelativePath);

    const ownedFiles: MarketplaceOwnedFileRecord[] = [
      {
        relativePath: metadataRelPath,
        sha256: metadataHash.sha256,
        size: metadataHash.size,
        role: "adapter-metadata",
      },
    ];

    const plannedFiles: PlannedAdapterFile[] = [
      {
        relativePath: metadataRelPath,
        role: "adapter-metadata",
        sha256: metadataHash.sha256,
        size: metadataHash.size,
      },
    ];

    for (const file of canonicalFiles) {
      const normalizedSourceRel = toPosixPath(file.relativePath);
      const targetRel = `${toPosixPath(this.descriptor.skillTargetPrefix)}/${normalizedSourceRel}`;

      ownedFiles.push({
        relativePath: targetRel,
        sha256: file.sha256,
        size: file.size,
        role: "canonical-copy",
      });

      plannedFiles.push({
        relativePath: targetRel,
        role: "canonical-copy",
        sha256: file.sha256,
        size: file.size,
        sourceRelativePath: normalizedSourceRel,
      });
    }

    const manifestPreview: MarketplacePackagingManifest = {
      schemaVersion: 1,
      formatId: this.id,
      canonicalSourceDir: toPosixPath(canonicalSourceDir),
      canonicalSourceSha256,
      canonicalFiles,
      ownedFiles,
      generatedAt: new Date(0).toISOString(),
    };
    const manifestPreviewHash = sha256Buffer(`${JSON.stringify(manifestPreview, null, 2)}\n`);

    plannedFiles.push({
      relativePath: this.manifestFilename,
      role: "packaging-manifest",
      sha256: manifestPreviewHash.sha256,
      size: manifestPreviewHash.size,
    });

    return {
      plan: {
        formatId: this.id,
        canonicalSourceDir,
        canonicalFiles,
        canonicalSourceSha256,
        plannedFiles,
        outDir,
        dryRun,
      },
      metadataJson,
      ownedFiles,
    };
  }

  planPackage(options?: MarketplacePackageOptions): MarketplacePackagePlan {
    return this.buildPlanInternal({ ...options, dryRun: true }).plan;
  }

  packageForMarketplace(options?: MarketplacePackageOptions): MarketplacePackageResult {
    const internal = this.buildPlanInternal(options);
    const { plan, metadataJson, ownedFiles } = internal;

    if (plan.dryRun) {
      return {
        formatId: this.id,
        dryRun: true,
        outDir: plan.outDir,
        canonicalSourceSha256: plan.canonicalSourceSha256,
        canonicalFiles: plan.canonicalFiles,
        plannedFiles: plan.plannedFiles,
        writtenFiles: [],
      };
    }

    if (!plan.outDir) {
      throw new Error("outDir is required when dryRun is false.");
    }

    const resolvedOutDir = path.resolve(plan.outDir);
    fs.mkdirSync(resolvedOutDir, { recursive: true });

    const writtenFiles: string[] = [];

    // Write adapter metadata
    const metadataTarget = path.join(resolvedOutDir, this.descriptor.metadataRelativePath);
    fs.mkdirSync(path.dirname(metadataTarget), { recursive: true });
    fs.writeFileSync(metadataTarget, metadataJson, "utf-8");
    writtenFiles.push(toPosixPath(this.descriptor.metadataRelativePath));

    // Copy canonical files verbatim (zero Skill forks)
    for (const planned of plan.plannedFiles) {
      if (planned.role !== "canonical-copy" || !planned.sourceRelativePath) {
        continue;
      }
      const sourcePath = path.join(plan.canonicalSourceDir, planned.sourceRelativePath);
      const targetPath = path.join(resolvedOutDir, planned.relativePath);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.copyFileSync(sourcePath, targetPath);
      writtenFiles.push(planned.relativePath);
    }

    // Write packaging manifest recording canonicalSourceSha256 & ownedFiles
    const manifest: MarketplacePackagingManifest = {
      schemaVersion: 1,
      formatId: this.id,
      canonicalSourceDir: toPosixPath(plan.canonicalSourceDir),
      canonicalSourceSha256: plan.canonicalSourceSha256,
      canonicalFiles: plan.canonicalFiles,
      ownedFiles,
      generatedAt: new Date().toISOString(),
    };
    const manifestPath = path.normalize(path.join(resolvedOutDir, this.manifestFilename));
    atomicWriteJson(manifestPath, manifest);
    writtenFiles.push(this.manifestFilename);

    return {
      formatId: this.id,
      dryRun: false,
      outDir: plan.outDir,
      canonicalSourceSha256: plan.canonicalSourceSha256,
      canonicalFiles: plan.canonicalFiles,
      plannedFiles: plan.plannedFiles,
      writtenFiles,
      manifestPath,
    };
  }

  cleanMarketplaceArtifacts(outDir: string): MarketplaceCleanResult {
    const resolvedOutDir = path.normalize(path.resolve(outDir));
    const manifestPath = path.join(resolvedOutDir, this.manifestFilename);

    if (!fs.existsSync(manifestPath)) {
      return {
        formatId: this.id,
        outDir: resolvedOutDir,
        removedFiles: [],
        skippedFiles: [],
        manifestRemoved: false,
      };
    }

    let manifest: MarketplacePackagingManifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as MarketplacePackagingManifest;
    } catch {
      return {
        formatId: this.id,
        outDir: resolvedOutDir,
        removedFiles: [],
        skippedFiles: [],
        manifestRemoved: false,
      };
    }

    if (manifest.formatId !== this.id || !Array.isArray(manifest.ownedFiles)) {
      return {
        formatId: this.id,
        outDir: resolvedOutDir,
        removedFiles: [],
        skippedFiles: [],
        manifestRemoved: false,
      };
    }

    const removedFiles: string[] = [];
    const skippedFiles: string[] = [];
    const candidateDirs = new Set<string>();

    for (const record of manifest.ownedFiles) {
      const normalizedRel = toPosixPath(record.relativePath);
      const targetPath = path.resolve(resolvedOutDir, normalizedRel);

      // Guard against path traversal outside outDir
      const relFromOutDir = path.relative(resolvedOutDir, targetPath);
      if (relFromOutDir.startsWith("..") || path.isAbsolute(relFromOutDir)) {
        skippedFiles.push(normalizedRel);
        continue;
      }

      if (!fs.existsSync(targetPath)) {
        continue;
      }

      const stat = fs.lstatSync(targetPath);
      if (!stat.isFile()) {
        skippedFiles.push(normalizedRel);
        continue;
      }

      const { sha256 } = computeFileHash(targetPath);
      if (sha256 !== record.sha256) {
        // Ownership/integrity check failed: preserve user-modified file
        skippedFiles.push(normalizedRel);
        continue;
      }

      fs.unlinkSync(targetPath);
      removedFiles.push(normalizedRel);

      let dir = path.dirname(targetPath);
      while (dir !== resolvedOutDir && dir.startsWith(resolvedOutDir)) {
        candidateDirs.add(dir);
        dir = path.dirname(dir);
      }
    }

    // Remove empty subdirectories deepest-first
    const sortedDirs = [...candidateDirs].sort((a, b) => b.length - a.length);
    for (const dir of sortedDirs) {
      if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
        fs.rmdirSync(dir);
      }
    }

    let manifestRemoved = false;
    if (skippedFiles.length === 0 && fs.existsSync(manifestPath)) {
      fs.unlinkSync(manifestPath);
      manifestRemoved = true;
    }

    return {
      formatId: this.id,
      outDir: resolvedOutDir,
      removedFiles,
      skippedFiles,
      manifestRemoved,
    };
  }
}

const MARKETPLACE_ADAPTERS: MarketplacePackagingAdapter[] = FORMAT_DESCRIPTORS.map(
  (descriptor) => new BaseMarketplaceAdapter(descriptor),
);

export const listMarketplaceAdapters = (): MarketplacePackagingAdapter[] => {
  return [...MARKETPLACE_ADAPTERS];
};

export const getMarketplaceAdapter = (
  formatId: MarketplaceFormatId,
): MarketplacePackagingAdapter => {
  const found = MARKETPLACE_ADAPTERS.find((adapter) => adapter.id === formatId);
  if (!found) {
    throw new Error(`Unsupported or unverified marketplace format: ${String(formatId)}`);
  }
  return found;
};
