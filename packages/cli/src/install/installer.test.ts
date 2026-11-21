import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import {
  ErrorCodes,
  ExitCodes,
  loadManifest,
  verifyManifestIntegrity,
} from "@github-convention/core";
import { runCli } from "../runner.js";
import { executeInstall } from "./index.js";

test("installer: establishes single canonical project skill at .agents/skills/github-convention", () => {
  const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), "inst-test-proj-"));
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "inst-test-home-"));

  // Create a template source skill
  const templateDir = path.join(tmpProject, "skills", "github-convention");
  fs.mkdirSync(templateDir, { recursive: true });
  fs.writeFileSync(path.join(templateDir, "SKILL.md"), "# Canonical Test Skill\n", "utf-8");

  const result = executeInstall({
    targets: [{ agentId: "codex", scope: "project" }],
    projectRoot: tmpProject,
    homeDir: tmpHome,
    sourceSkillDir: templateDir,
  });

  assert.equal(result.success, true);
  const expectedCanonical = path.join(tmpProject, ".agents", "skills", "github-convention");
  assert.equal(result.canonicalSourcePath, expectedCanonical);
  assert.equal(fs.existsSync(expectedCanonical), true);
  assert.equal(fs.existsSync(path.join(expectedCanonical, "SKILL.md")), true);

  fs.rmSync(tmpProject, { recursive: true, force: true });
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test("installer: supports independent Global/Project/Both scope selection per Agent (FR-CLI-05)", () => {
  const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), "inst-test-proj-"));
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "inst-test-home-"));

  const templateDir = path.join(tmpProject, "skills", "github-convention");
  fs.mkdirSync(templateDir, { recursive: true });
  fs.writeFileSync(path.join(templateDir, "SKILL.md"), "# Canonical Skill Content\n", "utf-8");

  const result = executeInstall({
    targets: [
      { agentId: "codex", scope: "project" },
      { agentId: "gemini-cli", scope: "global" },
      { agentId: "claude-code", scope: "both" },
    ],
    projectRoot: tmpProject,
    homeDir: tmpHome,
    sourceSkillDir: templateDir,
  });

  assert.equal(result.success, true);
  // codex (project) + gemini-cli (global) + claude-code (project + global) = 4 items
  assert.equal(result.items.length, 4);

  // Unselected agent (e.g. opencode, kilo, antigravity) directories remain untouched
  const opencodeDir = path.join(tmpProject, ".opencode");
  assert.equal(fs.existsSync(opencodeDir), false);

  fs.rmSync(tmpProject, { recursive: true, force: true });
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test("installer: creates symlinks where supported and managed copies with hash manifest on fallback (FR-CLI-07)", () => {
  const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), "inst-test-proj-"));
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "inst-test-home-"));

  const templateDir = path.join(tmpProject, "skills", "github-convention");
  fs.mkdirSync(templateDir, { recursive: true });
  fs.writeFileSync(path.join(templateDir, "SKILL.md"), "# Canonical Skill\n", "utf-8");

  // Test with forceCopy = true (simulating symlink unsupported environment)
  const result = executeInstall({
    targets: [{ agentId: "claude-code", scope: "project" }],
    projectRoot: tmpProject,
    homeDir: tmpHome,
    sourceSkillDir: templateDir,
    forceCopy: true,
  });

  assert.equal(result.success, true);
  const claudeProjectSkill = path.join(tmpProject, ".claude", "skills", "github-convention");
  assert.equal(fs.existsSync(claudeProjectSkill), true);
  assert.equal(result.items[0].installType, "copy");

  // Manifest must exist in the fallback copy and match hashes
  const manifest = loadManifest(claudeProjectSkill);
  assert.ok(manifest);
  assert.equal(manifest.installType, "copy");
  assert.equal(manifest.agentId, "claude-code");
  assert.ok(manifest.files.some((f) => f.relativePath === "SKILL.md"));

  const integrity = verifyManifestIntegrity(claudeProjectSkill, manifest);
  assert.equal(integrity.valid, true);

  fs.rmSync(tmpProject, { recursive: true, force: true });
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test("installer: dry-run performs inspection only and leaves no files on disk (FR-CLI-11)", () => {
  const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), "inst-dry-proj-"));
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "inst-dry-home-"));

  const result = executeInstall({
    targets: [{ agentId: "claude-code", scope: "project" }],
    projectRoot: tmpProject,
    homeDir: tmpHome,
    dryRun: true,
  });

  assert.equal(result.success, true);
  assert.equal(result.items.length, 1);
  assert.equal(fs.existsSync(path.join(tmpProject, ".claude")), false);
  assert.equal(fs.existsSync(path.join(tmpProject, ".agents")), false);

  fs.rmSync(tmpProject, { recursive: true, force: true });
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test("CLI install command executes real install, preserves dry-run, and rejects unknown agent", async () => {
  const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), "cli-inst-proj-"));
  const templateDir = path.join(tmpProject, "skills", "github-convention");
  fs.mkdirSync(templateDir, { recursive: true });
  fs.writeFileSync(path.join(templateDir, "SKILL.md"), "# CLI Install Skill\n", "utf-8");

  const dryRes = await runCli(
    [
      "install",
      "--agent",
      "codex",
      "--scope",
      "project",
      "--project",
      tmpProject,
      "--dry-run",
      "--output",
      "json",
    ],
    { stdout: () => {}, stderr: () => {} },
  );
  assert.equal(dryRes.exitCode, ExitCodes.SUCCESS);
  assert.equal(
    fs.existsSync(
      path.join(tmpProject, ".agents", "skills", "github-convention", ".manifest.json"),
    ),
    false,
  );

  const realRes = await runCli(
    [
      "install",
      "--agent",
      "codex",
      "--scope",
      "project",
      "--project",
      tmpProject,
      "--output",
      "json",
    ],
    { stdout: () => {}, stderr: () => {} },
  );
  assert.equal(realRes.exitCode, ExitCodes.SUCCESS);
  const parsed = JSON.parse(realRes.stdoutText) as {
    data: { installed: boolean; agents: string[]; items: Array<{ agentId: string }> };
  };
  assert.equal(parsed.data.installed, true);
  assert.deepEqual(parsed.data.agents, ["codex"]);
  assert.equal(parsed.data.items.length, 1);
  assert.equal(
    fs.existsSync(
      path.join(tmpProject, ".agents", "skills", "github-convention", ".manifest.json"),
    ),
    true,
  );

  const invalidRes = await runCli(
    ["install", "--agent", "unknown-agent", "--project", tmpProject, "--output", "json"],
    { stdout: () => {}, stderr: () => {} },
  );
  assert.equal(invalidRes.exitCode, ExitCodes.INVALID_ARGUMENTS);
  assert.equal(invalidRes.envelope.errors[0]?.code, ErrorCodes.INVALID_ARGUMENTS);

  fs.rmSync(tmpProject, { recursive: true, force: true });
});

