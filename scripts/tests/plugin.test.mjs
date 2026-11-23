import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildPrMergeCommand,
  classifyCiStatus,
  evaluateBashCommand,
  evaluateConflictResolution,
  readGithubConfig,
  resolveMergeMethod,
} from "../../hooks/guard-bash.mjs";
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

  // 4. Env-prefix / wrapper bypasses & protected branch deletion blocked
  assert.equal(
    evaluateBashCommand("FOO=1 git push --force origin feat/1-test", {
      currentBranch: "feat/1-test",
      defaultBranch: "main",
    }).decision,
    "deny",
  );
  assert.equal(
    evaluateBashCommand("env FOO=1 git push origin main", {
      currentBranch: "feat/1-test",
      defaultBranch: "main",
    }).decision,
    "deny",
  );
  assert.equal(
    evaluateBashCommand('GITHUB_CONVENTION_ALLOW_NO_VERIFY=1 git commit --no-verify -m "fix: x"', {
      stagedDiff: "",
      env: {},
    }).decision,
    "deny",
  );
  assert.equal(
    evaluateBashCommand("git push --delete origin main", {
      currentBranch: "feat/1-test",
      defaultBranch: "main",
    }).decision,
    "deny",
  );
  assert.equal(
    evaluateBashCommand("git push origin :main", {
      currentBranch: "feat/1-test",
      defaultBranch: "main",
    }).decision,
    "deny",
  );

  // 5. Staged secret blocked and redacted
  const fakeAwsKey = "AKIA" + "0123456789ABCDEF";
  const secretResult = evaluateBashCommand('git commit -m "chore: config"', {
    stagedDiff: `+++ b/.env\n+AWS_KEY=${fakeAwsKey}\n`,
  });
  assert.equal(secretResult.decision, "deny");
  assert.match(secretResult.reason, /AKIA\*\*\*\*/);
  assert.equal(secretResult.reason.includes(fakeAwsKey), false);
});

