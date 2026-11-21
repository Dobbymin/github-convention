import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getAdapter, getAllAdapters } from "@dobbymin/github-convention-agent-adapters";
import {
  assertCompatibleVersions,
  computeDirectoryManifest,
  isCompatibleVersion,
  loadManifest,
  saveManifest,
  type FileHashRecord,
  type InstallManifest,
  type SkillScope,
  verifyManifestIntegrity,
} from "@dobbymin/github-convention-core";
import cliPackage from "../../package.json" with { type: "json" };
import { resolveSkillSourceDir } from "../install/installer.js";
import { validateAgentIds } from "../list/index.js";
import { hashRegularFile, lstatOrNull, resolveInside, safeRelativePath } from "./fs-utils.js";
import type {
  FileDiffAction,
  FileDiffItem,
  MultiUpdateResult,
  UpdateOptions,
  UpdatePlan,
  UpdateResult,
} from "./types.js";

const DEFAULT_SKILL_NAME = "github-convention";
const DEFAULT_SKILL_VERSION = "0.1.0";

const resolveSourceDir = (options: UpdateOptions, projectRoot: string): string => {
  if (options.sourceSkillDir) return options.sourceSkillDir;
  const localSkillDir = path.join(projectRoot, "skills", DEFAULT_SKILL_NAME);
  if (fs.existsSync(localSkillDir)) return localSkillDir;
  return resolveSkillSourceDir(projectRoot, options.sourceSkillDir) ?? localSkillDir;
};

const describeError = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const readSourceVersion = (sourceDir: string): string | undefined => {
  const packagePath = path.join(sourceDir, "package.json");
  if (!fs.existsSync(packagePath)) return undefined;
  try {
    const metadata = JSON.parse(fs.readFileSync(packagePath, "utf-8")) as { version?: unknown };
    return typeof metadata.version === "string" ? metadata.version : undefined;
  } catch {
    return undefined;
  }
};

const checkCompatibility = (sourceDir: string): void => {
  const packagePath = path.join(sourceDir, "package.json");
  if (!fs.existsSync(packagePath)) return;

  const metadata = JSON.parse(fs.readFileSync(packagePath, "utf-8")) as {
    version?: unknown;
    githubConvention?: { compatibleCli?: unknown };
  };
  const cliRange = metadata.githubConvention?.compatibleCli;
  if (typeof metadata.version !== "string") return;

  if (typeof cliRange === "string") {
    assertCompatibleVersions(cliPackage.version, metadata.version, cliRange);
  }

  const skillRange = `^${cliPackage.version}`;
  if (!isCompatibleVersion(metadata.version, skillRange)) {
    throw new Error(
      `Skill version ${metadata.version} is not compatible with CLI ${cliPackage.version} (${skillRange}).`,
    );
  }
};

const copyTree = (source: string, destination: string): void => {
  fs.cpSync(source, destination, { recursive: true, force: true, dereference: false });
};

const validateStaging = (stagingDir: string): void => {
  const skillFile = path.join(stagingDir, "SKILL.md");
  const stat = lstatOrNull(skillFile);
  if (!stat?.isFile()) {
    throw new Error("Staged installation is missing a regular SKILL.md file.");
  }

  const content = fs.readFileSync(skillFile, "utf-8");
  if (!/^---\r?\n[\s\S]*?\bname:\s*\S+/m.test(content)) {
    throw new Error("Staged SKILL.md is missing required frontmatter 'name' metadata.");
  }
};

const applyPlanToStaging = (plan: UpdatePlan, stagingDir: string, sourceDir: string): void => {
  for (const item of plan.files) {
    const stagedPath = resolveInside(stagingDir, item.relativePath);

    if (item.action === "add" || item.action === "update") {
      const sourcePath = resolveInside(sourceDir, item.relativePath);
      const sourceStat = lstatOrNull(sourcePath);
      if (!sourceStat?.isFile()) {
        throw new Error(`Remote source is not a regular file: '${item.relativePath}'`);
      }
      fs.mkdirSync(path.dirname(stagedPath), { recursive: true });
      fs.copyFileSync(sourcePath, stagedPath);
    } else if (item.action === "delete") {
      const stagedStat = lstatOrNull(stagedPath);
      if (stagedStat?.isFile() || stagedStat?.isSymbolicLink()) {
        fs.unlinkSync(stagedPath);
      }
    }
  }
};

