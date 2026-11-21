import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { StateManager } from "../state/state-manager.js";
import type { ExecutionState } from "../state/types.js";
import {
  archiveCompletedRun,
  cleanupExpiredArchives,
  getActiveStateDir,
  listArchives,
  restoreArchive,
  showRunState,
} from "./index.js";

const makeState = (
  runId: string,
  status: ExecutionState["status"],
  approvalStatus: "approved" | "pending" = "approved",
): ExecutionState => ({
  schemaVersion: 1,
  runId,
  status,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  repository: { root: "/tmp/repo", name: "repo", defaultBranch: "main" },
  approvals: [{ approvalId: "app-1", action: "create_issues", status: approvalStatus }],
  tasks: [],
});

test("archive lifecycle: refuses active/pending runs, archives completed run, restores, and cleans expired only", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ghc-archive-"));
  const activeDir = getActiveStateDir(root);
  fs.mkdirSync(activeDir, { recursive: true });
  const manager = new StateManager({ stateDir: activeDir, role: "orchestrator" });

  manager.save(makeState("run-active", "in_progress"));
  manager.save(makeState("run-pending", "completed", "pending"));
  manager.save(makeState("run-old", "completed", "approved"));
  manager.save(makeState("run-fresh", "completed", "approved"));

  assert.throws(() => archiveCompletedRun(root, "run-active"), /Refusing to archive/);
  assert.throws(() => archiveCompletedRun(root, "run-pending"), /Refusing to archive/);

  archiveCompletedRun(root, "run-old", false, "2026-09-01T00:00:00.000Z");
  archiveCompletedRun(root, "run-fresh", false, "2026-11-15T00:00:00.000Z");

  assert.equal(listArchives(root).length, 2);
  assert.equal(showRunState(root, "run-old").location, "archive");

  const dryCleanup = cleanupExpiredArchives(root, {
    retentionDays: 30,
    dryRun: true,
    now: new Date("2026-11-21T00:00:00.000Z"),
  });
  assert.deepEqual(dryCleanup.deletedRunIds, ["run-old"]);
  assert.equal(listArchives(root).length, 2);

  const realCleanup = cleanupExpiredArchives(root, {
    retentionDays: 30,
    dryRun: false,
    now: new Date("2026-11-21T00:00:00.000Z"),
  });
  assert.deepEqual(realCleanup.deletedRunIds, ["run-old"]);
  assert.deepEqual(realCleanup.retainedRunIds, ["run-fresh"]);
  assert.equal(fs.existsSync(path.join(activeDir, "run-active.json")), true);

  restoreArchive(root, "run-fresh");
  assert.equal(showRunState(root, "run-fresh").location, "active");

  fs.rmSync(root, { recursive: true, force: true });
});