test("7.1 CI status classification (6 states) and auto-merge policy matrix (16 required cases) + merge_method config", () => {
  // 1. All CI checks pass -> PASS -> allow
  const passState = {
    ok: true,
    isDraft: false,
    state: "OPEN",
    mergeable: "MERGEABLE",
    checks: [
      { name: "CI/verify (ubuntu)", status: "COMPLETED", conclusion: "SUCCESS" },
      { name: "CI/verify (macos)", status: "COMPLETED", conclusion: "SKIPPED" },
    ],
  };
  assert.equal(classifyCiStatus(passState).status, "PASS");
  const r1 = evaluateBashCommand("gh pr merge 42 --squash --delete-branch", { prState: passState });
  assert.equal(r1.decision, "allow");
  assert.equal(r1.ciStatus, "PASS");

  // 2. Project with no tests -> NO_TESTS -> allow
  const noTestsState = {
    ok: true,
    isDraft: false,
    state: "OPEN",
    mergeable: "MERGEABLE",
    checks: [],
  };
  assert.equal(classifyCiStatus(noTestsState).status, "NO_TESTS");
  const r2 = evaluateBashCommand("gh pr merge 42 --squash --delete-branch", { prState: noTestsState });
  assert.equal(r2.decision, "allow");
  assert.equal(r2.ciStatus, "NO_TESTS");

  // 3. GitHub Actions quota / billing limit exceeded -> UNAVAILABLE -> allow
  const quotaExceededState = {
    ok: true,
    isDraft: false,
    state: "OPEN",
    mergeable: "MERGEABLE",
    checks: [
      {
        name: "CI/verify",
        status: "COMPLETED",
        conclusion: "FAILURE",
        steps: [],
        annotations: [
          {
            message:
              "The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings",
          },
        ],
      },
    ],
  };
  assert.equal(classifyCiStatus(quotaExceededState).status, "UNAVAILABLE");
  const r3 = evaluateBashCommand("gh pr merge 42 --squash --delete-branch", {
    prState: quotaExceededState,
  });
  assert.equal(r3.decision, "allow");
  assert.equal(r3.ciStatus, "UNAVAILABLE");

  // 4. CI disabled in repository -> UNAVAILABLE -> allow
  const ciDisabledState = {
    ok: true,
    isDraft: false,
    state: "OPEN",
    mergeable: "MERGEABLE",
    actionsDisabled: true,
    ciUnavailableReason: "GitHub Actions is disabled for this repository.",
    checks: [],
  };
  assert.equal(classifyCiStatus(ciDisabledState).status, "UNAVAILABLE");
  const r4 = evaluateBashCommand("gh pr merge 42 --squash --delete-branch", {
    prState: ciDisabledState,
  });
  assert.equal(r4.decision, "allow");
  assert.equal(r4.ciStatus, "UNAVAILABLE");

  // 5. Test failure -> FAIL -> deny (and real test failure with executed steps is NEVER misclassified as UNAVAILABLE)
  const failState = {
    ok: true,
    isDraft: false,
    state: "OPEN",
    mergeable: "MERGEABLE",
    checks: [
      {
        name: "CI/unit-test",
        status: "COMPLETED",
        conclusion: "FAILURE",
        steps: [{ name: "Run tests", conclusion: "failure" }],
      },
    ],
  };
  assert.equal(classifyCiStatus(failState).status, "FAIL");
  const r5 = evaluateBashCommand("gh pr merge 42 --squash --delete-branch", { prState: failState });
  assert.equal(r5.decision, "deny");
  assert.equal(r5.ciStatus, "FAIL");

  // 6. Test in progress -> PENDING -> wait (deny merge, even when `--auto` is supplied!)
  const pendingState = {
    ok: true,
    isDraft: false,
    state: "OPEN",
    mergeable: "MERGEABLE",
    checks: [{ name: "CI/verify", status: "IN_PROGRESS", conclusion: "" }],
  };
  assert.equal(classifyCiStatus(pendingState).status, "PENDING");
  const r6 = evaluateBashCommand("gh pr merge 42 --squash", { prState: pendingState });
  assert.equal(r6.decision, "deny");
  assert.equal(r6.ciStatus, "PENDING");
  const r6AutoBypassAttempt = evaluateBashCommand("gh pr merge 42 --auto --squash", {
    prState: pendingState,
  });
  assert.equal(r6AutoBypassAttempt.decision, "deny");
  assert.equal(r6AutoBypassAttempt.ciStatus, "PENDING");

  // 7. Some checks pass, some checks in progress -> PENDING -> wait (deny merge)
  const partialPendingState = {
    ok: true,
    isDraft: false,
    state: "OPEN",
    mergeable: "MERGEABLE",
    checks: [
      { name: "CI/lint", status: "COMPLETED", conclusion: "SUCCESS" },
      { name: "CI/e2e", status: "QUEUED", conclusion: "" },
    ],
  };
  assert.equal(classifyCiStatus(partialPendingState).status, "PENDING");
  const r7 = evaluateBashCommand("gh pr merge 42 --squash", { prState: partialPendingState });
  assert.equal(r7.decision, "deny");
  assert.equal(r7.ciStatus, "PENDING");

  // 8. Some checks pass, some checks fail -> FAIL -> block
  const partialFailState = {
    ok: true,
    isDraft: false,
    state: "OPEN",
    mergeable: "MERGEABLE",
    checks: [
      { name: "CI/lint", status: "COMPLETED", conclusion: "SUCCESS" },
      { name: "CI/test", status: "COMPLETED", conclusion: "FAILURE" },
    ],
  };
  assert.equal(classifyCiStatus(partialFailState).status, "FAIL");
  const r8 = evaluateBashCommand("gh pr merge 42 --squash", { prState: partialFailState });
  assert.equal(r8.decision, "deny");
  assert.equal(r8.ciStatus, "FAIL");

  // 9. CI query failure -> UNKNOWN (distinguished from UNAVAILABLE) -> block, while still honoring any confirmed FAIL
  const ciQueryFailState = {
    ok: true,
    isDraft: false,
    state: "OPEN",
    mergeable: "MERGEABLE",
    ciQueryFailed: true,
    checks: null,
  };
  assert.equal(classifyCiStatus(ciQueryFailState).status, "UNKNOWN");
  assert.notEqual(classifyCiStatus(ciQueryFailState).status, "UNAVAILABLE");
  const r9 = evaluateBashCommand("gh pr merge 42 --squash", { prState: ciQueryFailState });
  assert.equal(r9.decision, "deny");
  assert.equal(r9.ciStatus, "UNKNOWN");

  // Even when ciQueryFailed=true, a confirmed failing check still takes priority as FAIL
  const ciQueryFailWithRealFailure = {
    ok: true,
    isDraft: false,
    state: "OPEN",
    ciQueryFailed: true,
    checks: [{ name: "CI/unit", status: "COMPLETED", conclusion: "FAILURE" }],
  };
  assert.equal(classifyCiStatus(ciQueryFailWithRealFailure).status, "FAIL");

  // 10. PR status query failure -> block
  const prQueryFailState = { ok: false };
  const r10 = evaluateBashCommand("gh pr merge 42 --squash", { prState: prQueryFailState });
  assert.equal(r10.decision, "deny");
  assert.match(r10.reason, /could not verify PR state/);

  // 11. Draft PR -> block
  const draftState = {
    ok: true,
    isDraft: true,
    state: "OPEN",
    checks: [{ name: "CI/verify", status: "COMPLETED", conclusion: "SUCCESS" }],
  };
  const r11 = evaluateBashCommand("gh pr merge 42 --squash", { prState: draftState });
  assert.equal(r11.decision, "deny");
  assert.equal(r11.ciStatus, "DRAFT");

  // 12. Closed PR -> block
  const closedState = {
    ok: true,
    isDraft: false,
    state: "CLOSED",
    checks: [{ name: "CI/verify", status: "COMPLETED", conclusion: "SUCCESS" }],
  };
  const r12 = evaluateBashCommand("gh pr merge 42 --squash", { prState: closedState });
  assert.equal(r12.decision, "deny");
  assert.equal(r12.ciStatus, "CLOSED");
  assert.match(r12.reason, /CLOSED/);

  // 13. Already merged PR -> terminated handling
  const mergedState = {
    ok: true,
    isDraft: false,
    state: "MERGED",
    checks: [{ name: "CI/verify", status: "COMPLETED", conclusion: "SUCCESS" }],
  };
  const r13 = evaluateBashCommand("gh pr merge 42 --squash", { prState: mergedState });
  assert.equal(r13.decision, "deny");
  assert.equal(r13.ciStatus, "MERGED");
  assert.match(r13.reason, /Terminated: PR is already MERGED/);

  // 14. --admin -> block
  const r14 = evaluateBashCommand("gh pr merge 42 --admin --squash", { prState: passState });
  assert.equal(r14.decision, "deny");
  assert.equal(r14.ciStatus, "FORBIDDEN_ADMIN");

  // 15. Merge bypass via `gh api` -> block
  assert.equal(
    evaluateBashCommand("gh api repos/owner/repo/pulls/1/merge -X PUT").decision,
    "deny",
  );
  assert.equal(
    evaluateBashCommand('gh api graphql -f query="mutation { mergePullRequest }"').decision,
    "deny",
  );
  assert.equal(evaluateBashCommand("gh api repos/owner/repo/pulls/1").decision, "allow");

  // 16. auto_merge_on_ci_pass: false -> block auto merge
  const r16 = evaluateBashCommand("gh pr merge 42 --squash", {
    autoMergeOnCiPass: false,
    prState: passState,
  });
  assert.equal(r16.decision, "deny");
  assert.equal(r16.ciStatus, "DISABLED");

  // merge_method configuration (`squash`, `merge`, `rebase`, invalid/missing fallback to `squash`, repo allowed methods)
  assert.equal(resolveMergeMethod("squash"), "squash");
  assert.equal(resolveMergeMethod("merge"), "merge");
  assert.equal(resolveMergeMethod("rebase"), "rebase");
  assert.equal(resolveMergeMethod("invalid-method"), "squash");
  assert.equal(resolveMergeMethod(undefined), "squash");
  assert.equal(resolveMergeMethod("rebase", ["squash", "merge"]), "squash");
  assert.equal(resolveMergeMethod("squash", ["merge", "rebase"]), "merge");

  assert.equal(
    buildPrMergeCommand(42, { mergeMethod: "squash" }),
    "gh pr merge 42 --squash --delete-branch",
  );
  assert.equal(
    buildPrMergeCommand(42, { mergeMethod: "merge" }),
    "gh pr merge 42 --merge --delete-branch",
  );
  assert.equal(
    buildPrMergeCommand(42, { mergeMethod: "rebase" }),
    "gh pr merge 42 --rebase --delete-branch",
  );
  assert.equal(
    buildPrMergeCommand(42, { mergeMethod: "bogus" }),
    "gh pr merge 42 --squash --delete-branch",
  );

  const cfgDir = makeTempDir();
  try {
    fs.mkdirSync(path.join(cfgDir, ".git"));
    fs.mkdirSync(path.join(cfgDir, ".github-convention"));
    fs.writeFileSync(
      path.join(cfgDir, ".github-convention", "config.yaml"),
      "schema_version: 1\ngithub:\n  merge_method: rebase\n",
    );
    assert.equal(readGithubConfig(cfgDir).mergeMethod, "rebase");

    fs.writeFileSync(
      path.join(cfgDir, ".github-convention", "config.yaml"),
      "schema_version: 1\ngithub:\n  merge_method: unknown_value\n",
    );
    assert.equal(readGithubConfig(cfgDir).mergeMethod, "squash");
  } finally {
    fs.rmSync(cfgDir, { recursive: true, force: true });
  }
});

