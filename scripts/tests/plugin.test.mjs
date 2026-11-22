import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { evaluateBashCommand } from "../../hooks/guard-bash.mjs";
import { buildSessionStartPayload } from "../../hooks/session-start.mjs";
import { gardenRepo } from "../garden.mjs";
import { REPO_ROOT, validateRepo } from "../validate.mjs";

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "gh-conv-test-"));

test("buildSessionStartPayload returns null outside git repos and without config.yaml", () => {
  const dir = makeTempDir();
  try {
    const payload = buildSessionStartPayload({ cwd: dir, env: {}, pluginRoot: REPO_ROOT });
    assert.equal(payload, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("buildSessionStartPayload activates in zero-config git repos and formats per platform", () => {
  const dir = makeTempDir();
  try {
    fs.mkdirSync(path.join(dir, ".git"));

    const claudePayload = buildSessionStartPayload({
      cwd: dir,
      env: { CLAUDE_PLUGIN_ROOT: REPO_ROOT },
      pluginRoot: REPO_ROOT,
    });
    assert.equal(claudePayload.hookSpecificOutput.hookEventName, "SessionStart");
    assert.match(claudePayload.hookSpecificOutput.additionalContext, /zero-config git repository/);
    assert.match(claudePayload.hookSpecificOutput.additionalContext, /using-github-convention/);

    const cursorPayload = buildSessionStartPayload({
      cwd: dir,
      env: { CURSOR_PLUGIN_ROOT: REPO_ROOT },
      pluginRoot: REPO_ROOT,
    });
    assert.ok(typeof cursorPayload.additional_context === "string");

    fs.mkdirSync(path.join(dir, ".github-convention"));
    fs.writeFileSync(path.join(dir, ".github-convention", "config.yaml"), "schema_version: 1\n");
    const defaultPayload = buildSessionStartPayload({
      cwd: dir,
      env: {},
      pluginRoot: REPO_ROOT,
    });
    assert.match(defaultPayload.additionalContext, /config\.yaml detected/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("evaluateBashCommand blocks unsafe invariants and allows safe operations", () => {
  // 1. Plain --force / -f blocked; --force-with-lease on feature branch allowed
  assert.equal(
    evaluateBashCommand("git push --force origin feat/1-test", {
      currentBranch: "feat/1-test",
      defaultBranch: "main",
    }).decision,
    "deny",
  );
  assert.equal(
    evaluateBashCommand("git push -fu origin feat/1-test", {
      currentBranch: "feat/1-test",
      defaultBranch: "main",
    }).decision,
    "deny",
  );
  assert.equal(
    evaluateBashCommand("git push --force-with-lease origin feat/1-test", {
      currentBranch: "feat/1-test",
      defaultBranch: "main",
    }).decision,
    "allow",
  );

  // 2. Direct push to default branch blocked; feature branch allowed
  assert.equal(
    evaluateBashCommand("git push origin main", {
      currentBranch: "feat/1-test",
      defaultBranch: "main",
    }).decision,
    "deny",
  );
  assert.equal(
    evaluateBashCommand("git push", {
      currentBranch: "main",
      defaultBranch: "main",
    }).decision,
    "deny",
  );
  assert.equal(
    evaluateBashCommand("git push -u origin feat/1-test", {
      currentBranch: "feat/1-test",
      defaultBranch: "main",
    }).decision,
    "allow",
  );

  // 3. --no-verify / -n blocked unless GITHUB_CONVENTION_ALLOW_NO_VERIFY=1
  assert.equal(
    evaluateBashCommand('git commit --no-verify -m "fix: test"', {
      stagedDiff: "",
      env: {},
    }).decision,
    "deny",
  );
  assert.equal(
    evaluateBashCommand('git commit -n -m "fix: test"', {
      stagedDiff: "",
      env: {},
    }).decision,
    "deny",
  );
  assert.equal(
    evaluateBashCommand('git commit --no-verify -m "fix: test"', {
      stagedDiff: "",
      env: { GITHUB_CONVENTION_ALLOW_NO_VERIFY: "1" },
    }).decision,
    "allow",
  );

  // 4. gh pr merge blocked; gh issue create / gh release create allowed
  assert.equal(evaluateBashCommand("gh pr merge 42 --squash").decision, "deny");
  assert.equal(evaluateBashCommand('gh issue create --title "feat: test"').decision, "allow");
  assert.equal(evaluateBashCommand("gh release create v0.2.0").decision, "allow");

  // 5. Staged secret blocked and redacted
  const fakeAwsKey = "AKIA" + "0123456789ABCDEF";
  const secretResult = evaluateBashCommand('git commit -m "chore: config"', {
    stagedDiff: `+++ b/.env\n+AWS_KEY=${fakeAwsKey}\n`,
  });
  assert.equal(secretResult.decision, "deny");
  assert.match(secretResult.reason, /AKIA\*\*\*\*/);
  assert.equal(secretResult.reason.includes(fakeAwsKey), false);
});

test("validateRepo and gardenRepo pass on live repository", () => {
  const validation = validateRepo(REPO_ROOT);
  assert.equal(validation.skills, 6);
  assert.equal(validation.agents, 3);
  assert.equal(validation.commands, 5);

  const garden = gardenRepo(REPO_ROOT);
  assert.equal(garden.ok, true, garden.issues.join("\n"));
});

test(
  "install.sh and uninstall.sh manage all 6 skills cleanly",
  { skip: process.platform === "win32" },
  () => {
    const tempDir = makeTempDir();
    const targetDir = path.join(tempDir, ".agents", "skills");
    try {
      const dryRunOut = execFileSync(
        "sh",
        [path.join(REPO_ROOT, "install.sh"), "--target", targetDir, "--dry-run"],
        { encoding: "utf8" },
      );
      assert.match(dryRunOut, /using-github-convention/);
      assert.equal(fs.existsSync(targetDir), false);

      execFileSync(
        "sh",
        [path.join(REPO_ROOT, "install.sh"), "--target", targetDir, "--copy"],
        { encoding: "utf8" },
      );
      assert.equal(fs.existsSync(path.join(targetDir, "using-github-convention", "SKILL.md")), true);
      assert.equal(fs.existsSync(path.join(targetDir, "git-pr-workflow", "SKILL.md")), true);

      execFileSync("sh", [path.join(REPO_ROOT, "uninstall.sh"), "--target", targetDir], {
        encoding: "utf8",
      });
      assert.equal(fs.existsSync(path.join(targetDir, "using-github-convention")), false);
      assert.equal(fs.existsSync(path.join(targetDir, "git-pr-workflow")), false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  },
);
