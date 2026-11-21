import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  archiveCompletedRun,
  createIsolatedWorktree,
  getActiveStateDir,
  getArchiveStateDir,
  StateManager,
  type ExecutionState,
} from "@dobbymin/github-convention-core";
import { runCli } from "../runner.js";
import { runCleanupArchives, runStateList, runStateRestore, runStateShow } from "./index.js";

const makeCompleted = (runId: string): ExecutionState => ({
  schemaVersion: 1,
  runId,
  status: "completed",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  repository: { root: "/tmp/repo", name: "repo", defaultBranch: "main" },
  approvals: [{ approvalId: "app-1", action: "create_issues", status: "approved" }],
  tasks: [],
});

test("state CLI helpers: list, show, restore (dry-run & real), and cleanup", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ghc-state-cmd-"));
  const activeDir = getActiveStateDir(root);
  fs.mkdirSync(activeDir, { recursive: true });
  const manager = new StateManager({ stateDir: activeDir, role: "orchestrator" });
  manager.save(makeCompleted("run-cmd-1"));
  archiveCompletedRun(root, "run-cmd-1", false, "2026-09-01T00:00:00.000Z");

  assert.equal(runStateList({ projectRoot: root }).length, 1);
  assert.equal(runStateShow({ projectRoot: root, runId: "run-cmd-1" })?.location, "archive");

  const dryRestore = runStateRestore({
    projectRoot: root,
    runId: "run-cmd-1",
    dryRun: true,
  });
  assert.equal(dryRestore?.dryRun, true);
  assert.equal(dryRestore?.moved, false);

  const realRestore = runStateRestore({
    projectRoot: root,
    runId: "run-cmd-1",
    dryRun: false,
  });
  assert.equal(realRestore?.moved, true);
  assert.equal(runStateList({ projectRoot: root }).length, 0);

  const cleanupRes = runCleanupArchives({ projectRoot: root, dryRun: true });
  assert.equal(cleanupRes.dryRun, true);

  fs.rmSync(root, { recursive: true, force: true });
});

test("cleanup removes clean owned worktrees and staging dirs while preserving dirty worktrees", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ghc-cleanup-wt-"));
  try {
    execFileSync("git", ["init"], { cwd: root, stdio: "pipe" });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root, stdio: "pipe" });
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: root, stdio: "pipe" });
    fs.writeFileSync(path.join(root, "README.md"), "# Demo\n", "utf-8");
    execFileSync("git", ["add", "README.md"], { cwd: root, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", "chore: init"], { cwd: root, stdio: "pipe" });

    const cleanWt = path.join(root, ".github-convention", "worktrees", "clean-task");
    const dirtyWt = path.join(root, ".github-convention", "worktrees", "dirty-task");
    createIsolatedWorktree(root, cleanWt, "TASK-CLEAN", "feat/clean-task");
    createIsolatedWorktree(root, dirtyWt, "TASK-DIRTY", "feat/dirty-task");
    fs.writeFileSync(path.join(dirtyWt, "uncommitted.txt"), "keep me\n", "utf-8");

    const stagingDir = path.join(root, ".agents", "skills", ".github-convention-update-123");
    fs.mkdirSync(stagingDir, { recursive: true });

    const dry = runCleanupArchives({ projectRoot: root, dryRun: true });
    assert.equal(dry.removedWorktrees.length, 1);
    assert.equal(dry.preservedWorktrees.length, 1);
    assert.equal(dry.removedTempDirs.length, 1);
    assert.equal(fs.existsSync(cleanWt), true);
    assert.equal(fs.existsSync(dirtyWt), true);
    assert.equal(fs.existsSync(stagingDir), true);

    const real = runCleanupArchives({ projectRoot: root, dryRun: false });
    assert.equal(real.removedWorktrees.length, 1);
    assert.equal(real.preservedWorktrees.length, 1);
    assert.equal(real.removedTempDirs.length, 1);
    assert.equal(fs.existsSync(cleanWt), false);
    assert.equal(fs.existsSync(dirtyWt), true);
    assert.equal(fs.existsSync(stagingDir), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runCli executes auto_cleanup_on_cli_start when enabled and skips on --dry-run", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ghc-autostart-"));
  try {
    const activeDir = getActiveStateDir(root);
    fs.mkdirSync(activeDir, { recursive: true });
    const manager = new StateManager({ stateDir: activeDir, role: "orchestrator" });
    manager.save(makeCompleted("run-expired"));
    // Archive with old timestamp (2020) so it is expired beyond default 30 days
    archiveCompletedRun(root, "run-expired", false, "2020-01-01T00:00:00.000Z");
    const archivePath = path.join(getArchiveStateDir(root), "run-expired.json");
    assert.equal(fs.existsSync(archivePath), true);

    // Dry-run must NOT clean expired archive
    await runCli(["status", "--project", root, "--dry-run", "--output", "json"], {
      stdout: () => {},
      stderr: () => {},
    });
    assert.equal(fs.existsSync(archivePath), true);

    // Normal command triggers auto_cleanup_on_cli_start
    await runCli(["state", "list", "--project", root, "--output", "json"], {
      stdout: () => {},
      stderr: () => {},
    });
    assert.equal(fs.existsSync(archivePath), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