test("CLI install resolves bundled canonical skill for external projects so validate passes", async () => {
  const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), "cli-ext-proj-"));

  const initRes = await runCli(["init", "--project", tmpProject, "--output", "json"], {
    stdout: () => {},
    stderr: () => {},
  });
  assert.equal(initRes.exitCode, ExitCodes.SUCCESS);

  const installRes = await runCli(
    [
      "install",
      "--agent",
      "codex",
      "--scope",
      "project",
      "--project",
      tmpProject,
      "--output",
      "json",
    ],
    { stdout: () => {}, stderr: () => {} },
  );
  assert.equal(installRes.exitCode, ExitCodes.SUCCESS);
  assert.equal(
    fs.existsSync(path.join(tmpProject, ".agents", "skills", "github-convention", "references")),
    true,
  );

  const validateRes = await runCli(["validate", "--project", tmpProject, "--output", "json"], {
    stdout: () => {},
    stderr: () => {},
  });
  assert.equal(validateRes.exitCode, ExitCodes.SUCCESS);
  assert.equal((validateRes.envelope.data as { valid: boolean }).valid, true);

  fs.rmSync(tmpProject, { recursive: true, force: true });
});

test("installer: global-only install does not create .agents inside projectRoot", () => {
  const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), "inst-glob-proj-"));
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "inst-glob-home-"));

  const result = executeInstall({
    targets: [{ agentId: "codex", scope: "global" }],
    projectRoot: tmpProject,
    homeDir: tmpHome,
  });

  assert.equal(result.success, true);
  assert.equal(fs.existsSync(path.join(tmpProject, ".agents")), false);
  const globalSkill = path.join(tmpHome, ".agents", "skills", "github-convention");
  assert.equal(fs.existsSync(path.join(globalSkill, "SKILL.md")), true);
  assert.ok(loadManifest(globalSkill));

  fs.rmSync(tmpProject, { recursive: true, force: true });
  fs.rmSync(tmpHome, { recursive: true, force: true });
});
