import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getAdapter, getAllAdapters } from "@dobbymin/github-convention-agent-adapters";
import {
  computeDirectoryManifest,
  loadManifest,
  MANIFEST_FILENAME,
  type InstallManifest,
  type SkillScope,
} from "@dobbymin/github-convention-core";
import { validateAgentIds } from "../list/index.js";
import { hashRegularFile, lstatOrNull, resolveInside } from "../update/fs-utils.js";
import type {
  MultiUninstallResult,
  UninstallItem,
  UninstallOptions,
  UninstallPlan,
  UninstallResult,
} from "./types.js";

const DEFAULT_SKILL_NAME = "github-convention";

const resolveTargetDir = (options: UninstallOptions): string =>
  options.targetDir ??
  path.join(options.projectRoot ?? process.cwd(), ".agents", "skills", DEFAULT_SKILL_NAME);

const describeError = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const removeEmptyDirectories = (root: string, current = root): boolean => {
  const stat = lstatOrNull(current);
  if (!stat?.isDirectory()) return false;

  let empty = true;
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const entryPath = path.join(current, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      if (!removeEmptyDirectories(root, entryPath)) empty = false;
    } else {
      empty = false;
    }
  }

  if (empty && current !== root) {
    fs.rmdirSync(current);
  }
  return empty && current !== root;
};

const emptyPlan = (targetDir: string, manifest: InstallManifest | null): UninstallPlan => ({
  targetDir,
  kind: manifest === null ? "unmanaged" : "managed_copy",
  manifest,
  items: [],
  summary: { remove: 0, preserve: 0, missing: 0, unowned: 0 },
});

export function planUninstall(options: UninstallOptions = {}): UninstallPlan {
  const targetDir = resolveTargetDir(options);
  const targetStat = lstatOrNull(targetDir);

  if (targetStat === null) {
    return {
      targetDir,
      kind: "not_installed",
      manifest: null,
      items: [],
      summary: { remove: 0, preserve: 0, missing: 0, unowned: 0 },
    };
  }

  if (targetStat.isSymbolicLink()) {
    const manifest = loadManifest(targetDir);
    return {
      targetDir,
      kind: "symlink",
      manifest,
      items: [],
      summary: { remove: 0, preserve: 0, missing: 0, unowned: 0 },
    };
  }

  if (!targetStat.isDirectory()) {
    return {
      targetDir,
      kind: "unmanaged",
      manifest: null,
      items: [
        {
          relativePath: ".",
          action: "preserve_unowned",
          reason: "Target is not a directory; nothing is owned by the CLI",
        },
      ],
      summary: { remove: 0, preserve: 0, missing: 0, unowned: 1 },
    };
  }

  const manifest = loadManifest(targetDir);
  if (manifest === null) {
    return emptyPlan(targetDir, null);
  }

  const items: UninstallItem[] = [];
  const ownedPaths = new Set<string>();

  for (const record of manifest.files) {
    const normalized = record.relativePath.replaceAll("\\", "/");
    ownedPaths.add(normalized);

    let localPath: string;
    try {
      localPath = resolveInside(targetDir, normalized);
    } catch {
      items.push({
        relativePath: normalized,
        action: "preserve_unowned",
        reason: "Manifest path is unsafe; not touching it",
      });
      continue;
    }

    const stat = lstatOrNull(localPath);
    if (stat === null) {
      items.push({
        relativePath: normalized,
        action: "missing",
        reason: "File is already absent",
      });
      continue;
    }

    if (!stat.isFile()) {
      items.push({
        relativePath: normalized,
        action: "preserve_unowned",
        reason: "Path is not a regular file; symlinks and directories are not followed",
      });
      continue;
    }

    const hash = hashRegularFile(localPath)?.sha256;
    if (hash === record.sha256) {
      items.push({
        relativePath: normalized,
        action: "remove",
        reason: "Unchanged CLI-owned file",
      });
    } else {
      items.push({
        relativePath: normalized,
        action: "preserve_modified",
        reason: "User modifications detected; preserving file",
      });
    }
  }

  for (const record of computeDirectoryManifest(targetDir)) {
    if (ownedPaths.has(record.relativePath)) continue;
    items.push({
      relativePath: record.relativePath,
      action: "preserve_unowned",
      reason: "File is not recorded in the install manifest; preserving it",
    });
  }

  return {
    targetDir,
    kind: "managed_copy",
    manifest,
    items,
    summary: {
      remove: items.filter((item) => item.action === "remove").length,
      preserve: items.filter((item) => item.action === "preserve_modified").length,
      missing: items.filter((item) => item.action === "missing").length,
      unowned: items.filter((item) => item.action === "preserve_unowned").length,
    },
  };
}

