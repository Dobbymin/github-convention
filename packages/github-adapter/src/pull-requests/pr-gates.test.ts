import assert from "node:assert/strict";
import test from "node:test";
import type { GhCommandRunner } from "../auth/types.js";
import { formatBranchName, planBaseRebase } from "../branches/index.js";
import { GitHubReadAdapter } from "../read/read-adapter.js";
import { createGatedPullRequest } from "./index.js";

test("branch workflow: formats branch names and blocks default-branch push / plain --force", () => {
  assert.equal(formatBranchName("feat", 34, "PR Gates!"), "feat/34-pr-gates");
  const blocked = planBaseRebase("main", "main", true);
  assert.equal(blocked.allowed, false);

  const safe = planBaseRebase("feat/34-pr-gates", "main", true);
  assert.equal(safe.allowed, true);
  assert.equal(safe.pushArgs.includes("--force-with-lease"), true);
  assert.equal(safe.pushArgs.includes("--force"), false);
});

test("createGatedPullRequest: blocks on failed gates, reuses existing PR, and creates non-draft PR linked to issue", async () => {
  const writeCalls: string[][] = [];
  const readEmpty = new GitHubReadAdapter({
    repo: "Dobbymin/github-convention",
    runner: () => "[]",
  });
  const writeRunner: GhCommandRunner = (_file, args) => {
    writeCalls.push([...args]);
    return "https://github.com/Dobbymin/github-convention/pull/99";
  };

  const blocked = await createGatedPullRequest(
    {
      repo: "Dobbymin/github-convention",
      issueNumber: 34,
      headBranch: "feat/34-gates",
      baseBranch: "main",
      title: "feat: gates (#34)",
      summary: "Summary",
      verificationSummary: "npm test passed",
      acceptanceChecklist: ["All gates pass"],
      gates: {
        acceptanceCriteriaPassed: true,
        testsPassed: true,
        secretScanClean: false,
        selfReviewPassed: true,
        rebasedOnLatestBase: true,
      },
    },
    readEmpty,
    writeRunner,
  );
  assert.equal(blocked.action, "blocked_by_gates");
  assert.deepEqual(blocked.failedGates, ["secret_scan"]);
  assert.equal(writeCalls.length, 0);

  const created = await createGatedPullRequest(
    {
      repo: "Dobbymin/github-convention",
      issueNumber: 34,
      headBranch: "feat/34-gates",
      baseBranch: "main",
      title: "feat: gates (#34)",
      summary: "Summary",
      verificationSummary: "npm test passed",
      acceptanceChecklist: ["All gates pass"],
      gates: {
        acceptanceCriteriaPassed: true,
        testsPassed: true,
        secretScanClean: true,
        selfReviewPassed: true,
        rebasedOnLatestBase: true,
      },
    },
    readEmpty,
    writeRunner,
  );
  assert.equal(created.action, "created");
  assert.equal(created.isDraft, false);
  assert.equal(created.mergeOwner, "user");
  assert.equal(created.prNumber, 99);
  assert.equal(writeCalls[0]?.includes("--draft"), false);

  const readExisting = new GitHubReadAdapter({
    repo: "Dobbymin/github-convention",
    runner: () =>
      JSON.stringify([
        {
          number: 99,
          title: "feat: gates (#34)",
          state: "OPEN",
          headRefName: "feat/34-gates",
          baseRefName: "main",
          url: "https://github.com/Dobbymin/github-convention/pull/99",
          labels: [],
        },
      ]),
  });
  const reused = await createGatedPullRequest(
    {
      repo: "Dobbymin/github-convention",
      issueNumber: 34,
      headBranch: "feat/34-gates",
      baseBranch: "main",
      title: "feat: gates (#34)",
      summary: "Summary",
      verificationSummary: "npm test passed",
      acceptanceChecklist: ["All gates pass"],
      gates: {
        acceptanceCriteriaPassed: true,
        testsPassed: true,
        secretScanClean: true,
        selfReviewPassed: true,
        rebasedOnLatestBase: true,
      },
    },
    readExisting,
    writeRunner,
  );
  assert.equal(reused.action, "reused");
  assert.equal(reused.prNumber, 99);
});
