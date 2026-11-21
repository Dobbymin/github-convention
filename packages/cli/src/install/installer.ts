import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getAdapter } from "@github-convention/agent-adapters";
import {
  computeDirectoryManifest,
  type InstallManifest,
  saveManifest,
  type SkillScope,
} from "@github-convention/core";
import type { InstallExecutionItem, InstallPlanOptions, InstallResult } from "./types.js";

const SKILL_NAME = "github-convention";
const DEFAULT_SKILL_VERSION = "0.1.0";

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

  const fallbackSourceDir = options.sourceSkillDir ?? path.join(projectRoot, "skills", SKILL_NAME);

  // 1. Ensure canonical skill source exists
  if (!fs.existsSync(canonicalSkillDir)) {
    if (fs.existsSync(fallbackSourceDir)) {
      if (!options.dryRun) {
        copyDirectoryRecursive(fallbackSourceDir, canonicalSkillDir);
      }
    } else {
      // Create minimal canonical skill skeleton if no template available
      if (!options.dryRun) {
        fs.mkdirSync(canonicalSkillDir, { recursive: true });
        fs.writeFileSync(
          path.join(canonicalSkillDir, "SKILL.md"),
          `# ${SKILL_NAME}\n\nCanonical Project Skill source.\n`,
          "utf-8",
        );
      }
    }
  }

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
          copyDirectoryRecursive(canonicalSkillDir, targetSkillPath);
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
          canonicalSourcePath: canonicalSkillDir,
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
    canonicalSourcePath: canonicalSkillDir,
    items,
    success,
  };
};