const buildUpdatedManifest = (
  plan: UpdatePlan,
  stagingDir: string,
  sourceDir: string,
): InstallManifest => {
  const previousFiles = new Map(
    (plan.currentManifest?.files ?? []).map((record) => [
      safeRelativePath(record.relativePath).split(path.sep).join("/"),
      record,
    ]),
  );

  const files: FileHashRecord[] = [];
  for (const item of plan.files) {
    if (item.remoteHash === undefined) continue;

    if (item.action === "preserve_modified") {
      const prior = previousFiles.get(item.relativePath);
      if (prior) {
        files.push({
          relativePath: item.relativePath,
          sha256: prior.sha256,
          size: prior.size,
        });
        continue;
      }
      const remoteStat = hashRegularFile(resolveInside(sourceDir, item.relativePath));
      if (remoteStat) {
        files.push({
          relativePath: item.relativePath,
          sha256: remoteStat.sha256,
          size: remoteStat.size,
        });
      }
      continue;
    }

    const stagedHash = hashRegularFile(resolveInside(stagingDir, item.relativePath));
    if (stagedHash) {
      files.push({
        relativePath: item.relativePath,
        sha256: stagedHash.sha256,
        size: stagedHash.size,
      });
    }
  }

  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  return {
    schemaVersion: 1,
    skillName: plan.currentManifest?.skillName ?? DEFAULT_SKILL_NAME,
    skillVersion:
      readSourceVersion(sourceDir) ?? plan.currentManifest?.skillVersion ?? DEFAULT_SKILL_VERSION,
    installedAt: new Date().toISOString(),
    agentId: plan.currentManifest?.agentId ?? "canonical",
    scope: plan.currentManifest?.scope ?? "project",
    targetPath: plan.targetDir,
    installType: plan.currentManifest?.installType ?? "canonical",
    canonicalSourcePath: plan.currentManifest?.canonicalSourcePath,
    files,
  };
};

export function planUpdate(options: UpdateOptions = {}): UpdatePlan {
  const projectRoot = options.projectRoot ?? process.cwd();
  const targetDir =
    options.targetDir ?? path.join(projectRoot, ".agents", "skills", DEFAULT_SKILL_NAME);
  const sourceDir = resolveSourceDir(options, projectRoot);

  const targetStat = lstatOrNull(targetDir);
  const isSymlink = targetStat?.isSymbolicLink() ?? false;
  const currentManifest = loadManifest(targetDir);

  if (isSymlink) {
    return {
      targetDir,
      isSymlink: true,
      currentManifest,
      files: [],
      conflicts: [],
      summary: {
        add: 0,
        update: 0,
        delete: 0,
        preserve: 0,
        conflict: 0,
        unchanged: 0,
      },
    };
  }

  checkCompatibility(sourceDir);

  const baseFileMap = new Map<string, string>();
  if (currentManifest) {
    for (const file of currentManifest.files) {
      baseFileMap.set(safeRelativePath(file.relativePath).split(path.sep).join("/"), file.sha256);
    }
  }

  const remoteFiles = fs.existsSync(sourceDir) ? computeDirectoryManifest(sourceDir) : [];
  const remoteFileMap = new Map<string, string>();
  for (const file of remoteFiles) {
    remoteFileMap.set(file.relativePath, file.sha256);
  }

  const allRelativePaths = new Set<string>([...baseFileMap.keys(), ...remoteFileMap.keys()]);
  const fileDiffs: FileDiffItem[] = [];
  const conflicts: FileDiffItem[] = [];

  for (const relPath of allRelativePaths) {
    const baseHash = baseFileMap.get(relPath);
    const remoteHash = remoteFileMap.get(relPath);

    let localHash: string | undefined;
    let unsafeLocalPath = false;
    const localStat = lstatOrNull(resolveInside(targetDir, relPath));
    if (localStat?.isFile()) {
      localHash = hashRegularFile(resolveInside(targetDir, relPath))?.sha256;
    } else if (localStat !== null) {
      unsafeLocalPath = true;
    }

    let action: FileDiffAction = "unchanged";
    let reason = "File is unchanged";

    if (unsafeLocalPath) {
      action = "conflict";
      reason = "Managed path is not a regular file; refusing to follow it";
    } else if (baseHash !== undefined && remoteHash !== undefined) {
      if (localHash === undefined) {
        if (remoteHash === baseHash) {
          action = "delete";
          reason = "Locally deleted file kept deleted";
        } else {
          action = "conflict";
          reason = "File deleted locally but modified upstream";
        }
      } else if (localHash === baseHash) {
        if (remoteHash === baseHash) {
          action = "unchanged";
          reason = "No changes in local or upstream";
        } else {
          action = "update";
          reason = "Upstream file updated; local was clean";
        }
      } else if (remoteHash === baseHash) {
        action = "preserve_modified";
        reason = "User edits detected; upstream unchanged, preserving user version";
      } else if (localHash === remoteHash) {
        action = "unchanged";
        reason = "Local user edit matches upstream change";
      } else {
        action = "conflict";
        reason = "Overlapping edits between local user changes and upstream update";
      }
    } else if (baseHash === undefined && remoteHash !== undefined) {
      if (localHash !== undefined) {
        if (localHash === remoteHash) {
          action = "unchanged";
          reason = "Existing local file matches new upstream file";
        } else {
          action = "conflict";
          reason = "New upstream file collides with an existing unmanaged local file";
        }
      } else {
        action = "add";
        reason = "New upstream file added";
      }
    } else if (baseHash !== undefined && remoteHash === undefined) {
      if (localHash === baseHash) {
        action = "delete";
        reason = "Upstream removed file; local was clean";
      } else if (localHash !== undefined) {
        action = "preserve_modified";
        reason = "Upstream removed file, but local user modifications preserved";
      } else {
        action = "unchanged";
        reason = "Already removed locally and upstream";
      }
    }

    const diffItem: FileDiffItem = {
      relativePath: relPath,
      action,
      ...(baseHash !== undefined ? { baseHash } : {}),
      ...(localHash !== undefined ? { localHash } : {}),
      ...(remoteHash !== undefined ? { remoteHash } : {}),
      reason,
    };
    fileDiffs.push(diffItem);
    if (action === "conflict") conflicts.push(diffItem);
  }

  return {
    targetDir,
    isSymlink,
    currentManifest,
    files: fileDiffs,
    conflicts,
    summary: {
      add: fileDiffs.filter((file) => file.action === "add").length,
      update: fileDiffs.filter((file) => file.action === "update").length,
      delete: fileDiffs.filter((file) => file.action === "delete").length,
      preserve: fileDiffs.filter((file) => file.action === "preserve_modified").length,
      conflict: conflicts.length,
      unchanged: fileDiffs.filter((file) => file.action === "unchanged").length,
    },
  };
}

