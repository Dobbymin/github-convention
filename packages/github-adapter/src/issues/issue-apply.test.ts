import assert from "node:assert/strict";
import test from "node:test";
import {
  approveGroup,
  approveItem,
  createInitialApprovalRecord,
  excludeItem,
  formatIdempotencyMarker,
  rejectItem,
  type IssuePlan,
} from "@dobbymin/github-convention-core";
import type { GhCommandRunner } from "../auth/types.js";
import { GitHubReadAdapter } from "../read/read-adapter.js";
import { applyApprovedIssues } from "./idempotent-issues.js";

const SAMPLE_PLAN: IssuePlan = {
  planId: "plan-n12",
  parent: {
    id: "EPIC-1",
    title: "Parent Epic",
    summary: "Top-level goal",
    goals: ["Goal 1"],
    inScope: ["packages/core"],
    outOfScope: ["docs"],
    acceptanceCriteria: ["AC 1"],
    type: "type:epic",
    priority: "priority:high",
  },
  subIssues: [
    {
      id: "TASK-1",
      title: "Base Task",
      summary: "First task",
      acceptanceCriteria: ["Test passes"],
      hardDependencies: [],
      allowedFiles: ["packages/core/src/a.ts"],
      sharedContracts: [],
      assumptions: [],
      type: "type:feature",
      priority: "priority:high",
    },
    {
      id: "TASK-2",
      title: "Dependent Task",
      summary: "Depends on TASK-1",
      acceptanceCriteria: ["Test passes"],
      hardDependencies: ["TASK-1"],
      allowedFiles: ["packages/core/src/b.ts"],
      sharedContracts: [],
      assumptions: [],
      type: "type:feature",
      priority: "priority:medium",
    },
  ],
};

test("applyApprovedIssues: creates only approved issues, links native dependencies, and never emits blocked labels", async () => {
  const remoteIssues: Array<{
    number: number;
    title: string;
    body: string;
    state: string;
    labels: string[];
    url: string;
  }> = [];
  const calls: Array<{ file: string; args: readonly string[] }> = [];
  let nextIssueNumber = 100;

  const readAdapter = new GitHubReadAdapter({
    repo: "Dobbymin/github-convention",
    runner: (_file, args) => {
      if (args[0] === "issue" && args[1] === "list") {
        return JSON.stringify(
          remoteIssues.map((issue) => ({
            ...issue,
            labels: issue.labels.map((name) => ({ name })),
          })),
        );
      }
      return "[]";
    },
  });

  const writeRunner: GhCommandRunner = (file, args) => {
    calls.push({ file, args });
    if (args[0] === "issue" && args[1] === "create") {
      assert.equal(args.includes("blocked"), false);
      const num = ++nextIssueNumber;
      const titleIdx = args.indexOf("--title") + 1;
      const bodyIdx = args.indexOf("--body") + 1;
      const url = `https://github.com/Dobbymin/github-convention/issues/${num}`;
      remoteIssues.push({
        number: num,
        title: args[titleIdx] ?? "",
        body: args[bodyIdx] ?? "",
        state: "OPEN",
        labels: [],
        url,
      });
      return url;
    }
    if (args[0] === "api" && args.includes("GET")) {
      return "[]";
    }
    return "{}";
  };

  let approvals = createInitialApprovalRecord(SAMPLE_PLAN);
  approvals = approveGroup(approvals);

  const dryRunResult = await applyApprovedIssues(SAMPLE_PLAN, approvals, readAdapter, writeRunner, {
    repo: "Dobbymin/github-convention",
    dryRun: true,
  });
  assert.equal(dryRunResult.dryRun, true);
  assert.equal(dryRunResult.createdCount, 3);
  assert.equal(calls.length, 0);

  const realResult = await applyApprovedIssues(SAMPLE_PLAN, approvals, readAdapter, writeRunner, {
    repo: "Dobbymin/github-convention",
  });
  assert.equal(realResult.createdCount, 3);
  assert.equal(realResult.reusedCount, 0);
  assert.equal(realResult.dependencies.filter((d) => d.action === "linked").length, 3);
  assert.equal(remoteIssues.length, 3);
});

