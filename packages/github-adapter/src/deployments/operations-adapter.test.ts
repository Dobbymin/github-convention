import assert from "node:assert/strict";
import test from "node:test";
import { inspectBranchProtection, proposeProtectionChanges } from "../protection/index.js";
import type { GhCommandRunner } from "../auth/types.js";
import { observeDeploymentWithRunner } from "./index.js";

const hasMutationCall = (calls: readonly (readonly string[])[]): boolean =>
  calls.some(
    (args) =>
      args.includes("-X") &&
      (args.includes("PUT") ||
        args.includes("POST") ||
        args.includes("PATCH") ||
        args.includes("DELETE")),
  );

test("inspectBranchProtection & proposeProtectionChanges: reports all gaps on unprotected branch and never mutates without approval", async () => {
  const calls: string[][] = [];
  const runner: GhCommandRunner = (_file, args) => {
    calls.push([...args]);
    if (args[1]?.includes("/protection")) {
      throw new Error("HTTP 404: Branch not protected");
    }
    if (args[1]?.includes("/rules/branches/")) {
      return "[]";
    }
    return "{}";
  };

  const snapshot = await inspectBranchProtection({
    owner: "acme",
    repo: "demo",
    branch: "main",
    runner,
    requiredChecks: ["test", "lint"],
  });

  assert.equal(snapshot.protected, false);
  assert.equal(snapshot.source, "none");
  assert.deepEqual(
    snapshot.gaps.map((g) => g.kind),
    [
      "require_pull_request",
      "require_status_checks",
      "block_force_pushes",
      "block_deletions",
      "require_conversation_resolution",
    ],
  );

  const unapproved = await proposeProtectionChanges(snapshot, {
    requiredChecks: ["test", "lint"],
    runner,
  });
  assert.equal(unapproved.requiresApproval, true);
  assert.equal(unapproved.approved, false);
  assert.equal(unapproved.applied, false);
  assert.equal(hasMutationCall(calls), false);

  const dryRunApproved = await proposeProtectionChanges(snapshot, {
    requiredChecks: ["test", "lint"],
    approved: true,
    dryRun: true,
    runner,
  });
  assert.equal(dryRunApproved.requiresApproval, true);
  assert.equal(dryRunApproved.applied, false);
  assert.equal(hasMutationCall(calls), false);

  const applied = await proposeProtectionChanges(snapshot, {
    requiredChecks: ["test", "lint"],
    approved: true,
    dryRun: false,
    runner,
  });
  assert.equal(applied.requiresApproval, true);
  assert.equal(applied.applied, true);
  assert.equal(hasMutationCall(calls), true);
});

test("inspectBranchProtection: combines classic protection and rulesets to report only missing CI checks", async () => {
  const runner: GhCommandRunner = (_file, args) => {
    if (args[1]?.includes("/protection")) {
      return JSON.stringify({
        required_pull_request_reviews: { required_approving_review_count: 1 },
        required_status_checks: { contexts: ["test"] },
        allow_force_pushes: { enabled: false },
        allow_deletions: { enabled: false },
        required_conversation_resolution: { enabled: false },
      });
    }
    if (args[1]?.includes("/rules/branches/")) {
      return JSON.stringify([
        {
          type: "pull_request",
          parameters: { require_conversation_resolution: true },
        },
      ]);
    }
    return "{}";
  };

  const snapshot = await inspectBranchProtection({
    owner: "acme",
    repo: "demo",
    branch: "main",
    runner,
    requiredChecks: ["test", "lint"],
  });

  assert.equal(snapshot.protected, true);
  assert.equal(snapshot.source, "both");
  assert.equal(snapshot.requirePullRequest, true);
  assert.equal(snapshot.blockForcePushes, true);
  assert.equal(snapshot.blockDeletions, true);
  assert.equal(snapshot.requireConversationResolution, true);
  assert.deepEqual(snapshot.requiredStatusCheckContexts, ["test"]);
  assert.deepEqual(
    snapshot.gaps.map((g) => g.kind),
    ["require_status_checks"],
  );
});

test("observeDeploymentWithRunner: evaluates healthy deployment, health-check failure, and transient retries with no auto-rollback", async () => {
  const calls: string[][] = [];
  const healthyRunner: GhCommandRunner = (_file, args) => {
    calls.push([...args]);
    if (args[1]?.includes("/statuses")) {
      return JSON.stringify([{ state: "success", environment_url: "https://example.test/health" }]);
    }
    return JSON.stringify([
      { id: 20, sha: "newsha" },
      { id: 19, sha: "oldsha" },
    ]);
  };

  const healthy = await observeDeploymentWithRunner({
    owner: "acme",
    repo: "demo",
    environment: "production",
    runner: healthyRunner,
    healthChecker: async (url) => [{ name: "http", passed: true, statusCode: 200, url }],
  });
  assert.equal(healthy.outcome, "healthy");
  assert.equal(healthy.haltFurtherActions, false);
  assert.equal(hasMutationCall(calls), false);

  const failedHealth = await observeDeploymentWithRunner({
    owner: "acme",
    repo: "demo",
    environment: "production",
    runner: healthyRunner,
    healthChecker: async () => [{ name: "http", passed: false, statusCode: 503, detail: "down" }],
  });
  assert.equal(failedHealth.outcome, "halted_health_check");
  assert.equal(failedHealth.haltFurtherActions, true);
  assert.equal(failedHealth.rollbackPlan?.requiresApproval, true);
  assert.equal(failedHealth.rollbackPlan?.autoExecute, false);
  assert.equal(failedHealth.rollbackPlan?.targetDeploymentId, "19");
  assert.equal(hasMutationCall(calls), false);

  const transientRunner: GhCommandRunner = (_file, args) => {
    calls.push([...args]);
    throw new Error("ETIMEDOUT connecting to api.github.com");
  };

  const retryable = await observeDeploymentWithRunner({
    owner: "acme",
    repo: "demo",
    environment: "production",
    runner: transientRunner,
    transientRetriesUsed: 0,
  });
  assert.equal(retryable.outcome, "retry_transient");
  assert.equal(retryable.shouldRetry, true);
  assert.equal(hasMutationCall(calls), false);

  const exhausted = await observeDeploymentWithRunner({
    owner: "acme",
    repo: "demo",
    environment: "production",
    runner: transientRunner,
    transientRetriesUsed: 2,
  });
  assert.equal(exhausted.outcome, "halted_retry_exhausted");
  assert.equal(exhausted.haltFurtherActions, true);
  assert.equal(exhausted.rollbackPlan?.requiresApproval, true);
  assert.equal(exhausted.rollbackPlan?.autoExecute, false);
  assert.equal(hasMutationCall(calls), false);
});
