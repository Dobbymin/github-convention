import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyCiFailure,
  classifyReviewComment,
  evaluateCiRetry,
  evaluateThreadResolution,
} from "./index.js";

describe("classifyReviewComment", () => {
  it("classifies naming, style, exception, and test comments as straightforward", () => {
    const naming = classifyReviewComment({ body: "Please rename this variable to userId." });
    assert.equal(naming.category, "naming");
    assert.equal(naming.kind, "straightforward");
    assert.equal(naming.requiresApproval, false);

    const style = classifyReviewComment({ body: "Fix ESLint formatting and import order." });
    assert.equal(style.category, "style");
    assert.equal(style.requiresApproval, false);

    const exception = classifyReviewComment({
      body: "Add a null check guard for this edge case.",
    });
    assert.equal(exception.category, "exception");
    assert.equal(exception.requiresApproval, false);

    const test = classifyReviewComment({ body: "Add a unit test case for empty input." });
    assert.equal(test.category, "test");
    assert.equal(test.requiresApproval, false);
  });

  it("classifies architecture, business_logic, and requirements as approval_required", () => {
    const arch = classifyReviewComment({
      body: "Extract service layer to respect module boundaries and architecture.",
    });
    assert.equal(arch.category, "architecture");
    assert.equal(arch.kind, "approval_required");
    assert.equal(arch.requiresApproval, true);

    const logic = classifyReviewComment({
      body: "This changes the billing business logic for expired subscriptions.",
    });
    assert.equal(logic.category, "business_logic");
    assert.equal(logic.requiresApproval, true);

    const req = classifyReviewComment({
      body: "Wait, this does not match the product requirements or acceptance criteria.",
    });
    assert.equal(req.category, "requirements");
    assert.equal(req.requiresApproval, true);
  });

  it("prioritizes approval_required over straightforward signals and treats ambiguous comments safely", () => {
    const mixed = classifyReviewComment({
      body: "Rename this helper and change the architecture to a separate package.",
    });
    assert.equal(mixed.kind, "approval_required");
    assert.equal(mixed.requiresApproval, true);

    const ambiguous = classifyReviewComment({ body: "Not sure about this part, thoughts?" });
    assert.equal(ambiguous.category, "ambiguous");
    assert.equal(ambiguous.requiresApproval, true);
  });
});

describe("evaluateThreadResolution", () => {
  it("resolves only addressed and verified straightforward threads", () => {
    const straightforward = classifyReviewComment({ body: "Fix typo in error message." });

    const resolved = evaluateThreadResolution({
      threadId: "t-1",
      classification: straightforward,
      addressed: true,
      verified: true,
    });
    assert.equal(resolved.resolve, true);

    const unverified = evaluateThreadResolution({
      threadId: "t-2",
      classification: straightforward,
      addressed: true,
      verified: false,
    });
    assert.equal(unverified.resolve, false);

    const unaddressed = evaluateThreadResolution({
      threadId: "t-3",
      classification: straightforward,
      addressed: false,
      verified: true,
    });
    assert.equal(unaddressed.resolve, false);

    const alreadyResolved = evaluateThreadResolution({
      threadId: "t-4",
      classification: straightforward,
      addressed: true,
      verified: true,
      alreadyResolved: true,
    });
    assert.equal(alreadyResolved.resolve, false);
  });

  it("leaves approval-required and ambiguous threads open even if addressed and verified", () => {
    const design = classifyReviewComment({ body: "Should we change the architecture here?" });
    const decision = evaluateThreadResolution({
      threadId: "t-5",
      classification: design,
      addressed: true,
      verified: true,
    });
    assert.equal(decision.resolve, false);
  });
});

describe("classifyCiFailure and evaluateCiRetry", () => {
  it("caps code, lint, type, and test failures at 2 retries", () => {
    for (const sample of [
      { checkName: "lint", logExcerpt: "eslint found 2 errors" },
      { checkName: "typecheck", logExcerpt: "TS2322: Type string is not assignable to number" },
      { checkName: "test", logExcerpt: "AssertionError: expected 1 to equal 2" },
      { checkName: "build", logExcerpt: "Build failed with exit code 1" },
    ]) {
      const classification = classifyCiFailure(sample);
      assert.equal(classification.retryable, true);
      assert.equal(classification.maxRetries, 2);

      const firstRetry = evaluateCiRetry({ classification, retriesUsed: 0 });
      assert.equal(firstRetry.shouldRetry, true);
      assert.equal(firstRetry.nextAttempt, 1);

      const secondRetry = evaluateCiRetry({ classification, retriesUsed: 1 });
      assert.equal(secondRetry.shouldRetry, true);
      assert.equal(secondRetry.nextAttempt, 2);

      const capped = evaluateCiRetry({ classification, retriesUsed: 2 });
      assert.equal(capped.shouldRetry, false);
      assert.equal(capped.action, "stop_max_retries");
      assert.equal(capped.requiresUserInput, true);
    }
  });

  it("caps transient external/network failures at 3 retries", () => {
    const classification = classifyCiFailure({
      checkName: "npm-install",
      logExcerpt: "request failed with ETIMEDOUT",
    });
    assert.equal(classification.category, "transient_network");
    assert.equal(classification.maxRetries, 3);

    const thirdRetry = evaluateCiRetry({ classification, retriesUsed: 2 });
    assert.equal(thirdRetry.shouldRetry, true);
    assert.equal(thirdRetry.nextAttempt, 3);

    const capped = evaluateCiRetry({ classification, retriesUsed: 3 });
    assert.equal(capped.shouldRetry, false);
    assert.equal(capped.action, "stop_max_retries");
  });

  it("pauses immediately for permission, credentials, missing_secret, external_config, and infra_outage", () => {
    const cases = [
      { logExcerpt: "Error: Resource not accessible by integration (403 Forbidden)" },
      { logExcerpt: "401 Unauthorized: Bad credentials" },
      { logExcerpt: "Missing secret NPM_TOKEN" },
      { logExcerpt: "Blocked by branch protection external configuration" },
      { logExcerpt: "503 Service Unavailable: GitHub outage / no runner available" },
    ];

    for (const sample of cases) {
      const classification = classifyCiFailure(sample);
      assert.equal(classification.retryable, false);
      assert.equal(classification.maxRetries, 0);
      assert.equal(classification.requiresUserInput, true);

      const decision = evaluateCiRetry({ classification, retriesUsed: 0 });
      assert.equal(decision.shouldRetry, false);
      assert.equal(decision.action, "pause_for_user");
      assert.equal(decision.requiresUserInput, true);
    }
  });

  it("stops early on repeated identical failure", () => {
    const classification = classifyCiFailure({
      checkName: "test",
      logExcerpt: "AssertionError: expected true to equal false",
    });

    const repeated = evaluateCiRetry({
      classification,
      retriesUsed: 0,
      previousSignatures: [classification.signature],
    });
    assert.equal(repeated.shouldRetry, false);
    assert.equal(repeated.action, "stop_repeated_failure");
    assert.equal(repeated.requiresUserInput, true);
  });
});
