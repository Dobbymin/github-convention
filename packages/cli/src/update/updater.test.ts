import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import {
  computeDirectoryManifest,
  loadManifest,
  saveManifest,
  verifyManifestIntegrity,
  type InstallManifest,
} from "@dobbymin/github-convention-core";
import { executeUninstall } from "../uninstall/index.js";
import { executeUpdate, planUpdate } from "./index.js";

const SKILL = `---\nname: github-convention\ndescription: Test skill\n---\n\n# Skill\n`;

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ghc-update-"));
  const targetDir = path.join(root, ".agents", "skills", "github-convention");
  const sourceDir = path.join(root, "skills", "github-convention");
  fs.mkdirSync(targetDir, { recursive: true });
  fs.mkdirSync(sourceDir, { recursive: true });
  return { root, targetDir, sourceDir };
};

const write = (dir: string, relativePath: string, content: string) => {
  const target = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf-8");
};

const installFixture = (targetDir: string, files: Record<string, string>) => {
  for (const [relativePath, content] of Object.entries(files)) {
    write(targetDir, relativePath, content);
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

test("update: applies clean upstream changes and refreshes the manifest", () => {
  const { root, targetDir, sourceDir } = setup();
  installFixture(targetDir, { "SKILL.md": SKILL, "references/guide.md": "old guide" });
  write(sourceDir, "SKILL.md", SKILL.replace("# Skill", "# Skill v2"));
  write(sourceDir, "references/guide.md", "old guide");

  const plan = planUpdate({ targetDir, sourceSkillDir: sourceDir });
  assert.equal(plan.summary.update, 1);
  assert.equal(plan.summary.unchanged, 1);
  assert.equal(plan.conflicts.length, 0);

  const result = executeUpdate({ targetDir, sourceSkillDir: sourceDir });
  assert.equal(result.success, true);
  assert.match(fs.readFileSync(path.join(targetDir, "SKILL.md"), "utf-8"), /Skill v2/);

  const manifest = loadManifest(targetDir);
  assert.ok(manifest);
  assert.equal(verifyManifestIntegrity(targetDir, manifest).valid, true);

  fs.rmSync(root, { recursive: true, force: true });
});

test("update: preserves user edits when upstream is unchanged", () => {
  const { root, targetDir, sourceDir } = setup();
  installFixture(targetDir, { "SKILL.md": SKILL, "references/guide.md": "upstream guide" });
  write(sourceDir, "SKILL.md", SKILL);
  write(sourceDir, "references/guide.md", "upstream guide");
  write(targetDir, "references/guide.md", "my local notes");

  const plan = planUpdate({ targetDir, sourceSkillDir: sourceDir });
  assert.equal(plan.summary.preserve, 1);

  const result = executeUpdate({ targetDir, sourceSkillDir: sourceDir });
  assert.equal(result.success, true);
  assert.equal(
    fs.readFileSync(path.join(targetDir, "references/guide.md"), "utf-8"),
    "my local notes",
  );
  assert.equal(
    loadManifest(targetDir)?.files.some((file) => file.relativePath === "references/guide.md"),
    true,
  );

  fs.rmSync(root, { recursive: true, force: true });
});

test("update: conflicting overlapping edits are surfaced and never overwritten", () => {
  const { root, targetDir, sourceDir } = setup();
  installFixture(targetDir, { "SKILL.md": SKILL });
  write(sourceDir, "SKILL.md", SKILL.replace("# Skill", "# Remote"));
  write(targetDir, "SKILL.md", SKILL.replace("# Skill", "# Local"));

  const plan = planUpdate({ targetDir, sourceSkillDir: sourceDir });
  assert.equal(plan.summary.conflict, 1);

  const result = executeUpdate({ targetDir, sourceSkillDir: sourceDir });
  assert.equal(result.success, false);
  assert.match(result.error ?? "", /conflict/);
  assert.match(fs.readFileSync(path.join(targetDir, "SKILL.md"), "utf-8"), /# Local/);

  fs.rmSync(root, { recursive: true, force: true });
});

test("update: dry-run makes no filesystem changes", () => {
  const { root, targetDir, sourceDir } = setup();
  const manifest = installFixture(targetDir, { "SKILL.md": SKILL });
  write(sourceDir, "SKILL.md", SKILL.replace("# Skill", "# Changed"));
  const before = JSON.stringify(manifest);

  const result = executeUpdate({ targetDir, sourceSkillDir: sourceDir, dryRun: true });
  assert.equal(result.success, true);
  assert.equal(result.dryRun, true);
  assert.equal(fs.readFileSync(path.join(targetDir, "SKILL.md"), "utf-8"), SKILL);
  assert.equal(JSON.stringify(loadManifest(targetDir)), before);

  fs.rmSync(root, { recursive: true, force: true });
});

test("update: staging validation failure restores the previous installation", () => {
  const { root, targetDir, sourceDir } = setup();
  installFixture(targetDir, { "SKILL.md": SKILL, "references/guide.md": "guide" });
  write(sourceDir, "references/guide.md", "guide v2");

  const result = executeUpdate({ targetDir, sourceSkillDir: sourceDir });
  assert.equal(result.success, false);
  assert.equal(result.rolledBack, true);
  assert.equal(fs.existsSync(path.join(targetDir, "SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(targetDir, "references/guide.md")), true);
  assert.match(fs.readFileSync(path.join(targetDir, "references/guide.md"), "utf-8"), /^guide$/);

  fs.rmSync(root, { recursive: true, force: true });
});

test("update: incompatible Skill version is rejected before staging", () => {
  const { root, targetDir, sourceDir } = setup();
  installFixture(targetDir, { "SKILL.md": SKILL });
  write(sourceDir, "SKILL.md", SKILL);
  write(
    sourceDir,
    "package.json",
    JSON.stringify({ version: "0.2.0", githubConvention: { compatibleCli: "^0.1.0" } }),
  );

  assert.throws(() => planUpdate({ targetDir, sourceSkillDir: sourceDir }), /not compatible/i);

  fs.rmSync(root, { recursive: true, force: true });
});

test("update: incompatible compatibleCli range is rejected before staging", () => {
  const { root, targetDir, sourceDir } = setup();
  installFixture(targetDir, { "SKILL.md": SKILL });
  write(sourceDir, "SKILL.md", SKILL);
  write(
    sourceDir,
    "package.json",
    JSON.stringify({ version: "0.1.0", githubConvention: { compatibleCli: "^0.2.0" } }),
  );

  assert.throws(() => planUpdate({ targetDir, sourceSkillDir: sourceDir }), /not compatible/i);

  fs.rmSync(root, { recursive: true, force: true });
});

test("update: preserved user edits remain preserved on subsequent uninstall and unmanaged files stay unabsorbed", () => {
  const { root, targetDir, sourceDir } = setup();
  installFixture(targetDir, { "SKILL.md": SKILL, "references/guide.md": "upstream guide" });
  write(sourceDir, "SKILL.md", SKILL.replace("# Skill", "# Skill v2"));
  write(sourceDir, "references/guide.md", "upstream guide");
  write(targetDir, "references/guide.md", "my local notes");
  write(targetDir, "custom-note.md", "unmanaged user file");

  const updateResult = executeUpdate({ targetDir, sourceSkillDir: sourceDir });
  assert.equal(updateResult.success, true);

  const updatedManifest = loadManifest(targetDir);
  assert.ok(updatedManifest);
  assert.equal(
    updatedManifest.files.some((file) => file.relativePath === "custom-note.md"),
    false,
  );

  const uninstallResult = executeUninstall({ targetDir });
  assert.equal(uninstallResult.success, true);
  assert.equal(fs.existsSync(path.join(targetDir, "SKILL.md")), false);
  assert.equal(
    fs.readFileSync(path.join(targetDir, "references", "guide.md"), "utf-8"),
    "my local notes",
  );
  assert.equal(
    fs.readFileSync(path.join(targetDir, "custom-note.md"), "utf-8"),
    "unmanaged user file",
  );

  fs.rmSync(root, { recursive: true, force: true });
});
