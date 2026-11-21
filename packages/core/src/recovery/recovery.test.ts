import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { StateManager } from "../state/state-manager.js";
import type { ExecutionState } from "../state/types.js";
import { recoverExecutionState } from "./index.js";

const buildState = (): ExecutionState => ({
  schemaVersion: 1,
  runId: "run-recovery-1",
  status: "in_progress",
  createdAt: "2026-11-21T00:00:00.000Z",
  updatedAt: "2026-11-21T00:00:00.000Z",
  repository: { root: "/tmp/repo", name: "repo", defaultBranch: "main" },
  approvals: [{ approvalId: "app-1", action: "create_issues", status: "unknown" }],
  tasks: [
    {
      stableId: "T1",
      issueNumber: 11,
      title: "Completed task",
      status: "in_progress",
      dependsOn: [],
    },
    {
      stableId: "T2",
      issueNumber: 12,
      title: "Remaining task",
      status: "ready",
      dependsOn: ["T1"],
    },
  ],
});

test("recoverExecutionState: skips verified completed tasks and treats unknown approval as unapproved", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ghc-recovery-"));
  const manager = new StateManager({ stateDir: dir, role: "orchestrator" });
  manager.save(buildState());

  const result = await recoverExecutionState(manager, "run-recovery-1", {
    tasks: [
      { stableId: "T1", issueNumber: 11, issueStatus: "closed", prStatus: "merged" },
      { stableId: "T2", issueNumber: 12, issueStatus: "open", prStatus: "none" },
    ],
  });

  assert.equal(result.status, "resumed");
  assert.deepEqual(result.skippedCompletedTaskIds, ["T1"]);
  assert.deepEqual(result.resumableTaskIds, ["T2"]);
  assert.deepEqual(result.unapprovedActionIds, ["app-1"]);
  assert.equal(result.state.approvals[0]?.status, "pending");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("recoverExecutionState: halts with diagnostic when ownership or issue number is ambiguous", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ghc-recovery-ambig-"));
  const manager = new StateManager({ stateDir: dir, role: "orchestrator" });
  manager.save(buildState());

  const result = await recoverExecutionState(manager, "run-recovery-1", {
    tasks: [{ stableId: "T1", issueNumber: 999, ownershipVerified: false }],
  });

  assert.equal(result.status, "halted_ambiguous");
  assert.equal(result.ambiguousReasons.length > 0, true);

  fs.rmSync(dir, { recursive: true, force: true });
});
