import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { IssuePlan } from "@github-convention/core";
import { GitHubReadAdapter } from "@github-convention/github-adapter";
import { runPlanApply, runPlanValidate } from "./index.js";

const VALID_PLAN: IssuePlan = {
  planId: "plan-cli-1",
  parent: {
    id: "EPIC-1",
    title: "Epic",
    summary: "Summary",
    goals: ["Goal"],
    inScope: ["packages/cli"],
    outOfScope: ["docs"],
    acceptanceCriteria: ["Done"],
    type: "type:epic",
  },
  subIssues: [
    {
      id: "TASK-1",
      title: "Task 1",
      summary: "Summary",
      acceptanceCriteria: ["Passes"],
      hardDependencies: [],
      allowedFiles: ["packages/cli/src/plan/a.ts"],
      sharedContracts: [],
      assumptions: [],
      type: "type:feature",
    },
  ],
};

test("runPlanValidate: validates plan file when present", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ghc-plan-cmd-"));
  const planPath = path.join(root, "plan.json");
  fs.writeFileSync(planPath, JSON.stringify(VALID_PLAN), "utf-8");

  const res = runPlanValidate({ projectRoot: root, planPath });
  assert.equal(res.valid, true);
  assert.equal(res.planId, "plan-cli-1");

  fs.rmSync(root, { recursive: true, force: true });
});

test("runPlanApply: non-interactive without explicit approval returns approval_required", async () => {
  const res = await runPlanApply({
    plan: VALID_PLAN,
    nonInteractive: true,
    explicitApproval: false,
  });
  assert.equal(res.status, "approval_required");
  assert.equal(res.approvalRequired, true);
});

test("runPlanApply: dry-run previews without remote writes", async () => {
  const readAdapter = new GitHubReadAdapter({
    repo: "Dobbymin/github-convention",
    runner: () => "[]",
  });
  const res = await runPlanApply({
    plan: VALID_PLAN,
    dryRun: true,
    readAdapter,
  });
  assert.equal(res.status, "completed");
  assert.equal(res.dryRun, true);
  assert.equal(res.result?.planId, "plan-cli-1");
});
