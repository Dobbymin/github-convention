import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  canonicalizePath,
  isOwnedCopyDir,
  isOwnedSymlink,
  runInstaller,
  runUninstaller,
  verifyDestWithinTarget,
} from "../install.mjs";
import { REPO_ROOT } from "../validate.mjs";

const INSTALL_SH = path.join(REPO_ROOT, "install.sh");
const UNINSTALL_SH = path.join(REPO_ROOT, "uninstall.sh");
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

const runPosixScript = (scriptPath, args, { cwd = REPO_ROOT, env = {} } = {}) =>
  spawnSync("sh", [scriptPath, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });

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

test("16-scenario ownership, forged marker, pre-deletion re-verification, and rm -rf guard matrix (Node + POSIX)", () => {
  const tempDir = makeTempDir("gh-conv-matrix16-");
  try {
    // Scenarios 1, 2, 3, 14: Normal symlink install/remove, copy install/remove, update symlink<->copy, standalone install
    const s1Target = path.join(tempDir, "s1-standalone");
    runInstaller({ target: s1Target, mode: "symlink" });
    for (const skill of ALL_SKILLS) {
      assert.equal(fs.lstatSync(path.join(s1Target, skill)).isSymbolicLink(), true);
    }
    // Scenario 3: Update symlink -> copy -> symlink
    runInstaller({ target: s1Target, mode: "copy" });
    for (const skill of ALL_SKILLS) {
      assert.equal(fs.lstatSync(path.join(s1Target, skill)).isDirectory(), true);
      assert.equal(fs.lstatSync(path.join(s1Target, skill)).isSymbolicLink(), false);
    }
    runInstaller({ target: s1Target, mode: "symlink" });
    for (const skill of ALL_SKILLS) {
      assert.equal(fs.lstatSync(path.join(s1Target, skill)).isSymbolicLink(), true);
    }
    runUninstaller({ target: s1Target });
    for (const skill of ALL_SKILLS) {
      assert.equal(fs.existsSync(path.join(s1Target, skill)), false);
    }
    // Scenario 2: Copy install and remove
    runInstaller({ target: s1Target, mode: "copy" });
    runUninstaller({ target: s1Target });
    for (const skill of ALL_SKILLS) {
      assert.equal(fs.existsSync(path.join(s1Target, skill)), false);
    }

    // Scenarios 4 & 9: Foreign plugin symlink & symlink target mismatch (outside managed skillsRoot)
    const s4Target = path.join(tempDir, "s4-foreign-link");
    const outsideDir = path.join(tempDir, "outside-managed", "using-github-convention");
    fs.mkdirSync(s4Target, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(outsideDir, "SKILL.md"), "---\nname: using-github-convention\n---\n");
    const s4Dest = path.join(s4Target, "using-github-convention");
    fs.symlinkSync(outsideDir, s4Dest, LINK_TYPE);
    assert.equal(isOwnedSymlink(s4Dest, outsideDir, path.join(REPO_ROOT, "skills")), false);
    assert.throws(() => runInstaller({ target: s4Target }), /unmanaged symlink/);
    assert.throws(() => runUninstaller({ target: s4Target }), /unmanaged symlink/);
    assert.equal(fs.lstatSync(s4Dest).isSymbolicLink(), true);
    assert.equal(fs.existsSync(path.join(outsideDir, "SKILL.md")), true);

    // Scenario 5: User-created regular file at skill path
    const s5Target = path.join(tempDir, "s5-user-file");
    fs.mkdirSync(s5Target, { recursive: true });
    const s5File = path.join(s5Target, "git-pr-workflow");
    fs.writeFileSync(s5File, "important user notes\n");
    assert.throws(() => runInstaller({ target: s5Target }), /non-directory file/);
    assert.throws(() => runUninstaller({ target: s5Target }), /non-directory file/);
    assert.equal(fs.readFileSync(s5File, "utf8"), "important user notes\n");

    // Scenarios 6 & 7: User directory exists & directory without ownership marker
    const s6Target = path.join(tempDir, "s6-user-dir");
    const s6SkillDir = path.join(s6Target, "issue-planning");
    fs.mkdirSync(s6SkillDir, { recursive: true });
    fs.writeFileSync(path.join(s6SkillDir, "SKILL.md"), "---\nname: issue-planning\n---\n");
    fs.writeFileSync(path.join(s6SkillDir, "custom.md"), "user work\n");
    assert.throws(() => runInstaller({ target: s6Target }), /unmanaged directory/);
    assert.throws(() => runUninstaller({ target: s6Target }), /unmanaged path/);
    assert.equal(fs.existsSync(path.join(s6SkillDir, "custom.md")), true);

    // Scenario 8 & 12: Forged ownership markers & rm -rf target verification
    const s8Target = path.join(tempDir, "s8-forged-marker");
    runInstaller({ target: s8Target, mode: "copy" });
    const canonS8Target = canonicalizePath(s8Target);
    const s8Dest = path.join(canonS8Target, "using-github-convention");
    const s8Marker = path.join(s8Dest, ".github-convention-script-managed");

    // 8a. Forged install-path in marker (copied from another directory)
    const validMarkerText = fs.readFileSync(s8Marker, "utf8");
    fs.writeFileSync(
      s8Marker,
      validMarkerText.replace(`install-path=${s8Dest}`, `install-path=${path.join(tempDir, "other-path")}`),
    );
    assert.throws(() => runUninstaller({ target: s8Target }), /unmanaged path/);
    assert.equal(fs.existsSync(s8Dest), true);

    // 8b. Forged source path in marker
    fs.writeFileSync(
      s8Marker,
      validMarkerText.replace(/source=.*/, `source=${outsideDir}`),
    );
    assert.throws(() => runUninstaller({ target: s8Target }), /unmanaged path/);
    assert.equal(fs.existsSync(s8Dest), true);

    // 8c. Forged dual plugin= lines in marker
    fs.writeFileSync(s8Marker, `${validMarkerText}plugin=dev-principles\n`);
    assert.throws(() => runUninstaller({ target: s8Target }), /unmanaged path/);
    assert.equal(fs.existsSync(s8Dest), true);

    // 8d & 12. Valid marker file present, but unexpected user file exists inside directory -> must NOT rm -rf
    fs.writeFileSync(s8Marker, validMarkerText);
    const userSecretFile = path.join(s8Dest, "user-important-note.txt");
    fs.writeFileSync(userSecretFile, "do not delete me\n");
    assert.equal(
      isOwnedCopyDir(s8Dest, "using-github-convention", s8Dest, path.join(REPO_ROOT, "skills", "using-github-convention")),
      false,
    );
    assert.throws(() => runInstaller({ target: s8Target, mode: "copy" }), /unmanaged directory/);
    assert.throws(() => runUninstaller({ target: s8Target }), /unmanaged path/);
    assert.equal(fs.readFileSync(userSecretFile, "utf8"), "do not delete me\n");
    // No other skill was deleted during failed uninstall
    for (const skill of ALL_SKILLS) {
      assert.equal(fs.existsSync(path.join(canonS8Target, skill, "SKILL.md")), true);
    }
    fs.unlinkSync(userSecretFile);

    // Scenarios 10 & 11: Pre-deletion ownership re-verification failure & confirmation that rm/rm -rf does NOT execute
    const s10Target = path.join(tempDir, "s10-race-guard");
    runInstaller({ target: s10Target, mode: "copy" });
    const canonS10Target = canonicalizePath(s10Target);
    const firstSkill = ALL_SKILLS[0]; // git-pr-workflow
    const firstDest = path.join(canonS10Target, firstSkill);

    // Tamper right before Pass 2 deletion (after Pass 1 succeeded) via beforeRemoveHook
    assert.throws(
      () =>
        runUninstaller({
          target: s10Target,
          beforeRemoveHook: ({ dest }) => {
            if (dest === firstDest) {
              fs.writeFileSync(path.join(dest, "unexpected-at-delete-time.txt"), "saved!\n");
            }
          },
        }),
      /Copy directory ownership verification failed/,
    );
    // Confirm rm -rf did NOT run on tampered directory
    assert.equal(fs.existsSync(path.join(firstDest, "unexpected-at-delete-time.txt")), true);
    assert.equal(fs.existsSync(path.join(firstDest, "SKILL.md")), true);

    // Also test symlink pre-deletion re-verification failure on update & uninstall
    const s10LinkTarget = path.join(tempDir, "s10-link-race");
    runInstaller({ target: s10LinkTarget, mode: "symlink" });
    const canonS10LinkTarget = canonicalizePath(s10LinkTarget);
    const firstLinkDest = path.join(canonS10LinkTarget, firstSkill);

    assert.throws(
      () =>
        runUninstaller({
          target: s10LinkTarget,
          beforeRemoveHook: ({ dest }) => {
            if (dest === firstLinkDest) {
              fs.rmSync(dest, { recursive: true, force: true });
              fs.symlinkSync(outsideDir, dest, LINK_TYPE);
            }
          },
        }),
      /Symlink ownership verification failed/,
    );
    // Confirm the swapped foreign symlink was NOT removed
    assert.equal(fs.lstatSync(firstLinkDest).isSymbolicLink(), true);

    // Scenario 13: Dry-run produces zero filesystem modifications across install, update, and uninstall
    const s13Target = path.join(tempDir, "s13-dryrun");
    runInstaller({ target: s13Target, mode: "symlink", dryRun: true });
    assert.equal(fs.existsSync(s13Target), false);
    runInstaller({ target: s13Target, mode: "symlink" });
    runInstaller({ target: s13Target, mode: "copy", dryRun: true });
    for (const skill of ALL_SKILLS) {
      assert.equal(fs.lstatSync(path.join(s13Target, skill)).isSymbolicLink(), true);
    }
    runUninstaller({ target: s13Target, dryRun: true });
    for (const skill of ALL_SKILLS) {
      assert.equal(fs.lstatSync(path.join(s13Target, skill)).isSymbolicLink(), true);
    }

    // Scenarios 15 & 16: Co-installation with dev-principles & preserving dev-principles on uninstall
    const s15Target = path.join(tempDir, "s15-coinstall");
    const dpSkills = ["dev-principles", "clean-architecture"];
    for (const dp of dpSkills) {
      const dpPath = path.join(s15Target, dp);
      fs.mkdirSync(dpPath, { recursive: true });
      fs.writeFileSync(path.join(dpPath, "SKILL.md"), `---\nname: ${dp}\n---\n`);
      fs.writeFileSync(path.join(dpPath, ".dev-principles-script-managed"), "plugin=dev-principles\n");
    }
    runInstaller({ target: s15Target, mode: "copy" });
    for (const dp of dpSkills) {
      assert.equal(fs.existsSync(path.join(s15Target, dp, "SKILL.md")), true);
    }
    for (const skill of ALL_SKILLS) {
      assert.equal(fs.existsSync(path.join(s15Target, skill, "SKILL.md")), true);
    }
    runUninstaller({ target: s15Target });
    for (const skill of ALL_SKILLS) {
      assert.equal(fs.existsSync(path.join(s15Target, skill)), false);
    }
    for (const dp of dpSkills) {
      assert.equal(fs.existsSync(path.join(s15Target, dp, "SKILL.md")), true);
      assert.equal(fs.existsSync(path.join(s15Target, dp, ".dev-principles-script-managed")), true);
    }

    // Verify destination path normalization helper rejects mismatched canonical paths
    assert.equal(
      verifyDestWithinTarget(path.join(canonS10Target, "git-pr-workflow"), canonS10Target, REPO_ROOT, "wrong-name"),
      false,
    );

    // Retired/orphan manifest entry pruning & tamper protection (Issue #104)
    const orphanTarget = path.join(tempDir, "s17-orphan-manifest");
    runInstaller({ target: orphanTarget, mode: "copy" });
    const canonOrphanTarget = canonicalizePath(orphanTarget);
    const retiredName = "retired-legacy-skill";
    const retiredDir = path.join(canonOrphanTarget, retiredName);
    const retiredExpectedSource = path.join(canonicalizePath(REPO_ROOT), "skills", retiredName);
    fs.mkdirSync(retiredDir, { recursive: true });
    fs.writeFileSync(path.join(retiredDir, "SKILL.md"), `---\nname: ${retiredName}\n---\n`);
    fs.writeFileSync(
      path.join(retiredDir, ".github-convention-script-managed"),
      `schema_version=1\nplugin=github-convention\nmanaged-by=scripts/install.mjs\ninstall-mode=copy\nskill=${retiredName}\ninstall-path=${retiredDir}\nsource=${retiredExpectedSource}\n`,
    );
    const orphanManifest = path.join(canonOrphanTarget, ".github-convention-install-manifest");
    fs.appendFileSync(orphanManifest, `entry|${retiredName}|copy|${retiredDir}|${retiredExpectedSource}\n`);

    // If user added a custom file to the retired skill directory, installer update must refuse to prune it
    fs.writeFileSync(path.join(retiredDir, "user-keep.txt"), "keep\n");
    assert.throws(() => runInstaller({ target: orphanTarget, mode: "copy" }), /refusing to remove unmanaged retired directory/);
    assert.equal(fs.existsSync(path.join(retiredDir, "user-keep.txt")), true);

    // Once clean (owned by github-convention), installer update prunes the retired skill and refreshes manifest
    fs.unlinkSync(path.join(retiredDir, "user-keep.txt"));
    const pruneUpdateRes = runInstaller({ target: orphanTarget, mode: "copy" });
    assert.equal(pruneUpdateRes.ok, true);
    assert.equal(fs.existsSync(retiredDir), false);
    assert.equal(fs.readFileSync(orphanManifest, "utf8").includes(retiredName), false);

    // Re-create retired skill and test runUninstaller prunes it cleanly too
    fs.mkdirSync(retiredDir, { recursive: true });
    fs.writeFileSync(path.join(retiredDir, "SKILL.md"), `---\nname: ${retiredName}\n---\n`);
    fs.writeFileSync(
      path.join(retiredDir, ".github-convention-script-managed"),
      `schema_version=1\nplugin=github-convention\nmanaged-by=scripts/install.mjs\ninstall-mode=copy\nskill=${retiredName}\ninstall-path=${retiredDir}\nsource=${retiredExpectedSource}\n`,
    );
    fs.appendFileSync(orphanManifest, `entry|${retiredName}|copy|${retiredDir}|${retiredExpectedSource}\n`);
    runUninstaller({ target: orphanTarget });
    assert.equal(fs.existsSync(retiredDir), false);

    // 7.3 Extended install/uninstall ownership & manifest integrity cases (13 required cases)
    const extTarget = path.join(tempDir, "s18-extended-13");
    runInstaller({ target: extTarget, mode: "copy" });
    const canonExtTarget = canonicalizePath(extTarget);
    const extSkillDir = path.join(canonExtTarget, "using-github-convention");
    const extMarker = path.join(extSkillDir, ".github-convention-script-managed");
    const extManifest = path.join(canonExtTarget, ".github-convention-install-manifest");
    const origExtMarker = fs.readFileSync(extMarker, "utf8");
    const origExtManifest = fs.readFileSync(extManifest, "utf8");

    // (a) Missing required fields in marker (e.g. missing skill=, install-path=, or source=) -> refused
    for (const fieldToDrop of [/^skill=.*\n/m, /^install-path=.*\n/m, /^source=.*\n/m]) {
      fs.writeFileSync(extMarker, origExtMarker.replace(fieldToDrop, ""));
      assert.throws(() => runUninstaller({ target: extTarget }), /unmanaged path/);
      assert.equal(fs.existsSync(extSkillDir), true);
    }

    // (b) Wrong Skill ID in marker -> refused
    fs.writeFileSync(extMarker, origExtMarker.replace("skill=using-github-convention", "skill=wrong-skill-id"));
    assert.throws(() => runUninstaller({ target: extTarget }), /unmanaged path/);
    fs.writeFileSync(extMarker, origExtMarker);

    // (c) Manifest tampering (invalid schema_version, unknown line, or mismatched install_target) -> refused
    fs.writeFileSync(extManifest, origExtManifest.replace("schema_version=1", "schema_version=999"));
    assert.throws(() => runUninstaller({ target: extTarget }), /unmanaged manifest/);
    fs.writeFileSync(extManifest, `${origExtManifest}corrupted_line_without_equals\n`);
    assert.throws(() => runUninstaller({ target: extTarget }), /unmanaged manifest/);
    fs.writeFileSync(extManifest, origExtManifest);

    // (d) Missing managed file inside copy directory (SKILL.md or file listed in files=) -> refused
    fs.writeFileSync(extMarker, origExtMarker.replace("files=SKILL.md", "files=SKILL.md,missing-managed.md"));
    assert.throws(() => runUninstaller({ target: extTarget }), /unmanaged path/);
    fs.writeFileSync(extMarker, origExtMarker);

    // (e) Directory with .github-convention-script-managed marker that is NOT listed in manifest -> refused
    const unlistedManifest = origExtManifest
      .split(/\r?\n/)
      .filter((l) => !l.startsWith("entry|using-github-convention|"))
      .join("\n") + "\n";
    fs.writeFileSync(extManifest, unlistedManifest);
    assert.throws(() => runUninstaller({ target: extTarget }), /not listed in/);
    fs.writeFileSync(extManifest, origExtManifest);

    // (f) Symlink path escape inside copy directory -> refused
    const innerEscapeLink = path.join(extSkillDir, "escape-link");
    fs.symlinkSync(outsideDir, innerEscapeLink, LINK_TYPE);
    assert.throws(() => runUninstaller({ target: extTarget }), /unmanaged path/);
    fs.rmSync(innerEscapeLink, { recursive: true, force: true });

    // (g) Partial deletion failure mid-Pass-2 preserves external/co-installed files and tampered target
    const foreignCoDir = path.join(canonExtTarget, "external-plugin-skill");
    fs.mkdirSync(foreignCoDir, { recursive: true });
    fs.writeFileSync(path.join(foreignCoDir, "SKILL.md"), "# external\n");
    const secondSkillDest = path.join(canonExtTarget, ALL_SKILLS[1]); // issue-planning
    assert.throws(
      () =>
        runUninstaller({
          target: extTarget,
          beforeRemoveHook: ({ dest }) => {
            if (dest === secondSkillDest) {
              fs.writeFileSync(path.join(dest, "user-added-mid-uninstall.txt"), "preserve me\n");
            }
          },
        }),
      /Copy directory ownership verification failed/,
    );
    // First skill was removed, but second skill (with user file) and external plugin skill are preserved
    assert.equal(fs.existsSync(path.join(secondSkillDest, "user-added-mid-uninstall.txt")), true);
    assert.equal(fs.existsSync(path.join(foreignCoDir, "SKILL.md")), true);

    // POSIX shell (install.sh / uninstall.sh) explicit check for forged marker, unexpected file inside copy dir, and pre-deletion abort
    if (process.platform !== "win32") {
      const shTarget = path.join(tempDir, "sh-matrix");
      const shInstall = runPosixScript(INSTALL_SH, ["--target", shTarget, "--copy"]);
      assert.equal(shInstall.status, 0, shInstall.stderr);

      // Inject an unexpected user file into a managed copy dir -> install.sh and uninstall.sh must refuse to rm -rf it
      const shSkillDir = path.join(shTarget, "using-github-convention");
      const shUserFile = path.join(shSkillDir, "user-note.md");
      fs.writeFileSync(shUserFile, "keep me\n");

      const shUpdateFail = runPosixScript(INSTALL_SH, ["--target", shTarget, "--copy"]);
      assert.notEqual(shUpdateFail.status, 0);
      assert.equal(fs.readFileSync(shUserFile, "utf8"), "keep me\n");

      const shUninstallFail = runPosixScript(UNINSTALL_SH, ["--target", shTarget]);
      assert.notEqual(shUninstallFail.status, 0);
      assert.equal(fs.readFileSync(shUserFile, "utf8"), "keep me\n");

      // Remove unexpected user file, then test forged source= in marker
      fs.unlinkSync(shUserFile);
      const shMarker = path.join(shSkillDir, ".github-convention-script-managed");
      const origShMarker = fs.readFileSync(shMarker, "utf8");
      fs.writeFileSync(shMarker, origShMarker.replace(/source=.*/, `source=${outsideDir}`));
      const shForgedFail = runPosixScript(UNINSTALL_SH, ["--target", shTarget]);
      assert.notEqual(shForgedFail.status, 0);
      assert.equal(fs.existsSync(shSkillDir), true);

      // Restore valid marker -> clean uninstall succeeds
      fs.writeFileSync(shMarker, origShMarker);
      const shUninstallOk = runPosixScript(UNINSTALL_SH, ["--target", shTarget]);
      assert.equal(shUninstallOk.status, 0, shUninstallOk.stderr);
      assert.equal(fs.existsSync(shSkillDir), false);

      // Direct Pass 2 pre-deletion re-verification abort in install.sh / uninstall.sh (verifies rm/rm -rf is never reached)
      const shRaceTarget = path.join(tempDir, "sh-race");
      assert.equal(runPosixScript(INSTALL_SH, ["--target", shRaceTarget, "--copy"]).status, 0);
      const shRaceFirst = path.join(shRaceTarget, "git-pr-workflow");
      const shRaceSecond = path.join(shRaceTarget, "issue-planning");
      const shWrapperDir = path.join(tempDir, "sh-wrapper");
      fs.mkdirSync(shWrapperDir, { recursive: true });
      // Wrap `rm` so that when Pass 2 deletes the first skill (`git-pr-workflow`), it injects an unexpected file into the second skill (`issue-planning`) before Pass 2 reaches `issue-planning`
      const rmWrapPath = path.join(shWrapperDir, "rm");
      fs.writeFileSync(
        rmWrapPath,
        `#!/bin/sh\n/bin/rm "$@"\nif [ -d "${shRaceSecond}" ] && [ ! -f "${shRaceSecond}/race-injected.txt" ]; then\n  printf 'saved\\n' > "${shRaceSecond}/race-injected.txt"\nfi\n`,
      );
      fs.chmodSync(rmWrapPath, 0o755);

      const shRaceUninstall = runPosixScript(UNINSTALL_SH, ["--target", shRaceTarget], {
        env: { PATH: `${shWrapperDir}:${process.env.PATH}` },
      });
      assert.notEqual(shRaceUninstall.status, 0);
      assert.match(shRaceUninstall.stderr, /Copy directory ownership verification failed/);
      assert.equal(fs.existsSync(path.join(shRaceSecond, "race-injected.txt")), true);
      assert.equal(fs.existsSync(path.join(shRaceSecond, "SKILL.md")), true);

      // Re-install git-pr-workflow, remove race-injected.txt, then test install.sh Pass 2 update abort when issue-planning is tampered right before replacement
      fs.unlinkSync(path.join(shRaceSecond, "race-injected.txt"));
      assert.equal(runPosixScript(INSTALL_SH, ["--target", shRaceTarget, "--copy"]).status, 0);
      const shRaceInstallUpdate = runPosixScript(INSTALL_SH, ["--target", shRaceTarget, "--copy"], {
        env: { PATH: `${shWrapperDir}:${process.env.PATH}` },
      });
      assert.notEqual(shRaceInstallUpdate.status, 0);
      assert.match(shRaceInstallUpdate.stderr, /Directory ownership verification failed/);
      assert.equal(fs.existsSync(path.join(shRaceSecond, "race-injected.txt")), true);

      // POSIX install.sh / uninstall.sh retired manifest entry pruning & tamper protection (Issue #104)
      const shOrphanTarget = path.join(tempDir, "sh-orphan");
      assert.equal(runPosixScript(INSTALL_SH, ["--target", shOrphanTarget, "--copy"]).status, 0);
      const canonShOrphan = canonicalizePath(shOrphanTarget);
      const shRetiredDir = path.join(canonShOrphan, retiredName);
      fs.mkdirSync(shRetiredDir, { recursive: true });
      fs.writeFileSync(path.join(shRetiredDir, "SKILL.md"), `---\nname: ${retiredName}\n---\n`);
      fs.writeFileSync(
        path.join(shRetiredDir, ".github-convention-script-managed"),
        `schema_version=1\nplugin=github-convention\nmanaged-by=install.sh\ninstall-mode=copy\nskill=${retiredName}\ninstall-path=${shRetiredDir}\nsource=${retiredExpectedSource}\n`,
      );
      fs.appendFileSync(
        path.join(canonShOrphan, ".github-convention-install-manifest"),
        `entry|${retiredName}|copy|${shRetiredDir}|${retiredExpectedSource}\n`,
      );
      fs.writeFileSync(path.join(shRetiredDir, "user-keep.txt"), "keep\n");
      const shOrphanRefused = runPosixScript(UNINSTALL_SH, ["--target", shOrphanTarget]);
      assert.notEqual(shOrphanRefused.status, 0);
      assert.equal(fs.existsSync(path.join(shRetiredDir, "user-keep.txt")), true);

      fs.unlinkSync(path.join(shRetiredDir, "user-keep.txt"));
      const shOrphanUpdateOk = runPosixScript(INSTALL_SH, ["--target", shOrphanTarget, "--copy"]);
      assert.equal(shOrphanUpdateOk.status, 0, shOrphanUpdateOk.stderr);
      assert.equal(fs.existsSync(shRetiredDir), false);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
