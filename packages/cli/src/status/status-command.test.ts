import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import {
  archiveCompletedRun,
  ExitCodes,
  getActiveStateDir,
  StateManager,
  type ExecutionState,
} from "@dobbymin/github-convention-core";
import { runCli } from "../runner.js";
import { runStatus } from "./index.js";

const createTempDir = (): string =>
  fs.mkdtempSync(path.join(os.tmpdir(), "github-convention-status-"));

const makeExecutionState = (overrides: Partial<ExecutionState> = {}): ExecutionState => ({
  schemaVersion: 1,
  runId: "run-1",
  status: "in_progress",
  repository: {
    root: "/tmp/repo",
    owner: "Dobbymin",
    name: "github-convention",
    defaultBranch: "main",
  },
  createdAt: "2026-11-21T10:00:00Z",
  updatedAt: "2026-11-21T10:05:00Z",
  tasks: [],
  approvals: [],
  ...overrides,
});

test("runStatus reports idle on empty project", () => {
  const projectDir = createTempDir();
  const result = runStatus({ projectRoot: projectDir });

  assert.equal(result.state, "idle");
  assert.equal(result.project, projectDir);
  assert.equal(result.activeCount, 0);
  assert.equal(result.archivedCount, 0);
  assert.equal(result.latestRun, null);
  assert.deepEqual(result.warnings, []);
});

test("runStatus loads active runs, counts archives, and warns on corrupted state JSON", () => {
  const projectDir = createTempDir();
  const activeDir = getActiveStateDir(projectDir);
  fs.mkdirSync(activeDir, { recursive: true });
  const manager = new StateManager({ stateDir: activeDir, role: "orchestrator" });

  manager.save(
    makeExecutionState({
      runId: "run-active",
      status: "in_progress",
      approvals: [
        {
          approvalId: "apr-1",
          action: "issue_creation",
          status: "pending",
        },
      ],
    }),
  );

  manager.save(
    makeExecutionState({
      runId: "run-done",
      status: "completed",
    }),
  );
  archiveCompletedRun(projectDir, "run-done");

  fs.writeFileSync(path.join(activeDir, "corrupted.json"), "{ invalid json", "utf-8");

  const result = runStatus({ projectRoot: projectDir });
  assert.equal(result.state, "in_progress");
  assert.equal(result.activeCount, 1);
  assert.equal(result.archivedCount, 1);
  assert.equal(result.latestRun?.runId, "run-active");
  assert.equal(result.latestRun?.repository, "Dobbymin/github-convention");
  assert.equal(result.latestRun?.pendingApprovals, 1);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0] ?? "", /corrupted\.json/);
});

test("CLI status command emits valid JSON envelope with real state data", async () => {
  const projectDir = createTempDir();
  const activeDir = getActiveStateDir(projectDir);
  fs.mkdirSync(activeDir, { recursive: true });
  const manager = new StateManager({ stateDir: activeDir, role: "orchestrator" });
  manager.save(makeExecutionState({ runId: "run-cli", status: "blocked" }));

  const res = await runCli(["status", "--project", projectDir, "--output", "json"], {
    stdout: () => {},
    stderr: () => {},
  });

  assert.equal(res.exitCode, ExitCodes.SUCCESS);
  const parsed = JSON.parse(res.stdoutText) as {
    data: { state: string; activeCount: number; latestRun: { runId: string } | null };
  };
  assert.equal(parsed.data.state, "blocked");
  assert.equal(parsed.data.activeCount, 1);
  assert.equal(parsed.data.latestRun?.runId, "run-cli");
});
