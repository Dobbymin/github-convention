import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import {
  ExitCodes,
  computeDirectoryManifest,
  loadManifest,
  saveManifest,
  type InstallManifest,
} from "@dobbymin/github-convention-core";
import { executeInstall } from "../install/index.js";
import { runCli } from "../runner.js";
import {
  executeMultiUninstall,
  executeUninstall,
  planUninstall,
  resolveUninstallTargets,
} from "./index.js";

const SKILL = `---\nname: github-convention\ndescription: Test skill\n---\n\n# Skill\n`;

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ghc-uninstall-"));
  const targetDir = path.join(root, ".agents", "skills", "github-convention");
  fs.mkdirSync(targetDir, { recursive: true });
  return { root, targetDir };
};

const installFixture = (targetDir: string, files: Record<string, string>) => {
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(targetDir, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf-8");
  }
  const manifest: InstallManifest = {
    schemaVersion: 1,
    skillName: "github-convention",
    skillVersion: "0.1.0",
    installedAt: new Date().toISOString(),
    agentId: "codex",
    scope: "project",
    targetPath: targetDir,
    installType: "copy",
    files: computeDirectoryManifest(targetDir),
  };
  saveManifest(targetDir, manifest);
  return manifest;
};

test("uninstall: removes only unchanged managed files and reports retained user edits", () => {
  const { root, targetDir } = setup();
  installFixture(targetDir, { "SKILL.md": SKILL, "references/guide.md": "guide" });
  fs.writeFileSync(path.join(targetDir, "references", "guide.md"), "my edits", "utf-8");

  const plan = planUninstall({ targetDir });
  assert.equal(plan.summary.remove, 1);
  assert.equal(plan.summary.preserve, 1);

  const result = executeUninstall({ targetDir });
  assert.equal(result.success, true);
  assert.equal(fs.existsSync(path.join(targetDir, "SKILL.md")), false);
  assert.equal(
    fs.readFileSync(path.join(targetDir, "references", "guide.md"), "utf-8"),
    "my edits",
  );
  assert.equal(fs.existsSync(path.join(targetDir, ".manifest.json")), false);
  assert.equal(result.directoryRemoved, false);
  assert.equal(result.retainedPath, targetDir);

  fs.rmSync(root, { recursive: true, force: true });
});

test("uninstall: removes the directory when every managed file is unchanged", () => {
  const { root, targetDir } = setup();
  installFixture(targetDir, { "SKILL.md": SKILL, "references/guide.md": "guide" });

  const result = executeUninstall({ targetDir });
  assert.equal(result.success, true);
  assert.equal(result.directoryRemoved, true);
  assert.equal(fs.existsSync(targetDir), false);

  fs.rmSync(root, { recursive: true, force: true });
});

test("uninstall: dry-run leaves every file and the manifest intact", () => {
  const { root, targetDir } = setup();
  installFixture(targetDir, { "SKILL.md": SKILL });
  const before = fs.readFileSync(path.join(targetDir, ".manifest.json"), "utf-8");

  const result = executeUninstall({ targetDir, dryRun: true });
  assert.equal(result.success, true);
  assert.equal(fs.existsSync(path.join(targetDir, "SKILL.md")), true);
  assert.equal(fs.readFileSync(path.join(targetDir, ".manifest.json"), "utf-8"), before);

  fs.rmSync(root, { recursive: true, force: true });
});

test("uninstall: unlinks a managed symlink without touching its target", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ghc-uninstall-link-"));
  const canonical = path.join(root, "canonical");
  const link = path.join(root, ".agents", "skills", "github-convention");
  fs.mkdirSync(canonical, { recursive: true });
  fs.writeFileSync(path.join(canonical, "SKILL.md"), SKILL, "utf-8");
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(canonical, link, process.platform === "win32" ? "junction" : "dir");

  const result = executeUninstall({ targetDir: link });
  assert.equal(result.success, true);
  assert.equal(fs.existsSync(link), false);
  assert.equal(fs.existsSync(path.join(canonical, "SKILL.md")), true);

  fs.rmSync(root, { recursive: true, force: true });
});

