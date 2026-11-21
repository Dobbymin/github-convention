import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { getAnalysisCachePath, loadAnalysisCache, saveAnalysisCache } from "../cache/index.js";
import { analyzeRepository, resolveConventionConflict } from "./repo-analyzer.js";

const makeTempDir = (prefix: string): string => {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
};

const writeFile = (root: string, relPath: string, content: string): void => {
  const fullPath = path.join(root, ...relPath.split("/"));
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf-8");
};

test("targeted discovery inspects convention files and skips unrelated source files", (t) => {
  const tmpDir = makeTempDir("gc-analysis-discovery-");
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  writeFile(tmpDir, "AGENTS.md", "Use pnpm install and conventional commits.\n");
  writeFile(
    tmpDir,
    "package.json",
    JSON.stringify({
      name: "demo",
      scripts: {
        test: "node --test",
        lint: "eslint .",
        typecheck: "tsc --noEmit",
        "format:check": "prettier --check .",
        build: "tsc",
        "secret-scan": "gitleaks detect",
      },
    }),
  );
  writeFile(tmpDir, ".github/ISSUE_TEMPLATE/bug.yml", "name: Bug\n");
  writeFile(tmpDir, ".github/pull_request_template.md", "## Summary\n");
  writeFile(tmpDir, ".github/workflows/ci.yml", "run: pnpm test\n");
  writeFile(tmpDir, "templates/labels.yaml", "- name: bug\n");
  writeFile(tmpDir, "src/unrelated.ts", "export const x = 1;\n");

  const res = analyzeRepository({ projectRoot: tmpDir, dryRun: true });
  assert.equal(res.cacheWritten, false);
  assert.equal(fs.existsSync(getAnalysisCachePath(tmpDir)), false);

  assert.ok(res.analysis.discoveredFiles.includes("AGENTS.md"));
  assert.ok(res.analysis.discoveredFiles.includes("package.json"));
  assert.ok(res.analysis.discoveredFiles.includes(".github/ISSUE_TEMPLATE/bug.yml"));
  assert.ok(res.analysis.discoveredFiles.includes(".github/pull_request_template.md"));
  assert.ok(res.analysis.discoveredFiles.includes(".github/workflows/ci.yml"));
  assert.ok(res.analysis.discoveredFiles.includes("templates/labels.yaml"));
  assert.equal(res.analysis.discoveredFiles.includes("src/unrelated.ts"), false);

  assert.equal(res.analysis.scripts.test, "test");
  assert.equal(res.analysis.scripts.lint, "lint");
  assert.equal(res.analysis.scripts.typecheck, "typecheck");
  assert.equal(res.analysis.scripts.format, "format:check");
  assert.equal(res.analysis.scripts.build, "build");
  assert.equal(res.analysis.scripts.secretScan, "secret-scan");
  assert.equal(res.analysis.git.isGitRepo, false);
});

