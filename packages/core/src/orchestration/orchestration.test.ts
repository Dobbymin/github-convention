import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateRetryDecision,
  preserveInterruptedWorkspace,
  propagateTaskFailure,
} from "./index.js";

test("evaluateRetryDecision: caps retries at 2 and stops early on identical or non-retryable errors", () => {
  const first = evaluateRetryDecision([], {
    category: "test_failure",
    signature: "ERR_1",
    message: "Test failed",
  });
  assert.equal(first.action, "retry");
  assert.equal(first.retriesRemaining, 2);

  const identical = evaluateRetryDecision(
    [{ attempt: 1, category: "test_failure", signature: "ERR_1", message: "Test failed" }],
    { category: "test_failure", signature: "ERR_1", message: "Test failed" },
  );
  assert.equal(identical.action, "escalate_followup");

  const nonRetryable = evaluateRetryDecision([], {
    category: "auth",
    signature: "AUTH_401",
    message: "Auth expired",
  });
  assert.equal(nonRetryable.action, "escalate_followup");

  const exhausted = evaluateRetryDecision(
    [
      { attempt: 1, category: "test_failure", signature: "E1", message: "1" },
      { attempt: 2, category: "test_failure", signature: "E2", message: "2" },
    ],
    { category: "test_failure", signature: "E3", message: "3" },
  );
  assert.equal(exhausted.action, "escalate_followup");
});

test("propagateTaskFailure: blocks transitive dependents while keeping independent tasks schedulable", () => {
  const result = propagateTaskFailure(
    [
      { id: "T1", hardDependencies: [], status: "failed" },
      { id: "T2", hardDependencies: ["T1"], status: "pending" },
      { id: "T3", hardDependencies: ["T2"], status: "pending" },
      { id: "T4", hardDependencies: [], status: "ready" },
    ],
    "T1",
  );

  assert.deepEqual(result.blockedTaskIds, ["T2", "T3"]);
  assert.deepEqual(result.schedulableTaskIds, ["T4"]);
});

test("preserveInterruptedWorkspace: retains partial edits and flags review", () => {
  const preserved = preserveInterruptedWorkspace({
    taskId: "T1",
    workspacePath: "/tmp/wt-t1",
    changedFiles: ["src/a.ts"],
    logPaths: ["logs/t1.log"],
  });

  assert.equal(preserved.requiresReview, true);
  assert.deepEqual(preserved.preservedFiles, ["src/a.ts"]);
});
