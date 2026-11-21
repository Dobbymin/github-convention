import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkerAssignment, validateTaskReport, verifyWorkerResult } from "./index.js";

const VALID_REPORT = `## Task Report

- Issue: #32
- Status: completed

### Summary

Implemented worker contract and parser.

### Changed Files

- \`packages/core/src/workers/task-report.ts\`

### Tests

- Unit Tests: PASS

### Technical Decisions

- None.

### Known Issues

- None.

### Blockers

- None.
`;

test("buildWorkerAssignment: enforces forbidden actions and English report contract", () => {
  const assignment = buildWorkerAssignment({
    taskId: "N15",
    issueNumber: 32,
    workspacePath: "/tmp/wt-n15",
    acceptanceCriteria: ["Tests pass"],
    allowedFiles: ["packages/core/src/workers/**"],
    testCommands: ["npm test"],
  });

  assert.equal(assignment.reportLanguage, "en");
  assert.equal(assignment.forbiddenActions.includes("git_commit"), true);
  assert.equal(assignment.forbiddenActions.includes("shared_state_write"), true);
});

test("validateTaskReport & verifyWorkerResult: independently rejects out-of-scope edits and forbidden actions", () => {
  const parsed = validateTaskReport(VALID_REPORT);
  assert.equal(parsed.valid, true);
  assert.deepEqual(parsed.report.changedFiles, ["packages/core/src/workers/task-report.ts"]);

  const ok = verifyWorkerResult({
    report: parsed.report,
    actualChangedFiles: ["packages/core/src/workers/task-report.ts"],
    allowedFiles: ["packages/core/src/workers/**"],
    secretFindings: [],
    verificationPassed: true,
  });
  assert.equal(ok.accepted, true);

  const rejected = verifyWorkerResult({
    report: parsed.report,
    actualChangedFiles: ["packages/core/src/workers/task-report.ts", "package.json"],
    allowedFiles: ["packages/core/src/workers/**"],
    secretFindings: [],
    verificationPassed: true,
    attemptedForbiddenActions: ["git_commit"],
  });
  assert.equal(rejected.accepted, false);
  assert.deepEqual(rejected.outOfScopeFiles, ["package.json"]);
  assert.deepEqual(rejected.forbiddenActionsAttempted, ["git_commit"]);
});