test("bounded git sampling caps commit subjects at 10 and detects conventional commits", (t) => {
  const tmpDir = makeTempDir("gc-analysis-git-");
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  execFileSync("git", ["init"], { cwd: tmpDir, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: tmpDir, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: tmpDir, stdio: "pipe" });

  for (let i = 1; i <= 12; i++) {
    writeFile(tmpDir, "README.md", `Commit ${i}\n`);
    execFileSync("git", ["add", "README.md"], { cwd: tmpDir, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", `feat: commit ${i}`], { cwd: tmpDir, stdio: "pipe" });
  }

  const res = analyzeRepository({ projectRoot: tmpDir, dryRun: true });
  assert.equal(res.analysis.git.isGitRepo, true);
  assert.equal(res.analysis.git.recentCommitSubjects.length, 10);
  assert.equal(res.analysis.git.recentCommitSubjects[0], "feat: commit 12");
  assert.equal(res.analysis.git.inferredCommitStyle, "conventional");
});

test("SHA-256 incremental cache re-analyzes only added/changed files and removes deleted ones", (t) => {
  const tmpDir = makeTempDir("gc-analysis-cache-");
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  writeFile(tmpDir, "AGENTS.md", "Use npm install.\n");
  writeFile(tmpDir, "README.md", "# Demo\n");

  const analyzedFirst: string[] = [];
  const run1 = analyzeRepository({
    projectRoot: tmpDir,
    onAnalyzeFile: (rel) => analyzedFirst.push(rel),
  });
  assert.equal(run1.cacheWritten, true);
  assert.deepEqual(analyzedFirst.sort(), ["AGENTS.md", "README.md"]);
  assert.deepEqual(run1.diff.added.map((f) => f.relativePath).sort(), ["AGENTS.md", "README.md"]);

  // Second run: unchanged
  const analyzedSecond: string[] = [];
  const run2 = analyzeRepository({
    projectRoot: tmpDir,
    onAnalyzeFile: (rel) => analyzedSecond.push(rel),
  });
  assert.deepEqual(analyzedSecond, []);
  assert.deepEqual(run2.diff.unchanged.map((f) => f.relativePath).sort(), [
    "AGENTS.md",
    "README.md",
  ]);

  // Modify AGENTS.md, add CONTRIBUTING.md, delete README.md
  writeFile(tmpDir, "AGENTS.md", "Use pnpm install.\n");
  writeFile(tmpDir, "CONTRIBUTING.md", "Use conventional commits.\n");
  fs.unlinkSync(path.join(tmpDir, "README.md"));

  const analyzedThird: string[] = [];
  const run3 = analyzeRepository({
    projectRoot: tmpDir,
    onAnalyzeFile: (rel) => analyzedThird.push(rel),
  });
  assert.deepEqual(analyzedThird.sort(), ["AGENTS.md", "CONTRIBUTING.md"]);
  assert.deepEqual(
    run3.diff.added.map((f) => f.relativePath),
    ["CONTRIBUTING.md"],
  );
  assert.deepEqual(
    run3.diff.changed.map((f) => f.relativePath),
    ["AGENTS.md"],
  );
  assert.deepEqual(run3.diff.deleted, ["README.md"]);

  const loadedCache = loadAnalysisCache(tmpDir);
  assert.ok(loadedCache);
  assert.equal(loadedCache.sources["README.md"], undefined);
  assert.ok(loadedCache.sources["AGENTS.md"]);
  assert.ok(loadedCache.sources["CONTRIBUTING.md"]);
});

test("current source files outrank stale cache", (t) => {
  const tmpDir = makeTempDir("gc-analysis-outrank-");
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  writeFile(tmpDir, "AGENTS.md", "Use pnpm install.\n");
  analyzeRepository({ projectRoot: tmpDir });

  // Tamper cache with stale hash & stale packageManager
  const cache = loadAnalysisCache(tmpDir);
  assert.ok(cache);
  cache.sources["AGENTS.md"] = {
    relativePath: "AGENTS.md",
    sha256: "0000000000000000000000000000000000000000000000000000000000000000",
    size: 10,
    category: "instruction",
    summary: { category: "instruction", packageManager: "yarn" },
  };
  saveAnalysisCache(tmpDir, cache);

  const fresh = analyzeRepository({ projectRoot: tmpDir, dryRun: true });
  assert.deepEqual(fresh.analysis.packageManagers, ["pnpm"]);
});

test("conflict detection, persisted resolution, and re-surfacing on source hash change", (t) => {
  const tmpDir = makeTempDir("gc-analysis-conflicts-");
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  writeFile(tmpDir, "AGENTS.md", "Use pnpm install.\n");
  writeFile(tmpDir, "CONTRIBUTING.md", "Use npm install.\n");

  const run1 = analyzeRepository({ projectRoot: tmpDir });
  assert.equal(run1.analysis.conflicts.length, 1);
  const conflict = run1.analysis.conflicts[0]!;
  assert.equal(conflict.topic, "package_manager");
  assert.equal(conflict.status, "unresolved");

  // Persist user resolution
  resolveConventionConflict(tmpDir, conflict, {
    selectedValue: "pnpm",
    selectedSource: "AGENTS.md",
    note: "Repo uses pnpm workspaces.",
  });

  const run2 = analyzeRepository({ projectRoot: tmpDir });
  assert.equal(run2.analysis.conflicts.length, 1);
  assert.equal(run2.analysis.conflicts[0]?.status, "resolved");
  assert.equal(run2.analysis.conflicts[0]?.resolution?.selectedValue, "pnpm");

  // Modify one of the conflicting source files -> hash changes -> conflict re-surfaces
  writeFile(tmpDir, "CONTRIBUTING.md", "Use yarn install for local dev.\n");

  const run3 = analyzeRepository({ projectRoot: tmpDir });
  assert.equal(run3.analysis.conflicts.length, 1);
  assert.equal(run3.analysis.conflicts[0]?.status, "unresolved");
  assert.equal(run3.analysis.conflicts[0]?.resolution, undefined);
});