export function executeUninstall(options: UninstallOptions = {}): UninstallResult {
  const plan = planUninstall(options);

  if (options.dryRun) {
    return {
      targetDir: plan.targetDir,
      success: true,
      dryRun: true,
      plan,
      manifestRemoved: false,
      directoryRemoved: false,
      retainedPath: plan.targetDir,
    };
  }

  if (plan.kind === "not_installed") {
    return {
      targetDir: plan.targetDir,
      success: true,
      dryRun: false,
      plan,
      manifestRemoved: false,
      directoryRemoved: false,
    };
  }

  if (plan.kind === "symlink") {
    try {
      fs.unlinkSync(plan.targetDir);
      return {
        targetDir: plan.targetDir,
        success: true,
        dryRun: false,
        plan,
        manifestRemoved: false,
        directoryRemoved: true,
      };
    } catch (err) {
      return {
        targetDir: plan.targetDir,
        success: false,
        dryRun: false,
        plan,
        manifestRemoved: false,
        directoryRemoved: false,
        error: `Failed to unlink managed symlink: ${describeError(err)}`,
      };
    }
  }

  if (plan.kind === "unmanaged") {
    return {
      targetDir: plan.targetDir,
      success: true,
      dryRun: false,
      plan,
      manifestRemoved: false,
      directoryRemoved: false,
      retainedPath: plan.targetDir,
    };
  }

  try {
    for (const item of plan.items) {
      if (item.action !== "remove") continue;
      const localPath = resolveInside(plan.targetDir, item.relativePath);
      const stat = lstatOrNull(localPath);
      if (!stat?.isFile()) continue;

      // Re-check immediately before deletion to narrow the race window.
      const record = plan.manifest?.files.find(
        (file) => file.relativePath.replaceAll("\\", "/") === item.relativePath,
      );
      if (record === undefined || hashRegularFile(localPath)?.sha256 !== record.sha256) {
        continue;
      }
      fs.unlinkSync(localPath);
    }

    const manifestPath = path.join(plan.targetDir, MANIFEST_FILENAME);
    const manifestRemoved = fs.existsSync(manifestPath);
    if (manifestRemoved) {
      fs.unlinkSync(manifestPath);
    }

    removeEmptyDirectories(plan.targetDir);

    const remaining = fs.readdirSync(plan.targetDir);
    let directoryRemoved = false;
    if (remaining.length === 0) {
      fs.rmdirSync(plan.targetDir);
      directoryRemoved = true;
    }

    return {
      targetDir: plan.targetDir,
      success: true,
      dryRun: false,
      plan,
      manifestRemoved,
      directoryRemoved,
      retainedPath: directoryRemoved ? undefined : plan.targetDir,
    };
  } catch (err) {
    return {
      targetDir: plan.targetDir,
      success: false,
      dryRun: false,
      plan,
      manifestRemoved: false,
      directoryRemoved: false,
      retainedPath: fs.existsSync(plan.targetDir) ? plan.targetDir : undefined,
      error: `Uninstall failed: ${describeError(err)}`,
    };
  }
}

const deduplicateAndOrderTargets = (paths: readonly string[], canonicalPath: string): string[] => {
  const seen = new Set<string>();
  const nonCanonical: string[] = [];
  const canonical: string[] = [];
  const resolvedCanonical = path.resolve(canonicalPath);

  for (const candidate of paths) {
    const resolved = path.resolve(candidate);
    if (seen.has(resolved)) continue;
    seen.add(resolved);

    if (resolved === resolvedCanonical) {
      canonical.push(candidate);
    } else {
      nonCanonical.push(candidate);
    }
  }

  // Unlink/remove adapter targets (including project symlinks) before removing canonical source.
  return [...nonCanonical, ...canonical];
};

export function resolveUninstallTargets(options: UninstallOptions = {}): string[] {
  const projectRoot = options.projectRoot ?? process.cwd();
  const homeDir = options.homeDir ?? os.homedir();
  const scope = options.scope ?? "project";
  const scopes: SkillScope[] = scope === "both" ? ["project", "global"] : [scope];
  const canonicalPath = path.join(projectRoot, ".agents", "skills", DEFAULT_SKILL_NAME);

  if (options.targetDir && (!options.agents || options.agents.length === 0)) {
    return deduplicateAndOrderTargets([options.targetDir], canonicalPath);
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
    return deduplicateAndOrderTargets(resolved, canonicalPath);
  }

  const discovered: string[] = [];
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

  if (scopes.includes("project") && lstatOrNull(canonicalPath) !== null) {
    discovered.push(canonicalPath);
  }

  const ordered = deduplicateAndOrderTargets(discovered, canonicalPath);
  return ordered.length > 0 ? ordered : [canonicalPath];
}

export function executeMultiUninstall(options: UninstallOptions = {}): MultiUninstallResult {
  const targetDirs = resolveUninstallTargets(options);
  const targets = targetDirs.map((targetDir) => executeUninstall({ ...options, targetDir }));

  const summary: UninstallPlan["summary"] = {
    remove: 0,
    preserve: 0,
    missing: 0,
    unowned: 0,
  };

  for (const res of targets) {
    summary.remove += res.plan.summary.remove;
    summary.preserve += res.plan.summary.preserve;
    summary.missing += res.plan.summary.missing;
    summary.unowned += res.plan.summary.unowned;
  }

  const items = targets.flatMap((res) => res.plan.items);
  const warnings = items
    .filter((item) => item.action === "preserve_modified" || item.action === "preserve_unowned")
    .map((item) => `[${item.action}] ${item.relativePath}: ${item.reason}`);

  const success = targets.every((res) => res.success);
  const firstError = targets.find((res) => !res.success && res.error)?.error;

  return {
    success,
    dryRun: options.dryRun ?? false,
    targets,
    items,
    summary,
    warnings,
    ...(firstError !== undefined ? { error: firstError } : {}),
  };
}
