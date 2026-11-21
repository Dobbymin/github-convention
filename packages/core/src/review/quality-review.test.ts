import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { detectProjectQualityTools, evaluateQualityGates } from "../quality/index.js";
import { classifySelfReviewFindings } from "./index.js";

test("detectProjectQualityTools: reuses existing tools and proposes missing scanner with approval", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ghc-qual-"));
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ scripts: { test: "node --test", lint: "eslint ." } }),
    "utf-8",
  );
  fs.mkdirSync(path.join(root, ".githooks"), { recursive: true });
  fs.writeFileSync(path.join(root, ".githooks", "pre-commit"), "#!/bin/sh\n", "utf-8");

  const detected = detectProjectQualityTools(root);
  assert.equal(detected.hasHooks, true);
  assert.equal(detected.scripts.lint, "eslint .");
  assert.equal(detected.installProposal?.requiresApproval, true);

  fs.rmSync(root, { recursive: true, force: true });
});

test("evaluateQualityGates & classifySelfReviewFindings: blocks PR on critical blocker or failed gate", () => {
  const review = classifySelfReviewFindings([
    { id: "R1", file: "src/a.ts", severity: "critical_blocker", summary: "Missing auth check" },
    { id: "R2", file: "src/b.ts", severity: "non_blocking_improvement", summary: "Extract helper" },
  ]);
  assert.equal(review.passed, false);
  assert.equal(review.blockers.length, 1);
  assert.equal(review.followUpProposals[0]?.requiresApproval, true);

  const gates = evaluateQualityGates({
    acceptanceCriteriaPassed: true,
    testsPassed: true,
    secretScanClean: true,
    selfReviewPassed: review.passed,
    rebasedOnLatestBase: true,
  });
  assert.equal(gates.passed, false);
  assert.deepEqual(gates.failedGates, ["self_review"]);
});
