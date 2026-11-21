import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import {
  atomicWriteFile,
  type ExecutionState,
  StateManager,
  validateExecutionState,
} from "./index.js";

const createValidState = (runId = "run-1"): ExecutionState => ({
  schemaVersion: 1,
  runId,
  status: "in_progress",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  repository: {
    root: "/workspace/test",
    owner: "test-owner",
    name: "test-repo",
    defaultBranch: "main",
  },
  parentIssue: {
    number: 10,
    url: "https://github.com/test-owner/test-repo/issues/10",
    status: "open",
  },
  approvals: [
    {
      approvalId: "app-1",
      action: "create_issue",
      status: "approved",
    },
  ],
  tasks: [
    {
      stableId: "task-1",
      title: "Task 1",
      status: "ready",
      dependsOn: [],
    },
    {
      stableId: "task-2",
      title: "Task 2",
      status: "blocked",
      dependsOn: ["task-1"],
    },
  ],
});

test("validateExecutionState: validates valid state and catches missing required fields", () => {
  const valid = createValidState();
  const res1 = validateExecutionState(valid);
  assert.equal(res1.valid, true);
  assert.equal(res1.errors.length, 0);

  const invalid = { ...valid, schemaVersion: 0, status: "invalid_status" };
  const res2 = validateExecutionState(invalid);
  assert.equal(res2.valid, false);
  assert.ok(res2.errors.some((e) => e.includes("schemaVersion")));
  assert.ok(res2.errors.some((e) => e.includes("status")));
});

test("atomicWriteFile: writes atomically via sibling temp file and never leaves partial file", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-test-"));
  const targetFile = path.join(tmpDir, "state.json");

  atomicWriteFile(targetFile, '{"hello":"world"}');
  assert.equal(fs.readFileSync(targetFile, "utf-8"), '{"hello":"world"}');

  // Verify no orphaned temp files
  const files = fs.readdirSync(tmpDir);
  assert.equal(files.length, 1);
  assert.equal(files[0], "state.json");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("StateManager: permits Orchestrator writes and strictly blocks Worker writes (FR-STATE-02)", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mgr-test-"));
  const validState = createValidState("run-auth");

  // 1. Worker tries to save -> fails
  const workerManager = new StateManager({ stateDir: tmpDir, role: "worker" });
  assert.throws(() => {
    workerManager.save(validState);
  }, /Permission denied: Only the Orchestrator may write or mutate shared run State/);

  // 2. Orchestrator saves -> succeeds
  const orchestratorManager = new StateManager({ stateDir: tmpDir, role: "orchestrator" });
  orchestratorManager.save(validState);

  // 3. Worker can load/read -> succeeds
  const loaded = workerManager.load("run-auth");
  assert.equal(loaded.runId, "run-auth");
  assert.equal(loaded.status, "in_progress");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("StateManager: transitions update atomically under lock and preserve schema", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mgr-test-"));
  const manager = new StateManager({ stateDir: tmpDir, role: "orchestrator" });
  const initial = createValidState("run-trans");
  manager.save(initial);

  const updated = await manager.transition("run-trans", (state) => {
    state.tasks[0].status = "completed";
    state.tasks[1].status = "ready";
  });

  assert.equal(updated.tasks[0].status, "completed");
  assert.equal(updated.tasks[1].status, "ready");

  const reloaded = manager.load("run-trans");
  assert.equal(reloaded.tasks[0].status, "completed");
  assert.equal(reloaded.tasks[1].status, "ready");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("StateManager: reconciles with remote GitHub status (FR-STATE-04)", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mgr-test-"));
  const manager = new StateManager({ stateDir: tmpDir, role: "orchestrator" });
  const initial = createValidState("run-reconcile");
  manager.save(initial);

  const reconciled = await manager.reconcileWithRemote("run-reconcile", {
    parentIssueStatus: "closed",
    tasks: [
      { stableId: "task-1", issueStatus: "closed" },
      { stableId: "task-2", issueStatus: "closed" },
    ],
  });

  assert.equal(reconciled.parentIssue?.status, "closed");
  assert.equal(reconciled.tasks[0].status, "completed");
  assert.equal(reconciled.tasks[1].status, "completed");
  assert.equal(reconciled.status, "completed");
  assert.equal(reconciled.remoteSync?.authoritativeSource, "github");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("atomicWriteJson: parses example state.json and validates against schema", () => {
  const exampleStatePath = path.resolve(process.cwd(), "examples/state.json");
  const raw = fs.readFileSync(exampleStatePath, "utf-8");
  const parsed = JSON.parse(raw);

  const validation = validateExecutionState(parsed);
  assert.equal(validation.valid, true);
  assert.equal(validation.errors.length, 0);
});
