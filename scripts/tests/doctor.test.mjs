import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { detectCompanionPlugins } from "../../hooks/session-start.mjs";
import { runDoctor } from "../doctor.mjs";
import { REPO_ROOT } from "../validate.mjs";

const makeTempDir = (prefix = "gh-conv-doctor-") =>
  fs.mkdtempSync(path.join(os.tmpdir(), prefix));

test("detectCompanionPlugins detects dev-principles in Antigravity plugin/skill paths", () => {
  const projDir = makeTempDir("gh-conv-agy-proj-");
  const homeDir = makeTempDir("gh-conv-agy-home-");
  try {
    // Global Antigravity plugin path: ~/.gemini/config/plugins/dev-principles/.antigravity-plugin/plugin.json
    const agyGlobalPlugin = path.join(
      homeDir,
      ".gemini",
      "config",
      "plugins",
      "dev-principles",
      ".antigravity-plugin",
    );
    fs.mkdirSync(agyGlobalPlugin, { recursive: true });
    fs.writeFileSync(path.join(agyGlobalPlugin, "plugin.json"), '{"name":"dev-principles"}\n');
    assert.deepEqual(
      detectCompanionPlugins({ cwd: projDir, gitRoot: projDir, homeDir }),
      ["dev-principles"],
    );

    // Project Antigravity plugin path: <proj>/.agents/plugins/dev-principles/skills/dev-principles/SKILL.md
    const agyProjSkill = path.join(
      projDir,
      ".agents",
      "plugins",
      "dev-principles",
      "skills",
      "dev-principles",
    );
    fs.mkdirSync(agyProjSkill, { recursive: true });
    fs.writeFileSync(path.join(agyProjSkill, "SKILL.md"), "# dev-principles\n");
    assert.deepEqual(
      detectCompanionPlugins({ cwd: projDir, gitRoot: projDir, homeDir: null }),
      ["dev-principles"],
    );
  } finally {
    fs.rmSync(projDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test("runDoctor inspects repo conventions, hooks, companion status, and manifest integrity", () => {
  const tempDir = makeTempDir("gh-conv-doc-");
  const skillsTarget = path.join(tempDir, ".agents", "skills");
  try {
    fs.mkdirSync(path.join(tempDir, ".git"), { recursive: true });
    fs.mkdirSync(skillsTarget, { recursive: true });

    // 1. Valid manifest with existing entry
    const skillDest = path.join(skillsTarget, "using-github-convention");
    fs.mkdirSync(skillDest, { recursive: true });
    fs.writeFileSync(
      path.join(skillsTarget, ".github-convention-install-manifest"),
      `schema_version=1\nplugin=github-convention\nentry|using-github-convention|copy|${skillDest}|src\n`,
    );

    const okReport = runDoctor({
      cwd: tempDir,
      env: {},
      pluginRoot: REPO_ROOT,
      homeDir: null,
      target: skillsTarget,
    });
    assert.equal(okReport.ok, true);
    assert.equal(okReport.hooks.claudeHooksJson, true);
    assert.equal(okReport.hooks.antigravityHooksJson, true);
    assert.equal(okReport.installManifests[0].status, "ok");

    // 2. Missing entry detected
    fs.rmSync(skillDest, { recursive: true, force: true });
    const missingReport = runDoctor({
      cwd: tempDir,
      env: {},
      pluginRoot: REPO_ROOT,
      homeDir: null,
      target: skillsTarget,
    });
    assert.equal(missingReport.installManifests[0].status, "missing_entries");
    assert.deepEqual(missingReport.installManifests[0].missingEntries, ["using-github-convention"]);

    // 3. CLI --json output
    const cliRes = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, "scripts", "doctor.mjs"), "--cwd", REPO_ROOT, "--json"],
      { encoding: "utf8" },
    );
    assert.equal(cliRes.status, 0);
    const parsed = JSON.parse(cliRes.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.conventions.prTemplate, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
