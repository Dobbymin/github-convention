import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  approveGroup,
  createInitialApprovalRecord,
  ErrorCodes,
  loadApprovalRecord,
  saveApprovalRecord,
  type IssuePlan,
} from "@dobbymin/github-convention-core";
import {
  GitHubReadAdapter,
  type GhCommandRunner,
} from "@dobbymin/github-convention-github-adapter";
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

const writeActivePlan = (root: string, plan: IssuePlan = VALID_PLAN): string => {
  const planPath = path.join(root, ".github-convention", "state", "active", "plan.json");
  fs.mkdirSync(path.dirname(planPath), { recursive: true });
  fs.writeFileSync(planPath, JSON.stringify(plan), "utf-8");
  return planPath;
};

test("runPlanValidate and runPlanApply fail with CONFIG_INVALID when plan.json is missing or invalid JSON", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ghc-plan-missing-"));
  try {
    const valMissing = runPlanValidate({ projectRoot: root });
    assert.equal(valMissing.valid, false);
    assert.equal(valMissing.errorCode, ErrorCodes.CONFIG_INVALID);
    assert.ok(valMissing.error?.includes("Plan file not found"));

    const applyMissing = await runPlanApply({ projectRoot: root });
    assert.equal(applyMissing.status, "failed");
    assert.equal(applyMissing.errorCode, ErrorCodes.CONFIG_INVALID);
    assert.ok(applyMissing.error?.includes("Plan file not found"));

    const badPath = path.join(root, "bad.json");
    fs.writeFileSync(badPath, "{ not valid json", "utf-8");
    const valBad = runPlanValidate({ projectRoot: root, planPath: "bad.json" });
    assert.equal(valBad.valid, false);
    assert.equal(valBad.errorCode, ErrorCodes.CONFIG_INVALID);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runPlanApply loads plan.json and approvals from disk, auto-detects repo, creates issues, and links dependencies", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ghc-plan-disk-"));
  try {
    const planWithDep: IssuePlan = {
      ...VALID_PLAN,
      subIssues: [
        ...VALID_PLAN.subIssues,
        {
          id: "TASK-2",
          title: "Task 2",
          summary: "Depends on TASK-1",
          acceptanceCriteria: ["Passes"],
          hardDependencies: ["TASK-1"],
          allowedFiles: ["packages/cli/src/plan/b.ts"],
          sharedContracts: [],
          assumptions: [],
          type: "type:feature",
        },
      ],
    };
    writeActivePlan(root, planWithDep);
    const approved = approveGroup(createInitialApprovalRecord(planWithDep));
    saveApprovalRecord(root, approved);

    const readAdapter = new GitHubReadAdapter({
      runner: (_file, args) => {
        if (args[0] === "repo" && args[1] === "view") {
          return JSON.stringify({
            name: "github-convention",
            owner: { login: "Dobbymin" },
            nameWithOwner: "Dobbymin/github-convention",
            defaultBranchRef: { name: "main" },
            isPrivate: false,
            url: "https://github.com/Dobbymin/github-convention",
          });
        }
        return "[]";
      },
    });

    let nextIssueNum = 200;
    const postCalls: Array<{ endpoint: string; field: string }> = [];
    const writeRunner: GhCommandRunner = (_file, args) => {
      if (args[0] === "issue" && args[1] === "create") {
        assert.ok(args.includes("--repo"));
        assert.equal(args[args.indexOf("--repo") + 1], "Dobbymin/github-convention");
        return `https://github.com/Dobbymin/github-convention/issues/${nextIssueNum++}`;
      }
      if (args[0] === "api" && args.includes("GET")) {
        return "[]";
      }
      if (args[0] === "api" && args.includes("--jq") && args.includes(".id")) {
        const match = /\/issues\/(\d+)$/.exec(args[1] ?? "");
        return String(Number(match?.[1] ?? 0) + 50000);
      }
      if (args[0] === "api" && args.includes("POST")) {
        postCalls.push({
          endpoint: args[1] ?? "",
          field: args[args.indexOf("-F") + 1] ?? "",
        });
        return "{}";
      }
      return "{}";
    };

    const res = await runPlanApply({
      projectRoot: root,
      readAdapter,
      writeRunner,
    });

    assert.equal(res.status, "completed");
    assert.equal(res.dryRun, false);
    assert.equal(res.result?.createdCount, 3);
    assert.equal(res.result?.dependencies.filter((d) => d.action === "linked").length, 3);
    assert.deepEqual(postCalls, [
      {
        endpoint: "repos/Dobbymin/github-convention/issues/200/sub_issues",
        field: "sub_issue_id=50201",
      },
      {
        endpoint: "repos/Dobbymin/github-convention/issues/200/sub_issues",
        field: "sub_issue_id=50202",
      },
      {
        endpoint: "repos/Dobbymin/github-convention/issues/202/dependencies/blocked_by",
        field: "issue_id=50201",
      },
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runPlanApply handles interactive promptApproval and nonInteractive on unapproved disk plan", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ghc-plan-prompt-"));
  try {
    writeActivePlan(root, VALID_PLAN);

    const nonInt = await runPlanApply({
      projectRoot: root,
      nonInteractive: true,
    });
    assert.equal(nonInt.status, "approval_required");
    assert.equal(nonInt.approvalRequired, true);
    assert.equal(loadApprovalRecord(root, VALID_PLAN.planId), null);

    const declined = await runPlanApply({
      projectRoot: root,
      promptApproval: () => false,
    });
    assert.equal(declined.status, "approval_required");
    assert.equal(loadApprovalRecord(root, VALID_PLAN.planId), null);

    const readAdapter = new GitHubReadAdapter({
      repo: "Dobbymin/github-convention",
      runner: (_file, args) => {
        if (args[0] === "repo" && args[1] === "view") {
          return JSON.stringify({
            name: "github-convention",
            owner: { login: "Dobbymin" },
            nameWithOwner: "Dobbymin/github-convention",
            defaultBranchRef: { name: "main" },
            isPrivate: false,
            url: "https://github.com/Dobbymin/github-convention",
          });
        }
        return "[]";
      },
    });
    let nextIssue = 300;
    const writeRunner: GhCommandRunner = (_file, args) => {
      if (args[0] === "issue" && args[1] === "create") {
        return `https://github.com/Dobbymin/github-convention/issues/${nextIssue++}`;
      }
      if (args[0] === "api" && args.includes("GET")) return "[]";
      if (args[0] === "api" && args.includes("--jq")) return "90301";
      return "{}";
    };

    const accepted = await runPlanApply({
      projectRoot: root,
      promptApproval: () => true,
      readAdapter,
      writeRunner,
    });
    assert.equal(accepted.status, "completed");
    assert.equal(accepted.result?.createdCount, 2);
    const saved = loadApprovalRecord(root, VALID_PLAN.planId);
    assert.ok(saved);
    assert.equal(saved.groupStatus, "approved");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
