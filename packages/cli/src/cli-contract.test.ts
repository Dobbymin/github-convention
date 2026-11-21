import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCli } from "./runner.js";
import { ExitCodes, ErrorCodes, type IssuePlan } from "@dobbymin/github-convention-core";

const SAMPLE_PLAN: IssuePlan = {
  planId: "plan-contract-1",
  parent: {
    id: "EPIC-1",
    title: "Contract Epic",
    summary: "Summary",
    goals: ["Goal"],
    inScope: ["packages/cli"],
    outOfScope: ["docs"],
    acceptanceCriteria: ["Done"],
    type: "type:epic",
  },
  subIssues: [
    {
      id: "TASK-1",
      title: "Contract Task",
      summary: "Summary",
      acceptanceCriteria: ["Passes"],
      hardDependencies: [],
      allowedFiles: ["packages/cli/src/a.ts"],
      sharedContracts: [],
      assumptions: [],
      type: "type:feature",
    },
  ],
};

const createTempPlanProject = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ghc-cli-contract-"));
  const planPath = path.join(dir, ".github-convention", "state", "active", "plan.json");
  fs.mkdirSync(path.dirname(planPath), { recursive: true });
  fs.writeFileSync(planPath, JSON.stringify(SAMPLE_PLAN), "utf-8");
  return dir;
};

test("all documented command families parse and return stable envelopes", async () => {
  const planProjectDir = createTempPlanProject();
  try {
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
      ["plan", "validate", "--project", planProjectDir],
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
  } finally {
    fs.rmSync(planProjectDir, { recursive: true, force: true });
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
  const planProjectDir = createTempPlanProject();
  try {
    // plan apply without approval in non-interactive mode
    const res = await runCli(
      ["plan", "apply", "--non-interactive", "--project", planProjectDir, "--output", "json"],
      {
        stdout: () => {},
        stderr: () => {},
      },
    );

    assert.equal(res.exitCode, ExitCodes.APPROVAL_REQUIRED);
    assert.equal(res.envelope.status, "approval_required");
    assert.equal(res.envelope.success, false);
    assert.equal(res.envelope.errors[0]?.code, ErrorCodes.APPROVAL_REQUIRED);

    // --yes does NOT bypass protected approval
    const resWithYes = await runCli(
      [
        "plan",
        "apply",
        "--non-interactive",
        "--yes",
        "--project",
        planProjectDir,
        "--output",
        "json",
      ],
      {
        stdout: () => {},
        stderr: () => {},
      },
    );

    assert.equal(resWithYes.exitCode, ExitCodes.APPROVAL_REQUIRED);
    assert.equal(resWithYes.envelope.status, "approval_required");
    assert.equal(resWithYes.envelope.errors[0]?.code, ErrorCodes.APPROVAL_REQUIRED);
  } finally {
    fs.rmSync(planProjectDir, { recursive: true, force: true });
  }
});

test("missing plan.json causes plan validate and plan apply to fail with non-zero exit code", async () => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "ghc-cli-noplan-"));
  try {
    const valRes = await runCli(["plan", "validate", "--project", emptyDir, "--output", "json"], {
      stdout: () => {},
      stderr: () => {},
    });
    assert.equal(valRes.exitCode, ExitCodes.INVALID_ARGUMENTS);
    assert.equal(valRes.envelope.status, "failed");
    assert.equal(valRes.envelope.errors[0]?.code, ErrorCodes.CONFIG_INVALID);

    const applyRes = await runCli(["plan", "apply", "--project", emptyDir, "--output", "json"], {
      stdout: () => {},
      stderr: () => {},
    });
    assert.equal(applyRes.exitCode, ExitCodes.INVALID_ARGUMENTS);
    assert.equal(applyRes.envelope.status, "failed");
    assert.equal(applyRes.envelope.errors[0]?.code, ErrorCodes.CONFIG_INVALID);
  } finally {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
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