export function executeUpdate(options: UpdateOptions = {}): UpdateResult {
  const plan = planUpdate(options);

  if (options.dryRun) {
    return { targetDir: plan.targetDir, success: true, dryRun: true, plan };
  }

  if (plan.isSymlink) {
    return { targetDir: plan.targetDir, success: true, dryRun: false, plan };
  }

  if (plan.conflicts.length > 0) {
    return {
      targetDir: plan.targetDir,
      success: false,
      dryRun: false,
      plan,
      error: `Update halted: ${plan.conflicts.length} conflict(s) detected. User edits would be overwritten or are unsafe. Resolve them manually before retrying.`,
    };
  }

  const projectRoot = options.projectRoot ?? process.cwd();
  const sourceDir = resolveSourceDir(options, projectRoot);
  const targetParent = path.dirname(plan.targetDir);
  const workRoot = fs.existsSync(targetParent)
    ? fs.mkdtempSync(path.join(targetParent, ".github-convention-update-"))
    : fs.mkdtempSync(path.join(os.tmpdir(), "github-convention-update-"));
  const stagingDir = path.join(workRoot, "staging");
  const backupDir = path.join(workRoot, "backup");
  let backupCreated = false;

  try {
    if (fs.existsSync(plan.targetDir)) {
      copyTree(plan.targetDir, stagingDir);
      copyTree(plan.targetDir, backupDir);
      backupCreated = true;
    } else {
      fs.mkdirSync(stagingDir, { recursive: true });
    }

    applyPlanToStaging(plan, stagingDir, sourceDir);
    validateStaging(stagingDir);

    const updatedManifest = buildUpdatedManifest(plan, stagingDir, sourceDir);
    saveManifest(stagingDir, updatedManifest);

    const integrity = verifyManifestIntegrity(stagingDir, updatedManifest);
    const preservedUpstream = new Set(
      plan.files
        .filter((file) => file.action === "preserve_modified" && file.remoteHash !== undefined)
        .map((file) => file.relativePath),
    );
    const unexpectedModified = integrity.modifiedFiles.filter(
      (filePath) => !preservedUpstream.has(filePath),
    );
    if (integrity.missingFiles.length > 0 || unexpectedModified.length > 0) {
      throw new Error(
        `Staged integrity verification failed (modified: ${unexpectedModified.join(", ") || "none"}; missing: ${integrity.missingFiles.join(", ") || "none"}).`,
      );
    }

    fs.mkdirSync(path.dirname(plan.targetDir), { recursive: true });
    if (fs.existsSync(plan.targetDir)) {
      fs.rmSync(plan.targetDir, { recursive: true, force: true });
    }

    try {
      fs.renameSync(stagingDir, plan.targetDir);
    } catch {
      copyTree(stagingDir, plan.targetDir);
    }

    return { targetDir: plan.targetDir, success: true, dryRun: false, plan };
  } catch (err) {
    let rolledBack = false;
    if (backupCreated && fs.existsSync(backupDir)) {
      try {
        if (fs.existsSync(plan.targetDir)) {
          fs.rmSync(plan.targetDir, { recursive: true, force: true });
        }
        try {
          fs.renameSync(backupDir, plan.targetDir);
        } catch {
          copyTree(backupDir, plan.targetDir);
        }
        rolledBack = true;
      } catch {
        rolledBack = false;
      }
    }

    return {
      targetDir: plan.targetDir,
      success: false,
      dryRun: false,
      plan,
      rolledBack,
      error: `Update failed: ${describeError(err)}`,
    };
  } finally {
    fs.rmSync(workRoot, { recursive: true, force: true });
  }
}

