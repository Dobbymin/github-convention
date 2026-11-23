import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { detectCompanionPlugins } from "../../hooks/session-start.mjs";
import { runDoctor } from "../doctor.mjs";
import { runInstaller } from "../install.mjs";
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

test("runDoctor inspects repo conventions, hooks, companion status, and deep manifest ownership integrity", () => {
  const tempDir = makeTempDir("gh-conv-doc-");
  const skillsTarget = path.join(tempDir, ".agents", "skills");
  try {
    fs.mkdirSync(path.join(tempDir, ".git"), { recursive: true });

    // 1. Valid copy install via runInstaller -> status "ok"
    runInstaller({ target: skillsTarget, mode: "copy" });

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
    assert.equal(okReport.installManifests[0].entries, 6);
    assert.deepEqual(okReport.installManifests[0].tamperedEntries, []);

    // 2. Tampered entry (unexpected user file added inside copy dir) -> status "tampered_entries"
    const skillDest = path.join(skillsTarget, "using-github-convention");
    const injectedFile = path.join(skillDest, "user-injected.txt");
    fs.writeFileSync(injectedFile, "tampered\n");
    const tamperedReport = runDoctor({
      cwd: tempDir,
      env: {},
      pluginRoot: REPO_ROOT,
      homeDir: null,
      target: skillsTarget,
    });
    assert.equal(tamperedReport.installManifests[0].status, "tampered_entries");
    assert.deepEqual(tamperedReport.installManifests[0].tamperedEntries, ["using-github-convention"]);
    fs.unlinkSync(injectedFile);

    // 3. Missing entry detected -> status "missing_entries"
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

    // 4. CLI --json output
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
