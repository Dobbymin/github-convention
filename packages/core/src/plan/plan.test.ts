import assert from "node:assert/strict";
import test from "node:test";
import {
  formatIdempotencyMarker,
  renderIssueBody,
  validateIssuePlan,
  type IssuePlan,
  type ParentIssueDraft,
  type SubIssueDraft,
} from "./index.js";

const createParent = (overrides: Partial<ParentIssueDraft> = {}): ParentIssueDraft => ({
  id: "epic-auth",
  title: "Auth and Planning Epic",
  summary: "Deliver GitHub read adapter and plan validation.",
  goals: ["Read GitHub state safely", "Validate issue plans"],
  inScope: ["Read-only gh adapter", "Plan validator"],
  outOfScope: ["Remote write mutations"],
  acceptanceCriteria: ["All unit tests pass"],
  type: "type:epic",
  priority: "priority:high",
  scopes: ["scope:github", "scope:orchestration"],
  ...overrides,
});

const createSubIssue = (id: string, overrides: Partial<SubIssueDraft> = {}): SubIssueDraft => ({
  id,
  title: `Task ${id}`,
  summary: `Implement ${id}`,
  context: "Part of epic-auth",
  requirements: ["Implement module cleanly"],
  tasks: ["Write implementation", "Add unit tests"],
  acceptanceCriteria: ["Unit tests pass"],
  hardDependencies: [],
  allowedFiles: [`packages/${id}/**`],
  sharedContracts: [],
  assumptions: ["None"],
  type: "type:feature",
  priority: "priority:medium",
  scopes: ["scope:adapter"],
  ...overrides,
});

test("validateIssuePlan: accepts a valid parent and sub-issue DAG", () => {
  const plan: IssuePlan = {
    planId: "plan-2026-11-21",
    parent: createParent(),
    subIssues: [
      createSubIssue("N10", { allowedFiles: ["packages/core/src/state/**"] }),
      createSubIssue("N11", {
        hardDependencies: ["N10"],
        allowedFiles: ["packages/github-adapter/src/read/**"],
      }),
    ],
  };

  const result = validateIssuePlan(plan);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("validateIssuePlan: detects missing dependency IDs and self-dependencies", () => {
  const plan: IssuePlan = {
    planId: "plan-missing-dep",
    parent: createParent(),
    subIssues: [
      createSubIssue("N1", { hardDependencies: ["N99"] }),
      createSubIssue("N2", { hardDependencies: ["N2"] }),
    ],
  };

  const result = validateIssuePlan(plan);
  assert.equal(result.valid, false);
  const codes = result.errors.map((e) => e.code);
  assert.ok(codes.includes("MISSING_DEPENDENCY_ID"));
  assert.ok(codes.includes("SELF_DEPENDENCY"));
});

test("validateIssuePlan: detects DAG cycles", () => {
  const plan: IssuePlan = {
    planId: "plan-cycle",
    parent: createParent(),
    subIssues: [
      createSubIssue("A", { hardDependencies: ["C"] }),
      createSubIssue("B", { hardDependencies: ["A"] }),
      createSubIssue("C", { hardDependencies: ["B"] }),
    ],
  };

  const result = validateIssuePlan(plan);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.code === "DEPENDENCY_CYCLE"));
});

test("validateIssuePlan: flags overlapping allowedFiles without hard dependency or shared contract", () => {
  const plan: IssuePlan = {
    planId: "plan-overlap",
    parent: createParent(),
    subIssues: [
      createSubIssue("A", { allowedFiles: ["packages\\core\\src\\plan\\**"] }),
      createSubIssue("B", { allowedFiles: ["packages/core/src/plan/types.ts"] }),
    ],
  };

  const result = validateIssuePlan(plan);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((e) => e.code === "OVERLAPPING_FILES_WITHOUT_DEPENDENCY_OR_CONTRACT"),
  );
});

test("validateIssuePlan: allows overlapping allowedFiles when hard dependency or shared contract exists", () => {
  const withDependency: IssuePlan = {
    planId: "plan-overlap-dep",
    parent: createParent(),
    subIssues: [
      createSubIssue("A", { allowedFiles: ["packages/core/src/plan/**"] }),
      createSubIssue("B", {
        hardDependencies: ["A"],
        allowedFiles: ["packages/core/src/plan/types.ts"],
      }),
    ],
  };

  assert.equal(validateIssuePlan(withDependency).valid, true);

  const withSharedContract: IssuePlan = {
    planId: "plan-overlap-contract",
    parent: createParent(),
    subIssues: [
      createSubIssue("A", {
        allowedFiles: ["packages/core/src/plan/types.ts"],
        sharedContracts: ["plan-types-v1"],
      }),
      createSubIssue("B", {
        allowedFiles: ["packages/core/src/plan/types.ts"],
        sharedContracts: ["plan-types-v1"],
      }),
    ],
    sharedContracts: [
      {
        id: "plan-types-v1",
        description: "Shared plan types contract",
        participants: ["A", "B"],
      },
    ],
  };

  assert.equal(validateIssuePlan(withSharedContract).valid, true);
});

test("validateIssuePlan: enforces label governance (1 type:*, <=1 priority:*, no blocked)", () => {
  const plan: IssuePlan = {
    planId: "plan-labels",
    parent: createParent({ type: "type:feature" }),
    subIssues: [
      createSubIssue("A", {
        type: "type:epic",
        priority: "priority:high",
        labels: ["priority:low", "blocked"],
      }),
    ],
  };

  const result = validateIssuePlan(plan);
  assert.equal(result.valid, false);
  const codes = result.errors.map((e) => e.code);
  assert.ok(codes.includes("INVALID_PARENT_TYPE_LABEL"));
  assert.ok(codes.includes("INVALID_SUB_ISSUE_TYPE_LABEL"));
  assert.ok(codes.includes("INVALID_PRIORITY_LABEL_COUNT"));
  assert.ok(codes.includes("DISALLOWED_BLOCKED_LABEL"));
});

test("renderIssueBody: renders deterministic bodies with stable idempotency marker and zero secrets", () => {
  const parent = createParent();
  const sub = createSubIssue("N11", {
    hardDependencies: ["N10"],
    allowedFiles: ["packages/github-adapter/src/read/**"],
    sharedContracts: ["gh-read-v1"],
    technicalNotes: ["Token ghp_abcdefghijklmnopqrstuvwxyz1234567890 must be redacted"],
  });

  const parentBody1 = renderIssueBody(parent, "plan-123", {
    subIssues: [{ id: sub.id, title: sub.title }],
  });
  const parentBody2 = renderIssueBody(parent, "plan-123", {
    subIssues: [{ id: sub.id, title: sub.title }],
  });

  assert.equal(parentBody1, parentBody2);
  assert.ok(parentBody1.includes(formatIdempotencyMarker("plan-123", "epic-auth")));
  assert.ok(parentBody1.includes("<!-- github-convention:plan=plan-123;task=epic-auth -->"));
  assert.ok(parentBody1.includes("- [ ] N11: Task N11"));

  const subBody = renderIssueBody(sub, "plan-123");
  assert.ok(subBody.includes("<!-- github-convention:plan=plan-123;task=N11 -->"));
  assert.ok(subBody.includes("- Blocked by: N10"));
  assert.ok(!subBody.includes("ghp_abcdefghijklmnopqrstuvwxyz1234567890"));
  assert.ok(subBody.includes("[REDACTED_GITHUB_TOKEN]"));
});
