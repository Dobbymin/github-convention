import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import {
  computeDirectoryManifest,
  loadManifest,
  saveManifest,
  type InstallManifest,
} from "@dobbymin/github-convention-core";
import { executeUninstall, planUninstall } from "./index.js";

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
