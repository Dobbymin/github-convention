import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runInstaller, runUninstaller } from "../install.mjs";
import { REPO_ROOT } from "../validate.mjs";

const ALL_SKILLS = [
  "git-pr-workflow",
  "issue-planning",
  "parallel-execution",
  "release-and-recovery",
  "review-ci-loop",
  "using-github-convention",
];

const makeTempDir = (prefix = "gh-conv-xplat-") =>
  fs.mkdtempSync(path.join(os.tmpdir(), prefix));

const LINK_TYPE = process.platform === "win32" ? "junction" : "dir";

test("cross-platform installer manages symlink/junction, --copy, --dry-run, updates, and preserves dev-principles", () => {
  const tempDir = makeTempDir();
  const targetDir = path.join(tempDir, "skills");
  try {
    // 1. Dry-run creates nothing
    const dryRes = runInstaller({ target: targetDir, dryRun: true });
    assert.equal(dryRes.ok, true);
    assert.equal(dryRes.count, 6);
    assert.equal(fs.existsSync(targetDir), false);

    // 2. Co-installed dev-principles in same directory
    const dpDir = path.join(targetDir, "dev-principles");
    fs.mkdirSync(dpDir, { recursive: true });
    fs.writeFileSync(path.join(dpDir, "SKILL.md"), "# dev-principles\n");
    fs.writeFileSync(path.join(dpDir, ".dev-principles-script-managed"), "managed-by=install.sh\n");

    // 3. Symlink/junction install
    const linkRes = runInstaller({ target: targetDir, mode: "symlink" });
    assert.equal(linkRes.count, 6);
    for (const skill of ALL_SKILLS) {
      const dest = path.join(targetDir, skill);
      assert.equal(fs.lstatSync(dest).isSymbolicLink(), true);
      assert.equal(fs.existsSync(path.join(dest, "SKILL.md")), true);
    }
    const manifestPath = path.join(targetDir, ".github-convention-install-manifest");
    assert.match(fs.readFileSync(manifestPath, "utf8"), /plugin=github-convention/);

    // 4. Update symlink -> --copy
    const copyRes = runInstaller({ target: targetDir, mode: "copy" });
    assert.equal(copyRes.count, 6);
    for (const skill of ALL_SKILLS) {
      const dest = path.join(targetDir, skill);
      assert.equal(fs.lstatSync(dest).isSymbolicLink(), false);
      const marker = fs.readFileSync(path.join(dest, ".github-convention-script-managed"), "utf8");
      assert.match(marker, /plugin=github-convention/);
      assert.match(marker, new RegExp(`skill=${skill}`));
    }

    // 5. Uninstall removes only github-convention & manifest, preserves dev-principles
    const unDry = runUninstaller({ target: targetDir, dryRun: true });
    assert.equal(unDry.ok, true);
    assert.equal(fs.existsSync(manifestPath), true);

    runUninstaller({ target: targetDir });
    for (const skill of ALL_SKILLS) {
      assert.equal(fs.existsSync(path.join(targetDir, skill)), false);
    }
    assert.equal(fs.existsSync(manifestPath), false);
    assert.equal(fs.existsSync(path.join(dpDir, "SKILL.md")), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("cross-platform installer/uninstaller reject conflicts atomically and support legacy migration & scopes", () => {
  const tempDir = makeTempDir("gh-conv-xplat-conflict-");
  const targetDir = path.join(tempDir, "target");
  const foreignRoot = path.join(tempDir, "foreign-plugin", "skills");
  const projDir = path.join(tempDir, "project");
  const homeDir = path.join(tempDir, "home");

  try {
    fs.mkdirSync(targetDir, { recursive: true });
    fs.mkdirSync(path.join(foreignRoot, "using-github-convention"), { recursive: true });
    fs.writeFileSync(path.join(foreignRoot, "using-github-convention", "SKILL.md"), "# foreign\n");
    fs.mkdirSync(projDir, { recursive: true });
    fs.mkdirSync(homeDir, { recursive: true });

    // A. Foreign symlink/junction suffix trap refused atomically
    const conflictDest = path.join(targetDir, "using-github-convention");
    fs.symlinkSync(path.join(foreignRoot, "using-github-convention"), conflictDest, LINK_TYPE);
    assert.throws(() => runInstaller({ target: targetDir }), /unmanaged symlink/);
    assert.equal(fs.existsSync(path.join(targetDir, "git-pr-workflow")), false);
    assert.throws(() => runUninstaller({ target: targetDir }), /unmanaged symlink/);
    fs.rmSync(conflictDest, { recursive: true, force: true });

    // B. Regular file collision refused atomically
    fs.writeFileSync(conflictDest, "user file\n");
    assert.throws(() => runInstaller({ target: targetDir }), /non-directory file/);
    assert.equal(fs.readFileSync(conflictDest, "utf8"), "user file\n");
    fs.unlinkSync(conflictDest);

    // C. Foreign manifest refused
    const manifestPath = path.join(targetDir, ".github-convention-install-manifest");
    fs.writeFileSync(manifestPath, "plugin=other\n");
    assert.throws(() => runInstaller({ target: targetDir }), /unmanaged manifest/);
    assert.throws(() => runUninstaller({ target: targetDir }), /unmanaged manifest/);
    fs.unlinkSync(manifestPath);

    // D. Legacy marker migration (valid SKILL.md passes, mismatched refused)
    fs.mkdirSync(conflictDest, { recursive: true });
    fs.writeFileSync(path.join(conflictDest, ".github-convention-script-managed"), "managed-by=install.sh\n");
    fs.writeFileSync(path.join(conflictDest, "SKILL.md"), "---\nname: wrong-skill\n---\n");
    assert.throws(() => runUninstaller({ target: targetDir }), /unmanaged path/);

    fs.writeFileSync(path.join(conflictDest, "SKILL.md"), "---\nname: using-github-convention\n---\n");
    runUninstaller({ target: targetDir });
    assert.equal(fs.existsSync(conflictDest), false);

    // E. Project/Global scope isolation + CLI subprocess
    const cliInstall = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, "scripts", "install.mjs"), "--scope", "project", "--copy"],
      { cwd: projDir, env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir }, encoding: "utf8" },
    );
    assert.equal(cliInstall.status, 0, cliInstall.stderr);

    runInstaller({ scope: "global", mode: "copy", cwd: projDir, homeDir });
    assert.equal(
      fs.existsSync(path.join(projDir, ".agents", "skills", "using-github-convention", "SKILL.md")),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(homeDir, ".agents", "skills", "using-github-convention", "SKILL.md")),
      true,
    );

    const cliUninstall = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, "scripts", "install.mjs"), "--uninstall", "--scope", "project"],
      { cwd: projDir, env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir }, encoding: "utf8" },
    );
    assert.equal(cliUninstall.status, 0, cliUninstall.stderr);
    assert.equal(fs.existsSync(path.join(projDir, ".agents", "skills", "using-github-convention")), false);
    assert.equal(
      fs.existsSync(path.join(homeDir, ".agents", "skills", "using-github-convention", "SKILL.md")),
      true,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
