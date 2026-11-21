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
  verifyManifestIntegrity,
  type InstallManifest,
} from "@dobbymin/github-convention-core";
import { executeInstall } from "../install/index.js";
import { runCli } from "../runner.js";
import { executeUninstall } from "../uninstall/index.js";
import { executeMultiUpdate, executeUpdate, planUpdate, resolveUpdateTargets } from "./index.js";

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

test("executeMultiUpdate: updates multiple agents across project/global/both scopes and preserves modified files", (t) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ghc-multi-upd-proj-"));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ghc-multi-upd-home-"));
  const sourceDir = path.join(projectRoot, "skills", "github-convention");
  t.after(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  write(sourceDir, "SKILL.md", SKILL);
  write(sourceDir, "references/guide.md", "guide v1\n");

  const installRes = executeInstall({
    targets: [
      { agentId: "codex", scope: "both" },
      { agentId: "claude-code", scope: "global" },
    ],
    projectRoot,
    homeDir,
    sourceSkillDir: sourceDir,
    forceCopy: true,
  });
  assert.equal(installRes.success, true);

  const claudeGlobal = path.join(homeDir, ".claude", "skills", "github-convention");
  const codexGlobal = path.join(homeDir, ".agents", "skills", "github-convention");
  const codexProject = path.join(projectRoot, ".agents", "skills", "github-convention");

  // User edits a managed file in claude-code global while upstream leaves it unchanged
  write(claudeGlobal, "references/guide.md", "user custom guide\n");
  write(sourceDir, "references/new-doc.md", "added in v2\n");

  const resolvedBoth = resolveUpdateTargets({
    projectRoot,
    homeDir,
    agents: ["codex", "claude-code"],
    scope: "both",
  }).map((p) => path.resolve(p));
  assert.ok(resolvedBoth.includes(path.resolve(codexProject)));
  assert.ok(resolvedBoth.includes(path.resolve(codexGlobal)));
  assert.ok(resolvedBoth.includes(path.resolve(claudeGlobal)));

  const dryRes = executeMultiUpdate({
    projectRoot,
    homeDir,
    agents: ["codex", "claude-code"],
    scope: "both",
    dryRun: true,
  });
  assert.equal(dryRes.success, true);
  assert.equal(dryRes.dryRun, true);
  assert.equal(fs.existsSync(path.join(codexGlobal, "references", "new-doc.md")), false);

  const realRes = executeMultiUpdate({
    projectRoot,
    homeDir,
    agents: ["codex", "claude-code"],
    scope: "both",
  });
  assert.equal(realRes.success, true);
  assert.ok(realRes.summary.add >= 3);
  assert.ok(realRes.summary.preserve >= 1);
  assert.equal(
    fs.readFileSync(path.join(claudeGlobal, "references", "guide.md"), "utf-8"),
    "user custom guide\n",
  );
  assert.equal(
    fs.readFileSync(path.join(codexGlobal, "references", "new-doc.md"), "utf-8"),
    "added in v2\n",
  );
  assert.equal(
    fs.readFileSync(path.join(codexProject, "references", "new-doc.md"), "utf-8"),
    "added in v2\n",
  );
});

test("CLI update: supports --agent and --scope and rejects unknown --agent", async (t) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ghc-cli-upd-"));
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

  const invalidRes = await runCli(
    ["update", "--agent", "nonexistent-agent", "--project", projectRoot, "--output", "json"],
    { stdout: () => {}, stderr: () => {} },
  );
  assert.equal(invalidRes.exitCode, ExitCodes.INVALID_ARGUMENTS);

  const dryRes = await runCli(
    [
      "update",
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
