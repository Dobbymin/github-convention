import assert from "node:assert/strict";
import test from "node:test";
import type { GhCommandRunner } from "../auth/types.js";
import { executeGatedRelease, type GatedReleaseProposal } from "./index.js";

const SAMPLE_PROPOSAL: GatedReleaseProposal = {
  proposedVersion: "1.3.0",
  tagName: "v1.3.0",
  releaseNotes: "# Release v1.3.0\n\n### Features\n\n- add release gate",
};

test("executeGatedRelease: non-interactive without explicitApproval returns approval_required with zero writes", async () => {
  const calls: Array<{ file: string; args: readonly string[] }> = [];
  const runner: GhCommandRunner = (file, args) => {
    calls.push({ file, args });
    return "";
  };

  const result = await executeGatedRelease(
    {
      proposal: SAMPLE_PROPOSAL,
      repo: "Dobbymin/github-convention",
      nonInteractive: true,
      explicitApproval: false,
    },
    runner,
  );

  assert.equal(result.status, "approval_required");
  assert.equal(result.executed, false);
  assert.equal(calls.length, 0);
  assert.match(result.reason ?? "", /Non-interactive mode blocked/);
});

test("executeGatedRelease: omits explicitApproval defaults to approval_required with zero writes", async () => {
  const calls: Array<{ file: string; args: readonly string[] }> = [];
  const runner: GhCommandRunner = (file, args) => {
    calls.push({ file, args });
    return "";
  };

  const result = await executeGatedRelease(
    {
      proposal: SAMPLE_PROPOSAL,
    },
    runner,
  );

  assert.equal(result.status, "approval_required");
  assert.equal(result.executed, false);
  assert.equal(calls.length, 0);
});

test("executeGatedRelease: dryRun previews planned commands without mutations", async () => {
  const calls: Array<{ file: string; args: readonly string[] }> = [];
  const runner: GhCommandRunner = (file, args) => {
    calls.push({ file, args });
    return "";
  };

  const result = await executeGatedRelease(
    {
      proposal: SAMPLE_PROPOSAL,
      repo: "Dobbymin/github-convention",
      dryRun: true,
      explicitApproval: true,
    },
    runner,
  );

  assert.equal(result.status, "dry_run");
  assert.equal(result.executed, false);
  assert.equal(calls.length, 0);
  assert.equal(result.plannedCommands.length, 3);
  assert.deepEqual(result.plannedCommands[0], {
    file: "git",
    args: ["tag", "-a", "v1.3.0", "-m", "Release v1.3.0"],
  });
  assert.deepEqual(result.plannedCommands[1], {
    file: "git",
    args: ["push", "origin", "v1.3.0"],
  });
  assert.equal(result.plannedCommands[2]?.file, "gh");
  assert.equal(result.plannedCommands[2]?.args[0], "release");
  assert.equal(result.plannedCommands[2]?.args[1], "create");
});

test("executeGatedRelease: executes tag and GitHub release via GhCommandRunner when explicitly approved", async () => {
  const calls: Array<{ file: string; args: readonly string[] }> = [];
  const runner: GhCommandRunner = (file, args) => {
    calls.push({ file, args });
    if (file === "gh") {
      return "https://github.com/Dobbymin/github-convention/releases/tag/v1.3.0\n";
    }
    return "";
  };

  const result = await executeGatedRelease(
    {
      proposal: SAMPLE_PROPOSAL,
      repo: "Dobbymin/github-convention",
      target: "main",
      explicitApproval: true,
      nonInteractive: true,
    },
    runner,
  );

  assert.equal(result.status, "released");
  assert.equal(result.executed, true);
  assert.equal(result.tagName, "v1.3.0");
  assert.equal(result.version, "1.3.0");
  assert.equal(
    result.releaseUrl,
    "https://github.com/Dobbymin/github-convention/releases/tag/v1.3.0",
  );
  assert.equal(calls.length, 3);
  assert.equal(calls[0]?.file, "git");
  assert.equal(calls[1]?.file, "git");
  assert.equal(calls[2]?.file, "gh");
});
