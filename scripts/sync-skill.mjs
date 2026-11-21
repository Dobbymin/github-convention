#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const collectRelativeFiles = (dir, base = dir) => {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".DS_Store") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectRelativeFiles(full, base));
    } else if (entry.isFile()) {
      results.push(path.relative(base, full).split(path.sep).join("/"));
    }
  }
  return results.sort();
};

export const checkSkillSync = (repoRoot = REPO_ROOT) => {
  const sourceDir = path.join(repoRoot, "skills", "github-convention");
  const targetDir = path.join(repoRoot, "packages", "skill", "skill");
  const sourceFiles = collectRelativeFiles(sourceDir);
  const targetFiles = collectRelativeFiles(targetDir);

  const sourceSet = new Set(sourceFiles);
  const targetSet = new Set(targetFiles);
  const missingInTarget = sourceFiles.filter((f) => !targetSet.has(f));
  const extraInTarget = targetFiles.filter((f) => !sourceSet.has(f));
  const contentMismatches = [];

  for (const rel of sourceFiles) {
    if (!targetSet.has(rel)) continue;
    const a = fs.readFileSync(path.join(sourceDir, rel));
    const b = fs.readFileSync(path.join(targetDir, rel));
    if (Buffer.compare(a, b) !== 0) {
      contentMismatches.push(rel);
    }
  }

  return {
    inSync:
      missingInTarget.length === 0 && extraInTarget.length === 0 && contentMismatches.length === 0,
    sourceDir,
    targetDir,
    fileCount: sourceFiles.length,
    missingInTarget,
    extraInTarget,
    contentMismatches,
  };
};

export const syncSkillFiles = (repoRoot = REPO_ROOT) => {
  const sourceDir = path.join(repoRoot, "skills", "github-convention");
  const targetDir = path.join(repoRoot, "packages", "skill", "skill");

  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Authoring skill source not found: ${sourceDir}`);
  }

  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });
  fs.cpSync(sourceDir, targetDir, {
    recursive: true,
    filter: (src) => path.basename(src) !== ".DS_Store",
  });

  return checkSkillSync(repoRoot);
};

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  const checkOnly = process.argv.includes("--check");
  if (checkOnly) {
    const result = checkSkillSync(REPO_ROOT);
    if (!result.inSync) {
      process.stderr.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exit(1);
    }
    process.stdout.write(`Skill sync OK (${result.fileCount} files)\n`);
  } else {
    const result = syncSkillFiles(REPO_ROOT);
    process.stdout.write(`Synced ${result.fileCount} skill files to packages/skill/skill\n`);
  }
}
