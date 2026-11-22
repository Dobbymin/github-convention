import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { REPO_ROOT } from "../validate.mjs";

const SESSION_HOOK = path.join(REPO_ROOT, "hooks", "session-start.mjs");
const GUARD_HOOK = path.join(REPO_ROOT, "hooks", "guard-bash.mjs");

const makeTempDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

const runGit = (args, cwd) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const runSessionHook = ({ cwd, env = {} }) =>
  spawnSync(process.execPath, [SESSION_HOOK], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });

const runGuardHook = ({ command, cwd, env = {} }) => {
  const payload = JSON.stringify({
    tool_name: "Bash",
    tool_input: { command },
    cwd,
  });
  return spawnSync(process.execPath, [GUARD_HOOK], {
    cwd,
    input: payload,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
};

const setupTempGitRepoWithOrigin = () => {
  const root = makeTempDir("gh-conv-e2e-");
  const bareDir = path.join(root, "origin.git");
  const workDir = path.join(root, "work");

  fs.mkdirSync(bareDir, { recursive: true });
  runGit(["init", "--bare", "--initial-branch=main", bareDir], root);
  runGit(["clone", bareDir, workDir], root);
  runGit(["config", "user.name", "Test User"], workDir);
  runGit(["config", "user.email", "test@example.com"], workDir);
  runGit(["checkout", "-b", "main"], workDir);
  fs.writeFileSync(path.join(workDir, "README.md"), "# test\n");
  runGit(["add", "README.md"], workDir);
  runGit(["commit", "-m", "chore: init"], workDir);
  runGit(["push", "-u", "origin", "main"], workDir);
  runGit(["remote", "set-head", "origin", "main"], workDir);

  return { root, bareDir, workDir };
};

test("session-start.mjs subprocess handles non-git, zero-config git, and config.yaml repos", () => {
  const nonGitDir = makeTempDir("gh-conv-nongit-");
  try {
    const res = runSessionHook({ cwd: nonGitDir, env: { CLAUDE_PLUGIN_ROOT: REPO_ROOT } });
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), "");
  } finally {
    fs.rmSync(nonGitDir, { recursive: true, force: true });
  }

  const { root, workDir } = setupTempGitRepoWithOrigin();
  try {
    const claudeRes = runSessionHook({
      cwd: workDir,
      env: { CLAUDE_PLUGIN_ROOT: REPO_ROOT, CURSOR_PLUGIN_ROOT: "", COPILOT_CLI: "" },
    });
    assert.equal(claudeRes.status, 0);
    const claudeJson = JSON.parse(claudeRes.stdout);
    assert.equal(claudeJson.hookSpecificOutput.hookEventName, "SessionStart");
    assert.match(
      claudeJson.hookSpecificOutput.additionalContext,
      /zero-config git repository detected/,
    );
    assert.match(claudeJson.hookSpecificOutput.additionalContext, /using-github-convention/);

    const cursorRes = runSessionHook({
      cwd: workDir,
      env: { CURSOR_PLUGIN_ROOT: REPO_ROOT, CLAUDE_PLUGIN_ROOT: "" },
    });
    assert.equal(cursorRes.status, 0);
    const cursorJson = JSON.parse(cursorRes.stdout);
    assert.match(cursorJson.additional_context, /zero-config git repository detected/);

    fs.mkdirSync(path.join(workDir, ".github-convention"), { recursive: true });
    fs.writeFileSync(path.join(workDir, ".github-convention", "config.yaml"), "schema_version: 1\n");
    const cfgRes = runSessionHook({
      cwd: workDir,
      env: { CLAUDE_PLUGIN_ROOT: "", CURSOR_PLUGIN_ROOT: "" },
    });
    assert.equal(cfgRes.status, 0);
    const cfgJson = JSON.parse(cfgRes.stdout);
    assert.match(cfgJson.additionalContext, /config\.yaml detected/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("guard-bash.mjs subprocess enforces invariants against a real git repository", () => {
  const { root, workDir } = setupTempGitRepoWithOrigin();
  try {
    // 1. Bare push on main is denied using live git branch + origin/HEAD detection
    const mainPush = runGuardHook({ command: "git push", cwd: workDir });
    assert.equal(mainPush.status, 0);
    const mainDeny = JSON.parse(mainPush.stdout);
    assert.equal(mainDeny.hookSpecificOutput.permissionDecision, "deny");
    assert.match(mainDeny.hookSpecificOutput.permissionDecisionReason, /default branch/);

    // Switch to feature branch
    runGit(["checkout", "-b", "feat/1-e2e"], workDir);

    // 2. Feature branch push is allowed (empty stdout)
    const featPush = runGuardHook({ command: "git push -u origin feat/1-e2e", cwd: workDir });
    assert.equal(featPush.status, 0);
    assert.equal(featPush.stdout.trim(), "");

    // 3. Plain --force and chained -f are denied; --force-with-lease is allowed
    for (const cmd of [
      "git push --force origin feat/1-e2e",
      "echo ok && git push -f origin feat/1-e2e",
      "git push origin HEAD:main",
      "gh pr merge 1 --squash",
    ]) {
      const res = runGuardHook({ command: cmd, cwd: workDir });
      assert.equal(res.status, 0);
      const parsed = JSON.parse(res.stdout);
      assert.equal(parsed.hookSpecificOutput.permissionDecision, "deny", `Expected deny for: ${cmd}`);
    }

    const leasePush = runGuardHook({
      command: "git push --force-with-lease origin feat/1-e2e",
      cwd: workDir,
    });
    assert.equal(leasePush.status, 0);
    assert.equal(leasePush.stdout.trim(), "");

    // 4. --no-verify is denied unless GITHUB_CONVENTION_ALLOW_NO_VERIFY=1
    const noVerifyDeny = runGuardHook({
      command: 'git commit --no-verify -m "chore: skip"',
      cwd: workDir,
      env: { GITHUB_CONVENTION_ALLOW_NO_VERIFY: "" },
    });
    assert.equal(
      JSON.parse(noVerifyDeny.stdout).hookSpecificOutput.permissionDecision,
      "deny",
    );

    const noVerifyAllow = runGuardHook({
      command: 'git commit --no-verify -m "chore: diagnosed"',
      cwd: workDir,
      env: { GITHUB_CONVENTION_ALLOW_NO_VERIFY: "1" },
    });
    assert.equal(noVerifyAllow.stdout.trim(), "");

    // 5. Real staged secret via `git diff --cached` is blocked and redacted
    const fakeGhToken = "ghp_" + "A".repeat(36);
    fs.writeFileSync(path.join(workDir, ".env.test"), `GH_TOKEN=${fakeGhToken}\n`);
    runGit(["add", ".env.test"], workDir);

    const secretCommit = runGuardHook({
      command: 'git commit -m "chore: add token"',
      cwd: workDir,
    });
    assert.equal(secretCommit.status, 0);
    const secretDeny = JSON.parse(secretCommit.stdout);
    assert.equal(secretDeny.hookSpecificOutput.permissionDecision, "deny");
    assert.match(secretDeny.hookSpecificOutput.permissionDecisionReason, /ghp_\*\*\*\*/);
    assert.equal(
      secretDeny.hookSpecificOutput.permissionDecisionReason.includes(fakeGhToken),
      false,
    );

    // Replace with clean file -> commit allowed
    runGit(["reset", "HEAD", ".env.test"], workDir);
    fs.rmSync(path.join(workDir, ".env.test"));
    fs.writeFileSync(path.join(workDir, "feature.txt"), "hello\n");
    runGit(["add", "feature.txt"], workDir);

    const cleanCommit = runGuardHook({
      command: 'git commit -m "feat: add feature"',
      cwd: workDir,
    });
    assert.equal(cleanCommit.status, 0);
    assert.equal(cleanCommit.stdout.trim(), "");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
