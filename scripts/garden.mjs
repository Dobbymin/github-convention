#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SKIP_DIRS = new Set(["node_modules", ".git", "_workspace", ".harness"]);

const LEGACY_TOKENS = [
  "@dobbymin/github-convention-cli",
  "packages/core",
  "packages/cli",
  "packages/skill",
  "skills/github-convention/SKILL.md",
  "verify:manifests",
  "sync:skill",
];

const collectMarkdownFiles = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectMarkdownFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(full);
    }
  }
  return out.sort();
};

const stripCodeFences = (text) =>
  text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\r\n]+`/g, "");

export const gardenRepo = (repoRoot = REPO_ROOT) => {
  const issues = [];
  const mdFiles = collectMarkdownFiles(repoRoot);

  for (const filePath of mdFiles) {
    const relFile = path.relative(repoRoot, filePath).split(path.sep).join("/");
    const raw = fs.readFileSync(filePath, "utf8");
    const prose = stripCodeFences(raw);

    // 1. Check relative markdown links
    const linkRegex = /\[[^\]]*\]\(([^)]+)\)/g;
    let match;
    while ((match = linkRegex.exec(prose)) !== null) {
      const targetRaw = match[1].trim().split(/\s+/)[0];
      if (
        !targetRaw ||
        targetRaw.startsWith("http://") ||
        targetRaw.startsWith("https://") ||
        targetRaw.startsWith("mailto:") ||
        targetRaw.startsWith("#")
      ) {
        continue;
      }
      const targetPathOnly = targetRaw.split("#")[0];
      if (!targetPathOnly) continue;
      const resolved = path.resolve(path.dirname(filePath), path.normalize(targetPathOnly));
      if (!fs.existsSync(resolved)) {
        issues.push(`${relFile}: broken relative link "${targetRaw}"`);
      }
    }

    // 2. Check stale legacy references (excluding historical CHANGELOG.md)
    if (relFile !== "CHANGELOG.md") {
      for (const token of LEGACY_TOKENS) {
        if (raw.includes(token)) {
          issues.push(`${relFile}: stale legacy reference "${token}"`);
        }
      }
    }
  }

  // 3. Check orphan files in skills/, agents/, commands/
  const skillsDir = path.join(repoRoot, "skills");
  if (fs.existsSync(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (entry.name === ".DS_Store") continue;
      if (!entry.isDirectory()) {
        issues.push(`skills/${entry.name}: unexpected non-directory entry`);
        continue;
      }
      const subEntries = fs.readdirSync(path.join(skillsDir, entry.name));
      for (const sub of subEntries) {
        if (sub === ".DS_Store") continue;
        if (sub !== "SKILL.md" && sub !== "references") {
          issues.push(`skills/${entry.name}/${sub}: unexpected file in skill directory`);
        }
      }
    }
  }

  for (const dirName of ["agents", "commands"]) {
    const dirPath = path.join(repoRoot, dirName);
    if (!fs.existsSync(dirPath)) continue;
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      if (entry.name === ".DS_Store") continue;
      if (!entry.isFile() || !entry.name.endsWith(".md")) {
        issues.push(`${dirName}/${entry.name}: expected .md file only`);
      }
    }
  }

  return { ok: issues.length === 0, checkedFiles: mdFiles.length, issues };
};

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  const result = gardenRepo(REPO_ROOT);
  if (!result.ok) {
    for (const issue of result.issues) {
      process.stderr.write(`DRIFT: ${issue}\n`);
    }
    process.exit(1);
  }
  process.stdout.write(`Garden check OK (${result.checkedFiles} markdown files, 0 drift issues).\n`);
}
