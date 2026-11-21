import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { IssuePlan } from "../plan/types.js";
import {
  approveGroup,
  approveItem,
  computeEffectiveReadiness,
  createInitialApprovalRecord,
  discardApprovalRecord,
  editItem,
  excludeItem,
  loadApprovalRecord,
  rejectGroup,
  rejectItem,
  saveApprovalRecord,
} from "./index.js";

const SAMPLE_PLAN: IssuePlan = {
  planId: "plan-n12-test",
  parent: {
    id: "EPIC-1",
    title: "Parent Epic",
    summary: "Top-level goal",
    goals: ["Deliver core workflow"],
    inScope: ["packages/core"],
    outOfScope: ["docs"],
    acceptanceCriteria: ["All sub-issues complete"],
    type: "type:epic",
    priority: "priority:high",
  },
  subIssues: [
    {
      id: "TASK-1",
      title: "First Task",
      summary: "Base task",
      acceptanceCriteria: ["Unit test passes"],
      hardDependencies: [],
      allowedFiles: ["packages/core/src/a.ts"],
      sharedContracts: [],
      assumptions: [],
      type: "type:feature",
      priority: "priority:high",
    },
    {
      id: "TASK-2",
      title: "Second Task",
      summary: "Dependent task",
      acceptanceCriteria: ["Depends on TASK-1"],
      hardDependencies: ["TASK-1"],
      allowedFiles: ["packages/core/src/b.ts"],
      sharedContracts: [],
      assumptions: [],
      type: "type:feature",
      priority: "priority:medium",
    },
  ],
};

test("approval store: supports group/item approve, edit, reject, exclude and preserves unapproved drafts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ghc-approval-"));
  let record = createInitialApprovalRecord(SAMPLE_PLAN);
  saveApprovalRecord(root, record);

  record = approveGroup(record);
  assert.equal(record.groupStatus, "approved");
  assert.equal(record.items["TASK-1"]?.status, "approved");

  record = editItem(record, "TASK-2", { title: "Edited Second Task" });
  assert.equal(record.plan.subIssues[1]?.title, "Edited Second Task");

  record = rejectItem(record, "TASK-2", "Needs rework");
  assert.equal(record.items["TASK-2"]?.status, "rejected");

  record = rejectGroup(record, "Hold all");
  assert.equal(record.items["EPIC-1"]?.status, "rejected");

  record = approveItem(record, "EPIC-1");
  record = approveItem(record, "TASK-1");
  saveApprovalRecord(root, record);

  const loaded = loadApprovalRecord(root, SAMPLE_PLAN.planId);
  assert.ok(loaded);
  assert.equal(loaded.items["TASK-1"]?.status, "approved");
  assert.equal(loaded.items["TASK-2"]?.status, "rejected");
  assert.equal(loaded.plan.subIssues[1]?.title, "Edited Second Task");

  assert.equal(discardApprovalRecord(root, SAMPLE_PLAN.planId), true);
  assert.equal(loadApprovalRecord(root, SAMPLE_PLAN.planId), null);

  fs.rmSync(root, { recursive: true, force: true });
});

test("approval readiness: approved downstream task stays approved but blocked when prerequisite is excluded", () => {
  let record = createInitialApprovalRecord(SAMPLE_PLAN);
  record = approveGroup(record);
  record = excludeItem(record, "TASK-1", "Deferred");

  const readiness = computeEffectiveReadiness(record);
  const task1 = readiness.tasks.find((t) => t.taskId === "TASK-1");
  const task2 = readiness.tasks.find((t) => t.taskId === "TASK-2");

  assert.equal(task1?.status, "excluded");
  assert.equal(task1?.eligibleToCreate, false);
  assert.equal(task2?.status, "approved");
  assert.equal(task2?.blockedByUnapproved, true);
  assert.deepEqual(task2?.blockingTaskIds, ["TASK-1"]);
});
