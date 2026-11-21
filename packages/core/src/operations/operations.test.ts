import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MAX_TRANSIENT_RETRIES, evaluateDeploymentStatus } from "./index.js";

test("evaluateDeploymentStatus: marks succeeded deployment with passing health checks as healthy", () => {
  const result = evaluateDeploymentStatus({
    environment: "production",
    deploymentId: "dep-101",
    commitSha: "abc1234",
    status: "succeeded",
    healthChecks: [{ name: "/healthz", passed: true, statusCode: 200 }],
  });

  assert.equal(result.outcome, "healthy");
  assert.equal(result.shouldRetry, false);
  assert.equal(result.haltFurtherActions, false);
  assert.equal(result.nextAction, "none");
  assert.equal(result.rollbackPlan, undefined);
});

test("evaluateDeploymentStatus: waits on pending deployment", () => {
  const result = evaluateDeploymentStatus({
    environment: "staging",
    status: "pending",
  });

  assert.equal(result.outcome, "pending");
  assert.equal(result.shouldRetry, false);
  assert.equal(result.haltFurtherActions, false);
  assert.equal(result.nextAction, "wait");
});

test("evaluateDeploymentStatus: retries transient errors up to maxTransientRetries = 2 then halts with approval-gated rollback", () => {
  assert.equal(DEFAULT_MAX_TRANSIENT_RETRIES, 2);

  const firstRetry = evaluateDeploymentStatus({
    environment: "production",
    status: "transient_error",
    transientRetriesUsed: 0,
    errorMessage: "ETIMEDOUT connecting to deployment endpoint",
  });
  assert.equal(firstRetry.outcome, "retry_transient");
  assert.equal(firstRetry.shouldRetry, true);
  assert.equal(firstRetry.haltFurtherActions, false);
  assert.equal(firstRetry.nextAction, "retry");
  assert.equal(firstRetry.remainingTransientRetries, 1);
  assert.equal(firstRetry.rollbackPlan, undefined);

  const secondRetry = evaluateDeploymentStatus({
    environment: "production",
    status: "transient_error",
    transientRetriesUsed: 1,
    errorMessage: "503 Service Unavailable",
  });
  assert.equal(secondRetry.outcome, "retry_transient");
  assert.equal(secondRetry.shouldRetry, true);
  assert.equal(secondRetry.remainingTransientRetries, 0);

  const exhausted = evaluateDeploymentStatus({
    environment: "production",
    status: "transient_error",
    transientRetriesUsed: 2,
    previousSuccessfulDeploymentId: "dep-99",
    previousSuccessfulCommitSha: "prevsha1",
  });
  assert.equal(exhausted.outcome, "halted_retry_exhausted");
  assert.equal(exhausted.shouldRetry, false);
  assert.equal(exhausted.haltFurtherActions, true);
  assert.equal(exhausted.nextAction, "halt");
  assert.equal(exhausted.rollbackPlan?.requiresApproval, true);
  assert.equal(exhausted.rollbackPlan?.autoExecute, false);
  assert.equal(exhausted.rollbackPlan?.targetDeploymentId, "dep-99");
  assert.equal(exhausted.rollbackPlan?.targetCommitSha, "prevsha1");
});

test("evaluateDeploymentStatus: halts immediately on health-check failure and never auto-rolls back", () => {
  const result = evaluateDeploymentStatus({
    environment: "production",
    deploymentId: "dep-200",
    status: "succeeded",
    healthChecks: [
      { name: "/healthz", passed: true, statusCode: 200 },
      { name: "/readyz", passed: false, statusCode: 500, detail: "DB unreachable" },
    ],
    previousSuccessfulDeploymentId: "dep-199",
  });

  assert.equal(result.outcome, "halted_health_check");
  assert.equal(result.shouldRetry, false);
  assert.equal(result.haltFurtherActions, true);
  assert.equal(result.nextAction, "halt");
  assert.equal(result.failedHealthChecks.length, 1);
  assert.equal(result.failedHealthChecks[0]?.name, "/readyz");
  assert.equal(result.rollbackPlan?.requiresApproval, true);
  assert.equal(result.rollbackPlan?.autoExecute, false);
});

test("evaluateDeploymentStatus: halts immediately on missing config or secrets and redacts secret values", () => {
  const result = evaluateDeploymentStatus({
    environment: "production",
    status: "missing_config",
    missingConfigKeys: ["DEPLOY_WEBHOOK_SECRET", "API_TOKEN"],
  });

  assert.equal(result.outcome, "halted_missing_config");
  assert.equal(result.shouldRetry, false);
  assert.equal(result.haltFurtherActions, true);
  assert.equal(result.nextAction, "halt");
  assert.deepEqual(result.missingConfigKeys, ["DEPLOY_WEBHOOK_SECRET", "API_TOKEN"]);
  assert.equal(result.rollbackPlan?.requiresApproval, true);
  assert.equal(result.rollbackPlan?.autoExecute, false);

  const failedWithSecret = evaluateDeploymentStatus({
    environment: "production",
    status: "failed",
    errorMessage: "Auth failed using ghp_1234567890abcdefghij1234567890abcdef",
  });
  assert.equal(failedWithSecret.summary.includes("ghp_"), false);
  assert.equal(failedWithSecret.rollbackPlan?.reason.includes("ghp_"), false);
  assert.equal(failedWithSecret.rollbackPlan?.requiresApproval, true);
});
