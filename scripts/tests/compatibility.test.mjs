import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildSessionStartPayload,
  detectCompanionPlugins,
  resolveContextMode,
} from "../../hooks/session-start.mjs";
import { REPO_ROOT } from "../validate.mjs";

const SESSION_HOOK = path.join(REPO_ROOT, "hooks", "session-start.mjs");
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

const makeTempDir = (prefix = "gh-conv-compat-") =>
  fs.mkdtempSync(path.join(os.tmpdir(), prefix));

const runScript = (scriptPath, args, { cwd = REPO_ROOT, env = {} } = {}) =>
  spawnSync("sh", [scriptPath, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });

const runSessionHookSubprocess = ({ cwd, env = {} }) =>
  spawnSync(process.execPath, [SESSION_HOOK], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });

// --- 1. SessionStart Deduplication & Context Modes ---

test("detectCompanionPlugins detects dev-principles across project/global surfaces and handles corrupt JSON", () => {
  const dir = makeTempDir();
  const home = makeTempDir("gh-conv-home-");
  try {
    assert.deepEqual(detectCompanionPlugins({ cwd: dir, gitRoot: dir, homeDir: home }), []);

    // Corrupt installed_plugins.json should never throw
    fs.mkdirSync(path.join(home, ".claude", "plugins"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".claude", "plugins", "installed_plugins.json"),
      "{invalid json",
    );
    assert.deepEqual(detectCompanionPlugins({ cwd: dir, gitRoot: dir, homeDir: home }), []);

    // Valid installed_plugins.json with dev-principles@marketplace key
    fs.writeFileSync(
      path.join(home, ".claude", "plugins", "installed_plugins.json"),
      JSON.stringify({ plugins: { "dev-principles@Dobbymin": { version: "0.1.0" } } }),
    );
    assert.deepEqual(
      detectCompanionPlugins({ cwd: dir, gitRoot: dir, homeDir: home }),
      ["dev-principles"],
    );

    // Project .dev-principles.yaml detection
    const projDir = makeTempDir("gh-conv-proj-");
    try {
      fs.writeFileSync(path.join(projDir, ".dev-principles.yaml"), "preset: auto\n");
      assert.deepEqual(
        detectCompanionPlugins({ cwd: projDir, gitRoot: projDir, homeDir: null }),
        ["dev-principles"],
      );
    } finally {
      fs.rmSync(projDir, { recursive: true, force: true });
    }

    // Project .agents/skills/dev-principles/SKILL.md detection
    const skillProj = makeTempDir("gh-conv-skillproj-");
    try {
      fs.mkdirSync(path.join(skillProj, ".agents", "skills", "dev-principles"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(skillProj, ".agents", "skills", "dev-principles", "SKILL.md"),
        "# dev-principles\n",
      );
      assert.deepEqual(
        detectCompanionPlugins({ cwd: skillProj, gitRoot: skillProj, homeDir: null }),
        ["dev-principles"],
      );
    } finally {
      fs.rmSync(skillProj, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("resolveContextMode respects env override > config.yaml > auto", () => {
  assert.equal(resolveContextMode({ configText: "", env: {} }), "auto");
  assert.equal(
    resolveContextMode({
      configText: "schema_version: 1\nsession:\n  context_mode: compact\n",
      env: {},
    }),
    "compact",
  );
  assert.equal(
    resolveContextMode({
      configText: "schema_version: 1\nsession:\n  context_mode: compact\n",
      env: { GITHUB_CONVENTION_CONTEXT_MODE: "full" },
    }),
    "full",
  );
  assert.equal(
    resolveContextMode({
      configText: "session:\n  context_mode: invalid\n",
      env: { GITHUB_CONVENTION_CONTEXT_MODE: "bogus" },
    }),
    "auto",
  );
});

test("SessionStart deduplicates context when dev-principles is co-installed and supports standalone/full/compact", () => {
  const dir = makeTempDir();
  const home = makeTempDir("gh-conv-home-");
  try {
    fs.mkdirSync(path.join(dir, ".git"));

    const standalone = buildSessionStartPayload({
      cwd: dir,
      env: {},
      pluginRoot: REPO_ROOT,
      homeDir: home,
    });
    const full = buildSessionStartPayload({
      cwd: dir,
      env: { GITHUB_CONVENTION_CONTEXT_MODE: "full" },
      pluginRoot: REPO_ROOT,
      homeDir: home,
    });

    assert.ok(standalone.additionalContext.length < full.additionalContext.length);
    assert.match(standalone.additionalContext, /using-github-convention/);
    assert.match(standalone.additionalContext, /issue-planning/);

    // Simulate co-installed dev-principles via global skill
    fs.mkdirSync(path.join(home, ".agents", "skills", "dev-principles"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".agents", "skills", "dev-principles", "SKILL.md"),
      "# dev-principles\n",
    );

    const coinstalledRes = runSessionHookSubprocess({
      cwd: dir,
      env: { HOME: home, CLAUDE_PLUGIN_ROOT: "", CURSOR_PLUGIN_ROOT: "" },
    });
    assert.equal(coinstalledRes.status, 0);
    const coinstalled = JSON.parse(coinstalledRes.stdout);

    assert.ok(coinstalled.additionalContext.length < standalone.additionalContext.length);
    assert.match(coinstalled.additionalContext, /Companion detected: dev-principles/);
    assert.match(coinstalled.additionalContext, /using-github-convention/);
    assert.match(coinstalled.additionalContext, /Orchestrator/);
    assert.match(coinstalled.additionalContext, /never push default branch/i);

    // Co-installed with .github-convention/config.yaml + Claude/Cursor/Antigravity output formats
    fs.mkdirSync(path.join(dir, ".github-convention"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".github-convention", "config.yaml"), "schema_version: 1\n");

    const claudeCo = buildSessionStartPayload({
      cwd: dir,
      env: { CLAUDE_PLUGIN_ROOT: REPO_ROOT },
      pluginRoot: REPO_ROOT,
      homeDir: home,
    });
    assert.equal(claudeCo.hookSpecificOutput.hookEventName, "SessionStart");
    assert.match(claudeCo.hookSpecificOutput.additionalContext, /config\.yaml detected/);
    assert.match(claudeCo.hookSpecificOutput.additionalContext, /Companion detected: dev-principles/);

    const cursorCo = buildSessionStartPayload({
      cwd: dir,
      env: { CURSOR_PLUGIN_ROOT: REPO_ROOT },
      pluginRoot: REPO_ROOT,
      homeDir: home,
    });
    assert.match(cursorCo.additional_context, /Companion detected: dev-principles/);

    const agyCo = buildSessionStartPayload({
      cwd: dir,
      env: { PLUGIN_ROOT: REPO_ROOT },
      pluginRoot: REPO_ROOT,
      homeDir: home,
    });
    assert.match(agyCo.injectSteps[0].systemMessage.systemMessage, /Companion detected: dev-principles/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// --- 2. Role Separation, Authority, Language & Version Contracts ---

test("PR reviewer, repo analyzer, task worker, skills, and README preserve separation, authority, language, and version", () => {
  const prReviewer = fs.readFileSync(path.join(REPO_ROOT, "agents", "pr-reviewer.md"), "utf8");
  assert.match(prReviewer, /principles-reviewer/);
  assert.match(prReviewer, /architecture-reviewer/);
  assert.match(prReviewer, /security-reviewer/);
  assert.match(prReviewer, /No recursive\/mutual invocation/);
  assert.match(prReviewer, /without arbitrarily rewriting/i);
  assert.match(prReviewer, /never ignore unresolved Blockers/i);
  assert.match(prReviewer, /미검토 \(Not provided\)/);
  assert.match(prReviewer, /READY_FOR_PR/);
  for (const section of [
    "GitHub Convention 검사",
    "Issue Acceptance Criteria 검사",
    "Secret Scan",
    "CI 및 Check 검사",
    "외부 Reviewer 결과",
    "최종 Blocker / Warning",
    "PR 진행 가능 여부",
  ]) {
    assert.ok(prReviewer.includes(section), `Missing section in pr-reviewer.md: ${section}`);
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  const readme = fs.readFileSync(path.join(REPO_ROOT, "README.md"), "utf8");
  assert.ok(readme.includes(`## v${pkg.version} 구조 요약`), `README.md missing v${pkg.version}`);

  const repoAnalyzer = fs.readFileSync(path.join(REPO_ROOT, "agents", "repo-analyzer.md"), "utf8");
  assert.match(repoAnalyzer, /GitHub workflow metadata/);
  assert.match(repoAnalyzer, /structure-analyzer/);
  assert.match(repoAnalyzer, /github_workflow_context/);

  const usingSkill = fs.readFileSync(
    path.join(REPO_ROOT, "skills", "using-github-convention", "SKILL.md"),
    "utf8",
  );
  assert.match(usingSkill, /Output & Report Language/);
  assert.match(usingSkill, /principles-reviewer/);
  assert.match(usingSkill, /Never push directly to the protected default branch/);
  assert.match(usingSkill, /auto_merge_on_ci_pass/);
  assert.match(usingSkill, /--admin/);

  const parallelSkill = fs.readFileSync(
    path.join(REPO_ROOT, "skills", "parallel-execution", "SKILL.md"),
    "utf8",
  );
  assert.equal(parallelSkill.includes("English Only"), false);
  assert.match(parallelSkill, /unified language policy/);

  const taskWorker = fs.readFileSync(path.join(REPO_ROOT, "agents", "task-worker.md"), "utf8");
  assert.equal(taskWorker.includes("English Only"), false);
  assert.match(taskWorker, /Required Output Format/);
});

test("multi-harness hook and non-hook entry contracts are valid", () => {
  const rootHooks = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "hooks.json"), "utf8"));
  assert.ok(Array.isArray(rootHooks["github-convention"].SessionStart));
  assert.ok(Array.isArray(rootHooks["github-convention"].PreToolUse));
  assert.equal(
    fs.existsSync(path.join(REPO_ROOT, "hooks", "session-start.mjs")),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(REPO_ROOT, "hooks", "guard-bash.mjs")),
    true,
  );

  const geminiExt = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "gemini-extension.json"), "utf8"),
  );
  assert.equal(geminiExt.contextFileName, "skills/using-github-convention/SKILL.md");
  assert.equal(
    fs.existsSync(path.join(REPO_ROOT, ...geminiExt.contextFileName.split("/"))),
    true,
  );
});

// --- 3. Installer & Uninstaller Ownership, Conflicts, Mixed Scopes & Recovery ---

test(
  "install.sh and uninstall.sh reject foreign symlinks (including suffix traps), files, and unmanaged dirs atomically",
  { skip: process.platform === "win32" },
  () => {
    const tempDir = makeTempDir("gh-conv-conflict-");
    const targetDir = path.join(tempDir, "target", "skills");
    const foreignRoot = path.join(tempDir, "foreign-plugin", "skills");
    try {
      fs.mkdirSync(targetDir, { recursive: true });
      fs.mkdirSync(path.join(foreignRoot, "using-github-convention"), { recursive: true });
      fs.writeFileSync(
        path.join(foreignRoot, "using-github-convention", "SKILL.md"),
        "# foreign\n",
      );

      // Case A: Foreign symlink whose path ends with /skills/using-github-convention (suffix trap)
      const suffixTrapDest = path.join(targetDir, "using-github-convention");
      fs.symlinkSync(path.join(foreignRoot, "using-github-convention"), suffixTrapDest);

      const installFail = runScript(INSTALL_SH, ["--target", targetDir]);
      assert.notEqual(installFail.status, 0);
      assert.match(installFail.stderr, /unmanaged symlink/);
      // Atomic pre-flight: other 5 skills were NOT installed and foreign symlink is intact
      assert.equal(fs.existsSync(path.join(targetDir, "git-pr-workflow")), false);
      assert.equal(
        fs.readlinkSync(suffixTrapDest),
        path.join(foreignRoot, "using-github-convention"),
      );

      const uninstallFail = runScript(UNINSTALL_SH, ["--target", targetDir]);
      assert.notEqual(uninstallFail.status, 0);
      assert.match(uninstallFail.stderr, /unmanaged symlink/);
      assert.equal(fs.lstatSync(suffixTrapDest).isSymbolicLink(), true);

      // Remove foreign symlink, test Case B: broken foreign symlink
      fs.unlinkSync(suffixTrapDest);
      fs.symlinkSync(path.join(tempDir, "nonexistent", "skills", "using-github-convention"), suffixTrapDest);
      const brokenInstall = runScript(INSTALL_SH, ["--target", targetDir, "--dry-run"]);
      assert.notEqual(brokenInstall.status, 0);
      const brokenUninstall = runScript(UNINSTALL_SH, ["--target", targetDir]);
      assert.notEqual(brokenUninstall.status, 0);

      // Case C: Existing regular file
      fs.unlinkSync(suffixTrapDest);
      fs.writeFileSync(suffixTrapDest, "user file\n");
      const fileFail = runScript(INSTALL_SH, ["--target", targetDir]);
      assert.notEqual(fileFail.status, 0);
      assert.match(fileFail.stderr, /non-directory file/);
      assert.equal(fs.readFileSync(suffixTrapDest, "utf8"), "user file\n");

      // Case D: Unmanaged directory (even empty or foreign marker)
      fs.unlinkSync(suffixTrapDest);
      fs.mkdirSync(suffixTrapDest);
      const emptyDirFail = runScript(INSTALL_SH, ["--target", targetDir]);
      assert.notEqual(emptyDirFail.status, 0);
      assert.match(emptyDirFail.stderr, /unmanaged directory/);

      fs.writeFileSync(
        path.join(suffixTrapDest, ".github-convention-script-managed"),
        "plugin=other-plugin\nmanaged-by=install.sh\n",
      );
      const foreignMarkerFail = runScript(UNINSTALL_SH, ["--target", targetDir]);
      assert.notEqual(foreignMarkerFail.status, 0);

      // Case E: Foreign manifest at .github-convention-install-manifest
      fs.rmSync(suffixTrapDest, { recursive: true, force: true });
      const manifestPath = path.join(targetDir, ".github-convention-install-manifest");
      fs.writeFileSync(manifestPath, "plugin=other-plugin\n");
      const foreignManifestInstall = runScript(INSTALL_SH, ["--target", targetDir]);
      assert.notEqual(foreignManifestInstall.status, 0);
      assert.match(foreignManifestInstall.stderr, /unmanaged manifest/);
      const foreignManifestUninstall = runScript(UNINSTALL_SH, ["--target", targetDir]);
      assert.notEqual(foreignManifestUninstall.status, 0);
      assert.equal(fs.readFileSync(manifestPath, "utf8"), "plugin=other-plugin\n");
      fs.unlinkSync(manifestPath);

      // Case F: Relative escaping symlink (../foreign-plugin/skills/using-github-convention)
      const relEscapeTarget = path.relative(
        targetDir,
        path.join(foreignRoot, "using-github-convention"),
      );
      fs.symlinkSync(relEscapeTarget, suffixTrapDest);
      const relEscapeFail = runScript(UNINSTALL_SH, ["--target", targetDir]);
      assert.notEqual(relEscapeFail.status, 0);
      assert.match(relEscapeFail.stderr, /unmanaged symlink/);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  },
);

test(
  "install.sh and uninstall.sh preserve co-installed dev-principles, recover partial installs, and isolate project/global scopes",
  { skip: process.platform === "win32" },
  () => {
    const tempDir = makeTempDir("gh-conv-coinstall-");
    const homeDir = path.join(tempDir, "home");
    const projDir = path.join(tempDir, "project");
    const sharedTarget = path.join(tempDir, "shared-skills");
    try {
      fs.mkdirSync(homeDir, { recursive: true });
      fs.mkdirSync(projDir, { recursive: true });

      // Simulate co-installed dev-principles skill in sharedTarget
      const dpSkillDir = path.join(sharedTarget, "dev-principles");
      fs.mkdirSync(dpSkillDir, { recursive: true });
      fs.writeFileSync(path.join(dpSkillDir, "SKILL.md"), "# dev-principles\n");
      fs.writeFileSync(path.join(dpSkillDir, ".dev-principles-script-managed"), "managed-by=install.sh\n");

      // Simulate partial/interrupted install (2 of 6 owned symlinks present)
      fs.symlinkSync(
        path.join(REPO_ROOT, "skills", "using-github-convention"),
        path.join(sharedTarget, "using-github-convention"),
      );
      fs.symlinkSync(
        path.join(REPO_ROOT, "skills", "git-pr-workflow"),
        path.join(sharedTarget, "git-pr-workflow"),
      );

      // Re-run install.sh -> completes all 6 cleanly and writes ownership manifest
      const recoverRes = runScript(INSTALL_SH, ["--target", sharedTarget]);
      assert.equal(recoverRes.status, 0, recoverRes.stderr);
      for (const skill of ALL_SKILLS) {
        assert.equal(fs.existsSync(path.join(sharedTarget, skill, "SKILL.md")), true);
      }
      const manifestFile = path.join(sharedTarget, ".github-convention-install-manifest");
      assert.equal(fs.existsSync(manifestFile), true);
      const manifestText = fs.readFileSync(manifestFile, "utf8");
      assert.match(manifestText, /plugin=github-convention/);
      assert.match(manifestText, /install_mode=symlink/);

      // Update existing symlink install -> --copy (writes enriched marker) -> back to symlink
      const dryUpdate = runScript(INSTALL_SH, ["--target", sharedTarget, "--copy", "--dry-run"]);
      assert.equal(dryUpdate.status, 0, dryUpdate.stderr);
      assert.equal(fs.lstatSync(path.join(sharedTarget, "using-github-convention")).isSymbolicLink(), true);

      const copyUpdate = runScript(INSTALL_SH, ["--target", sharedTarget, "--copy"]);
      assert.equal(copyUpdate.status, 0, copyUpdate.stderr);
      assert.equal(fs.lstatSync(path.join(sharedTarget, "using-github-convention")).isSymbolicLink(), false);
      const markerText = fs.readFileSync(
        path.join(sharedTarget, "using-github-convention", ".github-convention-script-managed"),
        "utf8",
      );
      assert.match(markerText, /plugin=github-convention/);
      assert.match(markerText, /skill=using-github-convention/);
      assert.match(markerText, /install-mode=copy/);

      // Uninstall github-convention -> dev-principles remains untouched, manifest removed
      const uninstallDry = runScript(UNINSTALL_SH, ["--target", sharedTarget, "--dry-run"]);
      assert.equal(uninstallDry.status, 0, uninstallDry.stderr);
      assert.equal(fs.existsSync(manifestFile), true);

      const uninstallRes = runScript(UNINSTALL_SH, ["--target", sharedTarget]);
      assert.equal(uninstallRes.status, 0, uninstallRes.stderr);
      for (const skill of ALL_SKILLS) {
        assert.equal(fs.existsSync(path.join(sharedTarget, skill)), false);
      }
      assert.equal(fs.existsSync(manifestFile), false);
      assert.equal(fs.existsSync(path.join(dpSkillDir, "SKILL.md")), true);

      // Relative --target and relative owned symlink verification
      const relInstall = runScript(INSTALL_SH, ["--target", "./rel-skills"], { cwd: tempDir });
      assert.equal(relInstall.status, 0, relInstall.stderr);
      assert.equal(
        fs.existsSync(path.join(tempDir, "rel-skills", ".github-convention-install-manifest")),
        true,
      );
      const relOwnedLink = path.join(tempDir, "rel-skills", "using-github-convention");
      fs.unlinkSync(relOwnedLink);
      fs.symlinkSync(
        path.relative(
          fs.realpathSync(path.join(tempDir, "rel-skills")),
          path.join(REPO_ROOT, "skills", "using-github-convention"),
        ),
        relOwnedLink,
      );
      const relUninstall = runScript(UNINSTALL_SH, ["--target", "./rel-skills"], { cwd: tempDir });
      assert.equal(relUninstall.status, 0, relUninstall.stderr);
      assert.equal(fs.existsSync(relOwnedLink), false);

      // Legacy marker migration: valid SKILL.md name passes; mismatched SKILL.md name refused
      const legacyDir = path.join(sharedTarget, "using-github-convention");
      fs.mkdirSync(legacyDir, { recursive: true });
      fs.writeFileSync(path.join(legacyDir, ".github-convention-script-managed"), "managed-by=install.sh\n");
      fs.writeFileSync(path.join(legacyDir, "SKILL.md"), "---\nname: wrong-skill\n---\n");
      const legacyMismatch = runScript(UNINSTALL_SH, ["--target", sharedTarget]);
      assert.notEqual(legacyMismatch.status, 0);

      fs.writeFileSync(path.join(legacyDir, "SKILL.md"), "---\nname: using-github-convention\n---\n");
      const legacyUninstall = runScript(UNINSTALL_SH, ["--target", sharedTarget]);
      assert.equal(legacyUninstall.status, 0, legacyUninstall.stderr);
      assert.equal(fs.existsSync(legacyDir), false);

      // Project + Global mixed scope isolation
      const projInstall = runScript(INSTALL_SH, ["--scope", "project"], {
        cwd: projDir,
        env: { HOME: homeDir },
      });
      assert.equal(projInstall.status, 0, projInstall.stderr);

      const globalInstall = runScript(INSTALL_SH, ["--scope", "global", "--copy"], {
        cwd: projDir,
        env: { HOME: homeDir },
      });
      assert.equal(globalInstall.status, 0, globalInstall.stderr);

      // Uninstall project -> global remains intact
      const projUninstall = runScript(UNINSTALL_SH, ["--scope", "project"], {
        cwd: projDir,
        env: { HOME: homeDir },
      });
      assert.equal(projUninstall.status, 0, projUninstall.stderr);
      assert.equal(
        fs.existsSync(path.join(projDir, ".agents", "skills", "using-github-convention")),
        false,
      );
      assert.equal(
        fs.existsSync(path.join(homeDir, ".agents", "skills", "using-github-convention", "SKILL.md")),
        true,
      );

      // Uninstall global cleanly
      const globalUninstall = runScript(UNINSTALL_SH, ["--scope", "global"], {
        cwd: projDir,
        env: { HOME: homeDir },
      });
      assert.equal(globalUninstall.status, 0, globalUninstall.stderr);
      assert.equal(
        fs.existsSync(path.join(homeDir, ".agents", "skills", "using-github-convention")),
        false,
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  },
);
