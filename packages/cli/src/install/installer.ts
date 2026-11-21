import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { getAdapter, type AgentId } from "@dobbymin/github-convention-agent-adapters";
import {
  computeDirectoryManifest,
  type InstallManifest,
  saveManifest,
  type SkillScope,
} from "@dobbymin/github-convention-core";
import type {
  InstallExecutionItem,
  InstallPlanOptions,
  InstallPrompter,
  InstallResult,
  InstallScopeSelection,
} from "./types.js";

const SKILL_NAME = "github-convention";
const DEFAULT_SKILL_VERSION = "0.1.1";
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_REPO_ROOT = path.resolve(MODULE_DIR, "../../../..");
const require = createRequire(import.meta.url);
export const FALLBACK_SKILL_MD = `---
name: ${SKILL_NAME}
description: Deterministic GitHub workflow automation skill.
---

# ${SKILL_NAME}

Canonical Project Skill source.
`;

export const resolveSkillSourceDir = (
  projectRoot: string,
  explicitSourceDir?: string,
): string | null => {
  if (explicitSourceDir && fs.existsSync(explicitSourceDir)) {
    return explicitSourceDir;
  }

  let bundledNpmSkillDir: string | null = null;
  try {
    const skillPkgJson = require.resolve("@dobbymin/github-convention-skill/package.json");
    bundledNpmSkillDir = path.join(path.dirname(skillPkgJson), "skill");
  } catch {
    bundledNpmSkillDir = null;
  }

  const candidates = [
    path.join(projectRoot, "skills", SKILL_NAME),
    ...(bundledNpmSkillDir ? [bundledNpmSkillDir] : []),
    path.join(PACKAGE_REPO_ROOT, ".agents", "skills", SKILL_NAME),
    path.join(PACKAGE_REPO_ROOT, "skills", SKILL_NAME),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
};

export const copyDirectoryRecursive = (source: string, destination: string): void => {
  if (!fs.existsSync(destination)) {
    fs.mkdirSync(destination, { recursive: true });
  }

  const entries = fs.readdirSync(source, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".manifest.json" || entry.name === ".DS_Store") {
      continue;
    }
    const srcPath = path.join(source, entry.name);
    const destPath = path.join(destination, entry.name);

    if (entry.isDirectory()) {
      copyDirectoryRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
};

export const executeInstall = (options: InstallPlanOptions): InstallResult => {
  const projectRoot = options.projectRoot ?? process.cwd();
  const homeDir = options.homeDir ?? os.homedir();
  const canonicalSkillDir = path.join(projectRoot, ".agents", "skills", SKILL_NAME);
  const resolvedSourceDir = resolveSkillSourceDir(projectRoot, options.sourceSkillDir);
  const needsProjectCanonical = options.targets.some(
    (t) => t.scope === "project" || t.scope === "both",
  );

  // 1. Ensure canonical skill source exists in project only when project scope is requested
  if (needsProjectCanonical && !fs.existsSync(canonicalSkillDir)) {
    if (resolvedSourceDir) {
      if (!options.dryRun) {
        copyDirectoryRecursive(resolvedSourceDir, canonicalSkillDir);
      }
    } else if (!options.dryRun) {
      fs.mkdirSync(canonicalSkillDir, { recursive: true });
      fs.writeFileSync(path.join(canonicalSkillDir, "SKILL.md"), FALLBACK_SKILL_MD, "utf-8");
    }
  }

  const effectiveCanonicalSourcePath = fs.existsSync(canonicalSkillDir)
    ? canonicalSkillDir
    : (resolvedSourceDir ?? canonicalSkillDir);

  const items: InstallExecutionItem[] = [];

  for (const target of options.targets) {
    const adapter = getAdapter(target.agentId);
    const scopesToProcess: SkillScope[] =
      target.scope === "both" ? ["project", "global"] : [target.scope];

    for (const scope of scopesToProcess) {
      const isProject = scope === "project";
      const targetBaseDir = isProject
        ? path.join(projectRoot, adapter.paths.projectSkillDir)
        : path.join(homeDir, adapter.paths.globalSkillDir);

      const targetSkillPath = path.join(targetBaseDir, SKILL_NAME);

      // Check if this target is the canonical path itself
      const isCanonical = path.resolve(targetSkillPath) === path.resolve(canonicalSkillDir);

      if (isCanonical) {
        if (!options.dryRun) {
          const files = computeDirectoryManifest(canonicalSkillDir);
          const manifest: InstallManifest = {
            schemaVersion: 1,
            skillName: SKILL_NAME,
            skillVersion: DEFAULT_SKILL_VERSION,
            installedAt: new Date().toISOString(),
            agentId: target.agentId,
            scope,
            targetPath: canonicalSkillDir,
            installType: "canonical",
            files,
          };
          saveManifest(canonicalSkillDir, manifest);
        }

        const filesCount = fs.existsSync(canonicalSkillDir)
          ? computeDirectoryManifest(canonicalSkillDir).length
          : 0;

        items.push({
          agentId: target.agentId,
          scope,
          targetPath: canonicalSkillDir,
          installType: "canonical",
          status: "created",
          filesCount,
        });
        continue;
      }

      // If dry-run
      if (options.dryRun) {
        const canSymlink = isProject && !options.forceCopy;
        items.push({
          agentId: target.agentId,
          scope,
          targetPath: targetSkillPath,
          installType: canSymlink ? "symlink" : "copy",
          status: "created",
          filesCount: 0,
        });
        continue;
      }

      // Real installation
      try {
        if (!fs.existsSync(targetBaseDir)) {
          fs.mkdirSync(targetBaseDir, { recursive: true });
        }

        let installedType: "symlink" | "copy" = "copy";

        // Prefer symlink for project-level if not forced copy
        let symlinkSucceeded = false;
        if (isProject && !options.forceCopy) {
          try {
            if (fs.existsSync(targetSkillPath)) {
              fs.rmSync(targetSkillPath, { recursive: true, force: true });
            }
            const symlinkType = process.platform === "win32" ? "junction" : "dir";
            fs.symlinkSync(canonicalSkillDir, targetSkillPath, symlinkType);
            symlinkSucceeded = true;
            installedType = "symlink";
          } catch {
            symlinkSucceeded = false;
          }
        }

        if (!symlinkSucceeded) {
          // Fallback to managed copy
          if (fs.existsSync(targetSkillPath)) {
            fs.rmSync(targetSkillPath, { recursive: true, force: true });
          }
          const copySourceDir = fs.existsSync(canonicalSkillDir)
            ? canonicalSkillDir
            : resolvedSourceDir;
          if (copySourceDir) {
            copyDirectoryRecursive(copySourceDir, targetSkillPath);
          } else {
            fs.mkdirSync(targetSkillPath, { recursive: true });
            fs.writeFileSync(path.join(targetSkillPath, "SKILL.md"), FALLBACK_SKILL_MD, "utf-8");
          }
          installedType = "copy";
        }

        // Generate and save manifest for the installed target
        const files = computeDirectoryManifest(targetSkillPath);
        const manifest: InstallManifest = {
          schemaVersion: 1,
          skillName: SKILL_NAME,
          skillVersion: DEFAULT_SKILL_VERSION,
          installedAt: new Date().toISOString(),
          agentId: target.agentId,
          scope,
          targetPath: targetSkillPath,
          installType: installedType,
          canonicalSourcePath: effectiveCanonicalSourcePath,
          files,
        };

        if (installedType === "copy") {
          saveManifest(targetSkillPath, manifest);
        }

        items.push({
          agentId: target.agentId,
          scope,
          targetPath: targetSkillPath,
          installType: installedType,
          status: "created",
          filesCount: files.length,
        });
      } catch (err: unknown) {
        items.push({
          agentId: target.agentId,
          scope,
          targetPath: targetSkillPath,
          installType: "copy",
          status: "failed",
          filesCount: 0,
          error: String(err),
        });
      }
    }
  }

  const success = items.every((i) => i.status !== "failed");

  return {
    canonicalSourcePath: effectiveCanonicalSourcePath,
    items,
    success,
  };
};

export const createReadlineInstallPrompter = (): InstallPrompter => ({
  async selectTargets({ candidates, defaultScope }) {
    const selectable = candidates.filter(
      (det) => det.confidence === "confirmed" || det.confidence === "probable",
    );
    const pool = selectable.length > 0 ? selectable : candidates;
    const confirmedIds = candidates
      .filter((det) => det.confidence === "confirmed")
      .map((det) => det.agentId);

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
    });

    try {
      process.stderr.write("\nDetected agents:\n");
      pool.forEach((det, idx) => {
        process.stderr.write(`  ${idx + 1}. ${det.agentId} (${det.name}) [${det.confidence}]\n`);
      });

      const defaultHint = confirmedIds.length > 0 ? ` [${confirmedIds.join(",")}]` : "";
      const agentAnswer = (
        await rl.question(`Select agent IDs (comma-separated or numbers)${defaultHint}: `)
      ).trim();

      let selectedIds: AgentId[];
      if (!agentAnswer) {
        selectedIds = confirmedIds;
      } else {
        const validMap = new Map(candidates.map((c) => [c.agentId, c.agentId]));
        selectedIds = [];
        for (const token of agentAnswer.split(",")) {
          const trimmed = token.trim();
          if (!trimmed) continue;
          const num = Number.parseInt(trimmed, 10);
          if (!Number.isNaN(num) && num >= 1 && num <= pool.length) {
            const byIndex = pool[num - 1];
            if (byIndex) selectedIds.push(byIndex.agentId);
          } else if (validMap.has(trimmed as AgentId)) {
            selectedIds.push(trimmed as AgentId);
          }
        }
      }

      const uniqueIds = [...new Set(selectedIds)];
      if (uniqueIds.length === 0) {
        return null;
      }

      const scopeAnswer = (
        await rl.question(`Select scope (project|global|both) [${defaultScope}]: `)
      )
        .trim()
        .toLowerCase();

      const chosenScope: InstallScopeSelection =
        scopeAnswer === "project" || scopeAnswer === "global" || scopeAnswer === "both"
          ? scopeAnswer
          : defaultScope;

      return uniqueIds.map((agentId) => ({ agentId, scope: chosenScope }));
    } finally {
      rl.close();
    }
  },
});