test("applyApprovedIssues: lost-response retry reuses existing issue via idempotency marker without duplicates", async () => {
  const marker = formatIdempotencyMarker(SAMPLE_PLAN.planId, "TASK-1");
  const remoteIssues = [
    {
      number: 51,
      title: "Parent Epic",
      body: formatIdempotencyMarker(SAMPLE_PLAN.planId, "EPIC-1"),
      state: "OPEN",
      labels: [],
      url: "https://github.com/Dobbymin/github-convention/issues/51",
    },
    {
      number: 52,
      title: "Base Task",
      body: `Previously created before lost response\n${marker}`,
      state: "OPEN",
      labels: [],
      url: "https://github.com/Dobbymin/github-convention/issues/52",
    },
  ];
  const createdTitles: string[] = [];

  const readAdapter = new GitHubReadAdapter({
    repo: "Dobbymin/github-convention",
    runner: () =>
      JSON.stringify(
        remoteIssues.map((issue) => ({
          ...issue,
          labels: [],
        })),
      ),
  });

  const writeRunner: GhCommandRunner = (_file, args) => {
    if (args[0] === "issue" && args[1] === "create") {
      createdTitles.push(args[args.indexOf("--title") + 1] ?? "");
      return "https://github.com/Dobbymin/github-convention/issues/53";
    }
    if (args[0] === "api" && args.includes("GET")) {
      return "[]";
    }
    return "{}";
  };

  let approvals = createInitialApprovalRecord(SAMPLE_PLAN);
  approvals = approveGroup(approvals);

  const result = await applyApprovedIssues(SAMPLE_PLAN, approvals, readAdapter, writeRunner, {
    repo: "Dobbymin/github-convention",
  });

  assert.equal(result.reusedCount, 2);
  assert.equal(result.createdCount, 1);
  assert.deepEqual(createdTitles, ["Dependent Task"]);
});

test("applyApprovedIssues: skips rejected tasks and blocks approved downstream tasks when prerequisite is excluded", async () => {
  const writeCalls: Array<{ file: string; args: readonly string[] }> = [];
  const readAdapter = new GitHubReadAdapter({
    repo: "Dobbymin/github-convention",
    runner: () => "[]",
  });
  const writeRunner: GhCommandRunner = (file, args) => {
    writeCalls.push({ file, args });
    return "https://github.com/Dobbymin/github-convention/issues/201";
  };

  let approvals = createInitialApprovalRecord(SAMPLE_PLAN);
  approvals = approveItem(approvals, "EPIC-1");
  approvals = excludeItem(approvals, "TASK-1", "Deferred");
  approvals = approveItem(approvals, "TASK-2");

  const result = await applyApprovedIssues(SAMPLE_PLAN, approvals, readAdapter, writeRunner, {
    repo: "Dobbymin/github-convention",
  });

  assert.equal(result.createdCount, 1);
  assert.equal(result.items.find((i) => i.taskId === "TASK-1")?.action, "skip_unapproved");
  assert.equal(result.items.find((i) => i.taskId === "TASK-2")?.action, "blocked_by_unapproved");

  let rejectedApprovals = createInitialApprovalRecord(SAMPLE_PLAN);
  rejectedApprovals = approveGroup(rejectedApprovals);
  rejectedApprovals = rejectItem(rejectedApprovals, "TASK-1");
  const rejectedResult = await applyApprovedIssues(
    SAMPLE_PLAN,
    rejectedApprovals,
    readAdapter,
    writeRunner,
    {
      repo: "Dobbymin/github-convention",
      dryRun: true,
    },
  );
  assert.equal(rejectedResult.items.find((i) => i.taskId === "TASK-1")?.action, "skip_unapproved");
});
