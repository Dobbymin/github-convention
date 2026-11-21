import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { ExitCodes } from "@dobbymin/github-convention-core";
import { assertSafeIgnoreEntry, planGitignoreUpdates } from "../ignore/index.js";
import { runCli } from "../runner.js";
import { executeInit } from "./initializer.js";

const makeTempDir = (prefix: string): string => {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
};

const writeFile = (root: string, relPath: string, content: string): void => {
  const fullPath = path.join(root, ...relPath.split("/"));
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf-8");
};

test("ignore planner enforces safety invariant against protected tracked paths", () => {
  const forbidden = [
    ".agents/skills/github-convention/",
    ".agents/skills/github-convention",
    ".agents/skills/",
    ".agents/",
    ".github-convention/",
    ".github-convention/*",
    ".github-convention/config.yaml",
    ".github-convention/conventions/",
    ".github-convention/conventions",
  ];

  for (const pattern of forbidden) {
    assert.throws(() => assertSafeIgnoreEntry(pattern), /Safety invariant violation/);
    assert.throws(() =>
      planGitignoreUpdates({
        projectRoot: process.cwd(),
        adapterFallbackPaths: [pattern],
      }),
    );
  }

  // Exact adapter fallback copy path outside protected paths is allowed
  const safePlan = planGitignoreUpdates({
    projectRoot: os.tmpdir(),
    adapterFallbackPaths: [".claude/skills/github-convention/"],
  });
  assert.ok(safePlan.entriesToAdd.includes(".claude/skills/github-convention/"));
});

test("init --dry-run leaves directory and git status completely untouched", (t) => {
  const tmpDir = makeTempDir("gc-init-dryrun-");
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  execFileSync("git", ["init"], { cwd: tmpDir, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: tmpDir, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: tmpDir, stdio: "pipe" });

  writeFile(tmpDir, "README.md", "# Project\n");
  execFileSync("git", ["add", "README.md"], { cwd: tmpDir, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "chore: initial commit"], { cwd: tmpDir, stdio: "pipe" });

  const statusBefore = execFileSync("git", ["status", "--porcelain"], {
    cwd: tmpDir,
    encoding: "utf-8",
  });

  const result = executeInit({ projectRoot: tmpDir, dryRun: true });
  assert.equal(result.dryRun, true);
  assert.equal(result.initialized, false);
  assert.equal(result.cacheWritten, false);
  assert.deepEqual(result.writtenFiles, []);

  const statusAfter = execFileSync("git", ["status", "--porcelain"], {
    cwd: tmpDir,
    encoding: "utf-8",
  });
  assert.equal(statusAfter, statusBefore);
  assert.equal(fs.existsSync(path.join(tmpDir, ".github-convention")), false);
  assert.equal(fs.existsSync(path.join(tmpDir, ".gitignore")), false);
});

test("init creates config, project conventions, cache, and exact .gitignore without overwriting existing templates", (t) => {
  const tmpDir = makeTempDir("gc-init-real-");
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const existingIssueTpl = "name: Custom Bug Report\n";
  const existingPrTpl = "## Custom PR Checklist\n";
  writeFile(tmpDir, ".github/ISSUE_TEMPLATE/bug.yml", existingIssueTpl);
  writeFile(tmpDir, ".github/pull_request_template.md", existingPrTpl);
  writeFile(tmpDir, ".gitignore", "node_modules/\n");
  writeFile(tmpDir, "package.json", JSON.stringify({ name: "app", scripts: { test: "vitest" } }));

  const result = executeInit({ projectRoot: tmpDir, dryRun: false });
  assert.equal(result.dryRun, false);
  assert.equal(result.initialized, true);
  assert.equal(result.cacheWritten, true);

  assert.ok(fs.existsSync(path.join(tmpDir, ".github-convention", "config.yaml")));
  assert.ok(fs.existsSync(path.join(tmpDir, ".github-convention", "conventions", "README.md")));
  assert.ok(fs.existsSync(path.join(tmpDir, ".github-convention", "cache", "analysis.json")));

  // Existing .github templates are never overwritten
  assert.equal(
    fs.readFileSync(path.join(tmpDir, ".github", "ISSUE_TEMPLATE", "bug.yml"), "utf-8"),
    existingIssueTpl,
  );
  assert.equal(
    fs.readFileSync(path.join(tmpDir, ".github", "pull_request_template.md"), "utf-8"),
    existingPrTpl,
  );

  // .gitignore contains exact runtime ignores and does NOT ignore protected tracked paths
  const gitignore = fs.readFileSync(path.join(tmpDir, ".gitignore"), "utf-8");
  assert.ok(gitignore.includes("node_modules/"));
  assert.ok(gitignore.includes(".github-convention/cache/"));
  assert.ok(gitignore.includes(".github-convention/state/"));
  assert.ok(gitignore.includes(".github-convention/logs/"));
  assert.equal(gitignore.includes(".agents/skills/github-convention/"), false);
  assert.equal(gitignore.includes(".github-convention/config.yaml"), false);
  assert.equal(gitignore.includes(".github-convention/conventions/"), false);

  // Re-running init skips already-created config, conventions, and gitignore entries
  const second = executeInit({ projectRoot: tmpDir, dryRun: false });
  assert.deepEqual(second.writtenFiles, []);
});

test("CLI init command emits valid JSON envelope in dry-run and real mode", async (t) => {
  const tmpDir = makeTempDir("gc-init-cli-");
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const dryRes = await runCli(["init", "--project", tmpDir, "--dry-run", "--output", "json"], {
    stdout: () => {},
    stderr: () => {},
  });
  assert.equal(dryRes.exitCode, ExitCodes.SUCCESS);
  assert.equal(dryRes.envelope.status, "completed");
  assert.deepEqual(JSON.parse(dryRes.stdoutText), dryRes.envelope);
  assert.equal(fs.existsSync(path.join(tmpDir, ".github-convention")), false);

  const realRes = await runCli(["init", "--project", tmpDir, "--output", "json"], {
    stdout: () => {},
    stderr: () => {},
  });
  assert.equal(realRes.exitCode, ExitCodes.SUCCESS);
  assert.equal(realRes.envelope.status, "completed");
  assert.deepEqual(JSON.parse(realRes.stdoutText), realRes.envelope);
  assert.ok(fs.existsSync(path.join(tmpDir, ".github-convention", "config.yaml")));
});
