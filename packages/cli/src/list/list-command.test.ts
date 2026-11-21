import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { ErrorCodes, ExitCodes } from "@dobbymin/github-convention-core";
import { executeInstall } from "../install/index.js";
import { runCli } from "../runner.js";
import { runList } from "./index.js";

const createTempDir = (): string =>
  fs.mkdtempSync(path.join(os.tmpdir(), "github-convention-list-"));

test("runList reports zero installed agents on empty project", () => {
  const tmpRoot = createTempDir();
  const fakeHome = path.join(tmpRoot, "home");
  const projectDir = path.join(tmpRoot, "project");
  fs.mkdirSync(fakeHome, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });

  const result = runList({ projectRoot: projectDir, homeDir: fakeHome });
  assert.equal(result.project, projectDir);
  assert.equal(result.agents.length, 7);
  assert.equal(result.installedCount, 0);
});

test("runList reports installed project skill and manifest metadata after install", () => {
  const tmpRoot = createTempDir();
  const fakeHome = path.join(tmpRoot, "home");
  const projectDir = path.join(tmpRoot, "project");
  const sourceSkillDir = path.join(tmpRoot, "source-skill");
  fs.mkdirSync(fakeHome, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(sourceSkillDir, { recursive: true });
  fs.writeFileSync(path.join(sourceSkillDir, "SKILL.md"), "# Skill\n", "utf-8");

  const installResult = executeInstall({
    targets: [{ agentId: "codex", scope: "project" }],
    projectRoot: projectDir,
    homeDir: fakeHome,
    sourceSkillDir,
  });
  assert.equal(installResult.success, true);

  const listResult = runList({
    projectRoot: projectDir,
    homeDir: fakeHome,
    agents: ["codex"],
  });
  assert.equal(listResult.agents.length, 1);
  assert.equal(listResult.installedCount, 1);
  assert.equal(listResult.agents[0]?.project.installed, true);
  assert.equal(listResult.agents[0]?.project.skillVersion, "0.1.1");
  assert.equal(listResult.agents[0]?.project.installType, "canonical");
});

test("CLI list command rejects unknown --agent and emits valid JSON envelope", async () => {
  const tmpRoot = createTempDir();

  const invalidRes = await runCli(
    ["list", "--agent", "unknown-agent", "--project", tmpRoot, "--output", "json"],
    { stdout: () => {}, stderr: () => {} },
  );
  assert.equal(invalidRes.exitCode, ExitCodes.INVALID_ARGUMENTS);
  assert.equal(invalidRes.envelope.errors[0]?.code, ErrorCodes.INVALID_ARGUMENTS);

  const validRes = await runCli(
    ["list", "--agent", "codex", "--project", tmpRoot, "--output", "json"],
    { stdout: () => {}, stderr: () => {} },
  );
  assert.equal(validRes.exitCode, ExitCodes.SUCCESS);
  const parsed = JSON.parse(validRes.stdoutText) as {
    data: { project: string; agents: Array<{ agentId: string }>; installedCount: number };
  };
  assert.equal(parsed.data.project, tmpRoot);
  assert.equal(parsed.data.agents.length, 1);
  assert.equal(parsed.data.agents[0]?.agentId, "codex");
});
