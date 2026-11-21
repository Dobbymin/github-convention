import test from "node:test";
import assert from "node:assert/strict";
import { createOutputEnvelope, ExitCodes, ErrorCodes } from "./index.js";

test("creates default completed envelope", () => {
  const env = createOutputEnvelope({ command: "status", data: { healthy: true } });
  assert.equal(env.schemaVersion, 1);
  assert.equal(env.command, "status");
  assert.equal(env.status, "completed");
  assert.equal(env.success, true);
  assert.deepEqual(env.data, { healthy: true });
  assert.deepEqual(env.warnings, []);
  assert.deepEqual(env.errors, []);
});

test("creates approval_required envelope", () => {
  const env = createOutputEnvelope({
    command: "plan apply",
    status: "approval_required",
    data: { approvalId: "approval-1", summary: "Create 3 Issues" },
    errors: [
      {
        code: ErrorCodes.APPROVAL_REQUIRED,
        message: "Explicit user approval is required.",
      },
    ],
  });
  assert.equal(env.schemaVersion, 1);
  assert.equal(env.status, "approval_required");
  assert.equal(env.success, false);
  assert.equal(env.errors[0]?.code, "APPROVAL_REQUIRED");
});

test("creates failed envelope with errors", () => {
  const env = createOutputEnvelope({
    command: "validate",
    errors: [
      {
        code: ErrorCodes.CONFIG_INVALID,
        message: "Invalid configuration file",
      },
    ],
  });
  assert.equal(env.schemaVersion, 1);
  assert.equal(env.status, "failed");
  assert.equal(env.success, false);
  assert.equal(env.errors.length, 1);
});

test("exit codes map correctly", () => {
  assert.equal(ExitCodes.SUCCESS, 0);
  assert.equal(ExitCodes.GENERAL_FAILURE, 1);
  assert.equal(ExitCodes.INVALID_ARGUMENTS, 2);
  assert.equal(ExitCodes.APPROVAL_REQUIRED, 3);
  assert.equal(ExitCodes.AUTH_FAILURE, 4);
  assert.equal(ExitCodes.INTEGRITY_CONFLICT, 5);
  assert.equal(ExitCodes.LOCK_BUSY, 6);
  assert.equal(ExitCodes.DEPENDENCY_UNAVAILABLE, 7);
});