test("uninstall: leaves unmanaged directories and traversal records untouched", () => {
  const { root, targetDir } = setup();
  const outside = path.join(root, "outside.txt");
  fs.writeFileSync(outside, "keep me", "utf-8");
  const manifest: InstallManifest = {
    schemaVersion: 1,
    skillName: "github-convention",
    skillVersion: "0.1.0",
    installedAt: new Date().toISOString(),
    agentId: "codex",
    scope: "project",
    targetPath: targetDir,
    installType: "copy",
    files: [{ relativePath: "../outside.txt", sha256: "0".repeat(64), size: 7 }],
  };
  saveManifest(targetDir, manifest);

  const plan = planUninstall({ targetDir });
  assert.equal(plan.summary.unowned, 1);

  const result = executeUninstall({ targetDir });
  assert.equal(result.success, true);
  assert.equal(fs.readFileSync(outside, "utf-8"), "keep me");

  fs.rmSync(root, { recursive: true, force: true });
});

test("uninstall: no-op for a directory without an install manifest", () => {
  const { root, targetDir } = setup();
  fs.writeFileSync(path.join(targetDir, "mine.md"), "user file", "utf-8");

  const result = executeUninstall({ targetDir });
  assert.equal(result.success, true);
  assert.equal(fs.readFileSync(path.join(targetDir, "mine.md"), "utf-8"), "user file");
  assert.equal(loadManifest(targetDir), null);

  fs.rmSync(root, { recursive: true, force: true });
});

test("executeMultiUninstall: orders symlinks before canonical, supports dry-run and both scopes, and preserves modified files", (t) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ghc-multi-uninst-proj-"));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ghc-multi-uninst-home-"));
  const sourceDir = path.join(projectRoot, "skills", "github-convention");
  t.after(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, "SKILL.md"), SKILL, "utf-8");
  fs.writeFileSync(path.join(sourceDir, "notes.md"), "original\n", "utf-8");

  const installRes = executeInstall({
    targets: [
      { agentId: "codex", scope: "both" },
      { agentId: "claude-code", scope: "both" },
    ],
    projectRoot,
    homeDir,
    sourceSkillDir: sourceDir,
  });
  assert.equal(installRes.success, true);

  const canonicalPath = path.join(projectRoot, ".agents", "skills", "github-convention");
  const claudeProjectPath = path.join(projectRoot, ".claude", "skills", "github-convention");
  const claudeGlobalPath = path.join(homeDir, ".claude", "skills", "github-convention");

  // Modify a file in global claude-code so it is preserved
  fs.writeFileSync(path.join(claudeGlobalPath, "notes.md"), "user edited\n", "utf-8");

  const ordered = resolveUninstallTargets({ projectRoot, homeDir, scope: "both" }).map((p) =>
    path.resolve(p),
  );
  const canonicalIdx = ordered.indexOf(path.resolve(canonicalPath));
  const claudeProjectIdx = ordered.indexOf(path.resolve(claudeProjectPath));
  assert.ok(canonicalIdx !== -1);
  assert.ok(claudeProjectIdx !== -1);
  assert.ok(claudeProjectIdx < canonicalIdx);

  const dryRes = executeMultiUninstall({
    projectRoot,
    homeDir,
    scope: "both",
    dryRun: true,
  });
  assert.equal(dryRes.success, true);
  assert.equal(dryRes.dryRun, true);
  assert.equal(fs.existsSync(canonicalPath), true);

  const realRes = executeMultiUninstall({
    projectRoot,
    homeDir,
    scope: "both",
  });
  assert.equal(realRes.success, true);
  assert.equal(fs.existsSync(canonicalPath), false);
  assert.equal(fs.existsSync(claudeProjectPath), false);
  assert.equal(fs.readFileSync(path.join(claudeGlobalPath, "notes.md"), "utf-8"), "user edited\n");
});

test("CLI uninstall: supports --agent and --scope and rejects unknown --agent", async (t) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ghc-cli-uninst-"));
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

  const invalidRes = await runCli(
    ["uninstall", "--agent", "bad-agent", "--project", projectRoot, "--output", "json"],
    { stdout: () => {}, stderr: () => {} },
  );
  assert.equal(invalidRes.exitCode, ExitCodes.INVALID_ARGUMENTS);

  const dryRes = await runCli(
    [
      "uninstall",
      "--agent",
      "codex",
      "--scope",
      "project",
      "--project",
      projectRoot,
      "--dry-run",
      "--output",
      "json",
    ],
    { stdout: () => {}, stderr: () => {} },
  );
  assert.equal(dryRes.exitCode, ExitCodes.SUCCESS);
  const data = dryRes.envelope.data as { targetDir: string; targets: unknown[] };
  assert.equal(
    path.resolve(data.targetDir),
    path.resolve(path.join(projectRoot, ".agents", "skills", "github-convention")),
  );
  assert.equal(data.targets.length, 1);
});
