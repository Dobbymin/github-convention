import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  archiveCompletedRun,
  getActiveStateDir,
  StateManager,
  type ExecutionState,
} from "@github-convention/core";
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