test("7.2 PR conflict resolution workflow & real git conflict resolution verification (7 required cases)", () => {
  const passCi = {
    ok: true,
    isDraft: false,
    state: "OPEN",
    mergeable: "MERGEABLE",
    checks: [{ name: "CI/test", status: "COMPLETED", conclusion: "SUCCESS" }],
  };
  const failCi = {
    ok: true,
    isDraft: false,
    state: "OPEN",
    mergeable: "MERGEABLE",
    checks: [{ name: "CI/test", status: "COMPLETED", conclusion: "FAILURE" }],
  };
  const pendingCi = {
    ok: true,
    isDraft: false,
    state: "OPEN",
    mergeable: "MERGEABLE",
    checks: [{ name: "CI/test", status: "IN_PROGRESS", conclusion: "" }],
  };
  const unavailableCi = {
    ok: true,
    isDraft: false,
    state: "OPEN",
    mergeable: "MERGEABLE",
    billingLimited: true,
    checks: [],
  };

  // Unresolved conflict on PR is blocked directly by evaluateBashCommand
  const conflictingPrState = {
    ...passCi,
    mergeable: "CONFLICTING",
    mergeStateStatus: "DIRTY",
  };
  const conflictMergeAttempt = evaluateBashCommand("gh pr merge 42 --squash", {
    prState: conflictingPrState,
  });
  assert.equal(conflictMergeAttempt.decision, "deny");
  assert.equal(conflictMergeAttempt.ciStatus, "CONFLICTING");

  // Case 1: Conflict-free PR -> normal merge flow
  const c1 = evaluateConflictResolution({
    hasConflicts: false,
    ciStateAfterResolution: passCi,
  });
  assert.equal(c1.action, "merge");
  assert.equal(c1.canMerge, true);
  assert.equal(c1.ciStatus, "PASS");

  // Case 2: Simple conflict -> resolved, verified in temporary git repo, and merged on new commit
  const tempGit = makeTempDir();
  try {
    const runG = (args) =>
      execFileSync("git", args, { cwd: tempGit, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    runG(["init", "--initial-branch=main"]);
    runG(["config", "user.name", "Test"]);
    runG(["config", "user.email", "test@example.com"]);
    fs.writeFileSync(path.join(tempGit, "app.txt"), "line1\nshared\nline3\n");
    runG(["add", "app.txt"]);
    runG(["commit", "-m", "chore: base"]);

    runG(["checkout", "-b", "feat/10-conflict"]);
    fs.writeFileSync(path.join(tempGit, "app.txt"), "line1\nfeature-change\nline3\n");
    runG(["commit", "-am", "feat: feature change (#10)"]);
    const oldHead = runG(["rev-parse", "HEAD"]);

    runG(["checkout", "main"]);
    fs.writeFileSync(path.join(tempGit, "app.txt"), "line1\nmain-upstream-change\nline3\n");
    runG(["commit", "-am", "feat: upstream change"]);

    runG(["checkout", "feat/10-conflict"]);
    let hadConflict = false;
    try {
      runG(["merge", "main"]);
    } catch {
      hadConflict = true;
    }
    assert.equal(hadConflict, true);

    // Resolve preserving both upstream and feature intent without git reset --hard or blind --ours/--theirs
    fs.writeFileSync(
      path.join(tempGit, "app.txt"),
      "line1\nmain-upstream-change\nfeature-change\nline3\n",
    );
    runG(["add", "app.txt"]);
    runG(["commit", "-m", "fix: resolve merge conflict with main (#10)"]);
    const newHead = runG(["rev-parse", "HEAD"]);
    assert.notEqual(newHead, oldHead);

    const resolvedContent = fs.readFileSync(path.join(tempGit, "app.txt"), "utf8");
    const preservedBoth =
      resolvedContent.includes("main-upstream-change") &&
      resolvedContent.includes("feature-change");

    const c2 = evaluateConflictResolution({
      hasConflicts: true,
      conflictType: "simple",
      resolved: true,
      preservedChanges: preservedBoth,
      withinIssueScope: true,
      headCommitUpdated: newHead !== oldHead,
      localChecksPassed: true,
      ciStateAfterResolution: passCi,
    });
    assert.equal(c2.action, "merge");
    assert.equal(c2.canMerge, true);
    assert.equal(c2.ciStatus, "PASS");
  } finally {
    fs.rmSync(tempGit, { recursive: true, force: true });
  }

  // Case 3: Test failure after conflict resolution -> block merge
  const c3 = evaluateConflictResolution({
    hasConflicts: true,
    conflictType: "simple",
    resolved: true,
    preservedChanges: true,
    withinIssueScope: true,
    headCommitUpdated: true,
    localChecksPassed: true,
    ciStateAfterResolution: failCi,
  });
  assert.equal(c3.action, "block");
  assert.equal(c3.canMerge, false);
  assert.equal(c3.ciStatus, "FAIL");

  // Case 4: CI still running on new conflict-resolution commit -> wait
  const c4 = evaluateConflictResolution({
    hasConflicts: true,
    conflictType: "simple",
    resolved: true,
    preservedChanges: true,
    withinIssueScope: true,
    headCommitUpdated: true,
    localChecksPassed: true,
    ciStateAfterResolution: pendingCi,
  });
  assert.equal(c4.action, "wait");
  assert.equal(c4.canMerge, false);
  assert.equal(c4.ciStatus, "PENDING");

  // Case 5: CI unavailable on new conflict-resolution commit (after local checks pass) -> allow merge per policy
  const c5 = evaluateConflictResolution({
    hasConflicts: true,
    conflictType: "simple",
    resolved: true,
    preservedChanges: true,
    withinIssueScope: true,
    headCommitUpdated: true,
    localChecksPassed: true,
    ciStateAfterResolution: unavailableCi,
  });
  assert.equal(c5.action, "merge");
  assert.equal(c5.canMerge, true);
  assert.equal(c5.ciStatus, "UNAVAILABLE");

  // Case 6: Existing changes or Issue requirements lost during conflict resolution -> block
  const c6 = evaluateConflictResolution({
    hasConflicts: true,
    conflictType: "simple",
    resolved: true,
    preservedChanges: false,
    withinIssueScope: true,
    headCommitUpdated: true,
    localChecksPassed: true,
    ciStateAfterResolution: passCi,
  });
  assert.equal(c6.action, "block");
  assert.equal(c6.canMerge, false);
  assert.match(c6.reason, /lost existing branch changes/);

  // Case 7: Complex / design conflict -> ask user for confirmation
  const c7 = evaluateConflictResolution({
    hasConflicts: true,
    conflictType: "complex",
    resolved: false,
  });
  assert.equal(c7.action, "ask_user");
  assert.equal(c7.canMerge, false);
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