const deduplicatePaths = (paths: readonly string[]): string[] => {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const candidate of paths) {
    const resolved = path.resolve(candidate);
    if (!seen.has(resolved)) {
      seen.add(resolved);
      unique.push(candidate);
    }
  }
  return unique;
};

export function resolveUpdateTargets(options: UpdateOptions = {}): string[] {
  const projectRoot = options.projectRoot ?? process.cwd();
  const homeDir = options.homeDir ?? options.globalRoot ?? os.homedir();
  const scope = options.scope ?? "project";
  const scopes: SkillScope[] = scope === "both" ? ["project", "global"] : [scope];
  const canonicalPath = path.join(projectRoot, ".agents", "skills", DEFAULT_SKILL_NAME);

  if (options.targetDir && (!options.agents || options.agents.length === 0)) {
    return deduplicatePaths([options.targetDir]);
  }

  if (options.agents && options.agents.length > 0) {
    const agentIds = validateAgentIds(options.agents);
    const resolved: string[] = [];
    for (const agentId of agentIds) {
      const adapter = getAdapter(agentId);
      for (const s of scopes) {
        const targetPath =
          s === "project"
            ? path.join(projectRoot, adapter.paths.projectSkillDir, DEFAULT_SKILL_NAME)
            : path.join(homeDir, adapter.paths.globalSkillDir, DEFAULT_SKILL_NAME);
        resolved.push(targetPath);
      }
    }
    return deduplicatePaths(resolved);
  }

  const discovered: string[] = [];
  if (scopes.includes("project")) {
    discovered.push(canonicalPath);
  }

  for (const adapter of getAllAdapters()) {
    for (const s of scopes) {
      const candidatePath =
        s === "project"
          ? path.join(projectRoot, adapter.paths.projectSkillDir, DEFAULT_SKILL_NAME)
          : path.join(homeDir, adapter.paths.globalSkillDir, DEFAULT_SKILL_NAME);
      if (lstatOrNull(candidatePath) !== null) {
        discovered.push(candidatePath);
      }
    }
  }

  const unique = deduplicatePaths(discovered);
  return unique.length > 0 ? unique : [canonicalPath];
}

export function executeMultiUpdate(options: UpdateOptions = {}): MultiUpdateResult {
  const targetDirs = resolveUpdateTargets(options);
  const targets = targetDirs.map((targetDir) => executeUpdate({ ...options, targetDir }));

  const summary: UpdatePlan["summary"] = {
    add: 0,
    update: 0,
    delete: 0,
    preserve: 0,
    conflict: 0,
    unchanged: 0,
  };

  for (const res of targets) {
    summary.add += res.plan.summary.add;
    summary.update += res.plan.summary.update;
    summary.delete += res.plan.summary.delete;
    summary.preserve += res.plan.summary.preserve;
    summary.conflict += res.plan.summary.conflict;
    summary.unchanged += res.plan.summary.unchanged;
  }

  const files = targets.flatMap((res) => res.plan.files);
  const conflicts = targets.flatMap((res) => res.plan.conflicts);
  const success = targets.every((res) => res.success);
  const rolledBack = targets.some((res) => res.rolledBack);
  const firstError = targets.find((res) => !res.success && res.error)?.error;

  return {
    success,
    dryRun: options.dryRun ?? false,
    targets,
    files,
    conflicts,
    summary,
    ...(rolledBack ? { rolledBack } : {}),
    ...(firstError !== undefined ? { error: firstError } : {}),
  };
}
