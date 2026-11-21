import assert from "node:assert/strict";
import test from "node:test";
import { buildFollowUpProposal, evaluateParentLifecycle, evaluateTaskReadiness } from "./index.js";

test("evaluateParentLifecycle: closes only when all children closed and reopens on new open child", () => {
  const keepOpen = evaluateParentLifecycle({ issueNumber: 1, state: "open" }, [
    { taskId: "T1", issueNumber: 2, state: "closed" },
    { taskId: "T2", issueNumber: 3, state: "open" },
  ]);
  assert.equal(keepOpen.action, "keep_open");

  const closeParent = evaluateParentLifecycle({ issueNumber: 1, state: "open" }, [
    { taskId: "T1", issueNumber: 2, state: "closed" },
    { taskId: "T2", issueNumber: 3, state: "closed" },
  ]);
  assert.equal(closeParent.action, "close_parent");

  const reopenParent = evaluateParentLifecycle({ issueNumber: 1, state: "closed" }, [
    { taskId: "T1", issueNumber: 2, state: "closed" },
    { taskId: "T3", issueNumber: 4, state: "open" },
  ]);
  assert.equal(reopenParent.action, "reopen_parent");
});

test("evaluateTaskReadiness: code dependency requires PR merged + Issue closed; contract dependency allows parallel", () => {
  const blocked = evaluateTaskReadiness("T2", [{ taskId: "T1", kind: "code" }], {
    T1: { taskId: "T1", issueState: "open", prState: "merged" },
  });
  assert.equal(blocked.ready, false);
  assert.deepEqual(blocked.waitingOnTaskIds, ["T1"]);

  const readyCode = evaluateTaskReadiness("T2", [{ taskId: "T1", kind: "code" }], {
    T1: { taskId: "T1", issueState: "closed", prState: "merged" },
  });
  assert.equal(readyCode.ready, true);

  const readyContract = evaluateTaskReadiness(
    "FE-1",
    [{ taskId: "BE-1", kind: "contract", contractDoc: "docs/api.md" }],
    { "BE-1": { taskId: "BE-1", issueState: "open", prState: "open" } },
  );
  assert.equal(readyContract.ready, true);
});

test("buildFollowUpProposal: sets impact-based priority, redacts secrets, and requires approval", () => {
  const mediumProposal = buildFollowUpProposal(
    {
      taskId: "T9",
      title: "Fix flaky sync",
      originalIssueNumber: 42,
      parentIssueNumber: 10,
      failureSummary: "Token ghp_1234567890abcdefghij1234567890abcdef failed",
      attemptsUsed: 3,
      changedFiles: ["packages/core/src/sync.ts"],
    },
    "medium",
  );

  assert.equal(mediumProposal.priority, "priority:medium");
  assert.equal(mediumProposal.requiresApproval, true);
  assert.equal(mediumProposal.parentIssueNumber, 10);
  assert.equal(mediumProposal.body.includes("ghp_"), false);
});
