import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { runCli } from "./runner.js";
import { ExitCodes, ErrorCodes } from "@dobbymin/github-convention-core";

test("all documented command families parse and return stable envelopes", async () => {
  const commands = [
    ["install", "--dry-run"],
    ["update", "--dry-run"],
    ["uninstall", "--dry-run"],
    ["list"],
    ["doctor"],
    ["init", "--dry-run"],
    ["validate"],
    ["status"],
    ["cleanup", "--dry-run"],
    ["plan", "validate"],
    ["plan", "apply", "--dry-run"],
    ["state", "list"],
    ["state", "show"],
    ["state", "restore", "--dry-run"],
  ];

  for (const cmd of commands) {
    const res = await runCli([...cmd, "--output", "json"], {
      stdout: () => {},
      stderr: () => {},
    });

    assert.equal(
      res.exitCode,
      ExitCodes.SUCCESS,
      `Command '${cmd.join(" ")}' failed with exit code ${res.exitCode}`,
    );
    assert.equal(res.envelope.schemaVersion, 1);
    assert.equal(res.envelope.status, "completed");
    assert.equal(res.envelope.success, true);
    assert.ok(Array.isArray(res.envelope.warnings));
    assert.ok(Array.isArray(res.envelope.errors));
    assert.equal(res.envelope.errors.length, 0);

    // Verify stdout is valid JSON
    const parsed = JSON.parse(res.stdoutText);
    assert.deepEqual(parsed, res.envelope);
  }
});

test("JSON mode emits valid JSON only on stdout for both success and error", async () => {
  // Success case
  const successRes = await runCli(["status", "--output", "json"], {
    stdout: () => {},
    stderr: () => {},
  });
  assert.equal(successRes.exitCode, ExitCodes.SUCCESS);
  const successJson = JSON.parse(successRes.stdoutText);
  assert.equal(successJson.schemaVersion, 1);
  assert.equal(successJson.status, "completed");

  // Error case (unknown command)
  const errorRes = await runCli(["non-existent-cmd", "--output", "json"], {
    stdout: () => {},
    stderr: () => {},
  });
  assert.equal(errorRes.exitCode, ExitCodes.INVALID_ARGUMENTS);
  const errorJson = JSON.parse(errorRes.stdoutText);
  assert.equal(errorJson.schemaVersion, 1);
  assert.equal(errorJson.status, "failed");
  assert.equal(errorJson.errors[0]?.code, ErrorCodes.INVALID_ARGUMENTS);
  assert.equal(errorRes.stderrText, "");
});

test("non-interactive mode never prompts or infers approval", async () => {
  // plan apply without approval in non-interactive mode
  const res = await runCli(["plan", "apply", "--non-interactive", "--output", "json"], {
    stdout: () => {},
    stderr: () => {},
  });

  assert.equal(res.exitCode, ExitCodes.APPROVAL_REQUIRED);
  assert.equal(res.envelope.status, "approval_required");
  assert.equal(res.envelope.success, false);
  assert.equal(res.envelope.errors[0]?.code, ErrorCodes.APPROVAL_REQUIRED);

  // --yes does NOT bypass protected approval
  const resWithYes = await runCli(
    ["plan", "apply", "--non-interactive", "--yes", "--output", "json"],
    {
      stdout: () => {},
      stderr: () => {},
    },
  );

  assert.equal(resWithYes.exitCode, ExitCodes.APPROVAL_REQUIRED);
  assert.equal(resWithYes.envelope.status, "approval_required");
  assert.equal(resWithYes.envelope.errors[0]?.code, ErrorCodes.APPROVAL_REQUIRED);
});

test("dry-run performs inspection only and creates no persistent changes", async () => {
  const mutatingCommands = [
    ["install", "--dry-run"],
    ["update", "--dry-run"],
    ["uninstall", "--dry-run"],
    ["init", "--dry-run"],
    ["cleanup", "--dry-run"],
    ["plan", "apply", "--dry-run"],
    ["state", "restore", "--dry-run"],
  ];

  const snapshotBefore = fs.readdirSync(process.cwd());

  for (const cmd of mutatingCommands) {
    const res = await runCli([...cmd, "--output", "json"], {
      stdout: () => {},
      stderr: () => {},
    });

    assert.equal(res.exitCode, ExitCodes.SUCCESS);
    assert.equal(res.envelope.status, "completed");
    assert.equal((res.envelope.data as Record<string, unknown>)?.dryRun, true);
  }

  const snapshotAfter = fs.readdirSync(process.cwd());
  assert.deepEqual(snapshotBefore, snapshotAfter, "Dry-run must not create or delete files");
});

test("common flags parsing and validation", async () => {
  // --agent parsing
  const agentRes = await runCli(
    ["install", "--agent", "codex,claude-code", "--dry-run", "--output", "json"],
    {
      stdout: () => {},
      stderr: () => {},
    },
  );
  assert.equal(agentRes.exitCode, ExitCodes.SUCCESS);
  const agentData = agentRes.envelope.data as Record<string, unknown>;
  assert.deepEqual(agentData.agents, ["codex", "claude-code"]);

  // --scope parsing & validation
  const scopeRes = await runCli(
    ["install", "--scope", "project", "--dry-run", "--output", "json"],
    {
      stdout: () => {},
      stderr: () => {},
    },
  );
  assert.equal(scopeRes.exitCode, ExitCodes.SUCCESS);

  const invalidScopeRes = await runCli(
    ["install", "--scope", "invalid-scope", "--output", "json"],
    {
      stdout: () => {},
      stderr: () => {},
    },
  );
  assert.equal(invalidScopeRes.exitCode, ExitCodes.INVALID_ARGUMENTS);
  assert.equal(invalidScopeRes.envelope.errors[0]?.code, ErrorCodes.INVALID_ARGUMENTS);

  // invalid output format
  const invalidOutputRes = await runCli(["status", "--output", "xml"], {
    stdout: () => {},
    stderr: () => {},
  });
  assert.equal(invalidOutputRes.exitCode, ExitCodes.INVALID_ARGUMENTS);
});

test("version and help options", async () => {
  const versionRes = await runCli(["--version"], {
    stdout: () => {},
    stderr: () => {},
  });
  assert.equal(versionRes.exitCode, ExitCodes.SUCCESS);
  assert.ok(versionRes.stdoutText.includes("github-convention"));

  const helpRes = await runCli(["--help"], {
    stdout: () => {},
    stderr: () => {},
  });
  assert.equal(helpRes.exitCode, ExitCodes.SUCCESS);
  assert.ok(helpRes.stdoutText.includes("Usage: github-convention"));
});
