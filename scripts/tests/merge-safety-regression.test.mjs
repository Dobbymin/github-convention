import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  classifyCiStatus,
  evaluateBashCommand,
  evaluateConflictResolution,
  extractActionsJobFromUrl,
  extractCheckRunFromUrl,
  inspectCheckRunUnavailableViaGh,
  resolveEffectiveMergeMethod,
} from "../../hooks/guard-bash.mjs";
import { REPO_ROOT } from "../validate.mjs";

const GUARD_HOOK = path.join(REPO_ROOT, "hooks", "guard-bash.mjs");
const makeTempDir = (prefix = "gh-conv-reg-") => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

// =============================================================================
// 1. Unit / Mock Tests — Defect A: Check Run ID vs Actions Job ID Lookup
// =============================================================================

test("Defect A (Unit/Mock): distinguishes Check Run ID from Job ID, refuses guessing, and classifies API errors safely", () => {
  assert.deepEqual(
    extractActionsJobFromUrl("https://github.com/Dobbymin/github-convention/actions/runs/111/job/222"),
    { repoSlug: "Dobbymin/github-convention", jobId: "222" },
  );
  assert.deepEqual(
    extractCheckRunFromUrl("https://api.github.com/repos/Dobbymin/github-convention/check-runs/999999"),
    { repoSlug: "Dobbymin/github-convention", checkRunId: "999999" },
  );

  // Case A1: Job ID (1001) != Check Run ID (9002) + billing limit -> uses Check Run ID 9002, never 1001
  const calledEndpointsA1 = [];
  const resA1 = inspectCheckRunUnavailableViaGh(
    {
      name: "verify",
      conclusion: "FAILURE",
      detailsUrl: "https://github.com/owner/repo/actions/runs/555/job/1001",
    },
    {
      ghApi: (endpoint) => {
        calledEndpointsA1.push(endpoint);
        if (endpoint === "repos/owner/repo/actions/jobs/1001") {
          return {
            ok: true,
            statusCode: 200,
            body: JSON.stringify({
              id: 1001,
              check_run_url: "https://api.github.com/repos/owner/repo/check-runs/9002",
              steps: [],
            }),
            stderr: "",
            errorKind: null,
          };
        }
        if (endpoint === "repos/owner/repo/check-runs/9002/annotations") {
          return {
            ok: true,
            statusCode: 200,
            body: JSON.stringify([
              {
                title: "",
                message:
                  "The job was not started because recent account payments have failed or your spending limit needs to be increased.",
              },
            ]),
            stderr: "",
            errorKind: null,
          };
        }
        throw new Error(`Unexpected endpoint: ${endpoint}`);
      },
    },
  );
  assert.equal(resA1.status, "unavailable");
  assert.equal(resA1.checkRunId, "9002");
  assert.deepEqual(calledEndpointsA1, [
    "repos/owner/repo/actions/jobs/1001",
    "repos/owner/repo/check-runs/9002/annotations",
  ]);
  assert.equal(calledEndpointsA1.includes("repos/owner/repo/check-runs/1001/annotations"), false);

  // Case A2: Normal Check Run lookup (job ran steps & failed) -> status: "failed"
  const resA2 = inspectCheckRunUnavailableViaGh(
    {
      name: "verify",
      conclusion: "FAILURE",
      detailsUrl: "https://github.com/owner/repo/actions/runs/555/job/1002",
    },
    {
      ghApi: (endpoint) => {
        if (endpoint === "repos/owner/repo/actions/jobs/1002") {
          return {
            ok: true,
            statusCode: 200,
            body: JSON.stringify({
              id: 1002,
              check_run_url: "https://api.github.com/repos/owner/repo/check-runs/9003",
              steps: [{ name: "npm test", conclusion: "failure" }],
            }),
            stderr: "",
            errorKind: null,
          };
        }
        throw new Error(`Unexpected endpoint: ${endpoint}`);
      },
    },
  );
  assert.equal(resA2.status, "failed");

  // Case A3: Missing check_run_url / Check Run ID -> refuses to guess using Job ID, returns lookup_error
  const calledEndpointsA3 = [];
  const resA3 = inspectCheckRunUnavailableViaGh(
    {
      name: "verify",
      conclusion: "FAILURE",
      detailsUrl: "https://github.com/owner/repo/actions/runs/555/job/1003",
    },
    {
      ghApi: (endpoint) => {
        calledEndpointsA3.push(endpoint);
        return {
          ok: true,
          statusCode: 200,
          body: JSON.stringify({ id: 1003, steps: [] }),
          stderr: "",
          errorKind: null,
        };
      },
    },
  );
  assert.equal(resA3.status, "lookup_error");
  assert.equal(resA3.errorKind, "missing_check_run_id");
  assert.equal(resA3.checkRunId, null);
  assert.deepEqual(calledEndpointsA3, ["repos/owner/repo/actions/jobs/1003"]);

  // Case A4: Actions quota / billing limit via HTTP 402/403 -> status: "unavailable"
  const resA4 = inspectCheckRunUnavailableViaGh(
    {
      name: "verify",
      conclusion: "FAILURE",
      detailsUrl: "https://github.com/owner/repo/actions/runs/555/job/1004",
    },
    {
      ghApi: () => ({
        ok: false,
        statusCode: 403,
        body: JSON.stringify({ message: "Actions is disabled or spending limit needs to be increased." }),
        stderr: "HTTP 403",
        errorKind: "api_error",
      }),
    },
  );
  assert.equal(resA4.status, "unavailable");

  // Case A5: API auth failure (HTTP 401 / non-billing 403) -> lookup_error (NEVER UNAVAILABLE)
  for (const statusCode of [401, 403]) {
    const resA5 = inspectCheckRunUnavailableViaGh(
      {
        name: "verify",
        conclusion: "FAILURE",
        detailsUrl: "https://github.com/owner/repo/actions/runs/555/job/1005",
      },
      {
        ghApi: () => ({
          ok: false,
          statusCode,
          body: JSON.stringify({ message: "Bad credentials" }),
          stderr: `HTTP ${statusCode} Bad credentials`,
          errorKind: "auth",
        }),
      },
    );
    assert.equal(resA5.status, "lookup_error");
    assert.equal(resA5.errorKind, "auth");
    assert.equal(resA5.httpStatus, statusCode);
  }

  // Case A6: Invalid Check Run ID (HTTP 404) -> lookup_error (NEVER UNAVAILABLE)
  const resA6 = inspectCheckRunUnavailableViaGh(
    {
      name: "verify",
      conclusion: "FAILURE",
      detailsUrl: "https://github.com/owner/repo/actions/runs/555/job/1006",
    },
    {
      ghApi: (endpoint) => {
        if (endpoint.includes("/actions/jobs/")) {
          return {
            ok: true,
            statusCode: 200,
            body: JSON.stringify({
              id: 1006,
              check_run_url: "https://api.github.com/repos/owner/repo/check-runs/404404",
              steps: [],
            }),
            stderr: "",
            errorKind: null,
          };
        }
        return {
          ok: false,
          statusCode: 404,
          body: JSON.stringify({ message: "Not Found" }),
          stderr: "HTTP 404 Not Found",
          errorKind: "not_found",
        };
      },
    },
  );
  assert.equal(resA6.status, "lookup_error");
  assert.equal(resA6.errorKind, "not_found");
  assert.equal(resA6.httpStatus, 404);

  // Case A7: General network error -> lookup_error (NEVER UNAVAILABLE)
  const resA7 = inspectCheckRunUnavailableViaGh(
    {
      name: "verify",
      conclusion: "FAILURE",
      detailsUrl: "https://github.com/owner/repo/actions/runs/555/job/1007",
    },
    {
      ghApi: () => ({
        ok: false,
        statusCode: null,
        body: "",
        stderr: "dial tcp: lookup api.github.com: no such host",
        errorKind: "network",
      }),
    },
  );
  assert.equal(resA7.status, "lookup_error");
  assert.equal(resA7.errorKind, "network");

  // Confirm classifyCiStatus classifies auth/network/404 lookup errors on FAILURE checks as FAIL, NOT UNAVAILABLE
  const prAuthErr = classifyCiStatus(
    {
      ok: true,
      checks: [
        {
          name: "verify",
          status: "COMPLETED",
          conclusion: "FAILURE",
          detailsUrl: "https://github.com/owner/repo/actions/runs/555/job/1005",
        },
      ],
    },
    {
      ghApi: () => ({
        ok: false,
        statusCode: 401,
        body: "Bad credentials",
        stderr: "HTTP 401",
        errorKind: "auth",
      }),
    },
  );
  assert.equal(prAuthErr.status, "FAIL");
  assert.equal(prAuthErr.lookupErrors.length, 1);
});

// =============================================================================
// 2. Unit / Mock Tests — Defect B: Mixed CI Status Classification Matrix
// =============================================================================

test("Defect B (Unit/Mock): enforces exact mixed CI status matrix and separates query failures from NO_TESTS/UNAVAILABLE", () => {
  const passCheck = { name: "check-pass", status: "COMPLETED", conclusion: "SUCCESS" };
  const failCheck = { name: "check-fail", status: "COMPLETED", conclusion: "FAILURE", steps: [{ name: "test" }] };
  const pendingCheck = { name: "check-pending", status: "IN_PROGRESS", conclusion: "" };
  const unavailCheck = {
    name: "check-unavail",
    status: "COMPLETED",
    conclusion: "FAILURE",
    steps: [],
    annotations: [{ message: "recent account payments have failed" }],
  };

  // 1. PASS + PASS -> PASS
  assert.equal(classifyCiStatus({ ok: true, checks: [passCheck, { ...passCheck, name: "p2" }] }).status, "PASS");
  // 2. PASS + FAIL -> FAIL
  assert.equal(classifyCiStatus({ ok: true, checks: [passCheck, failCheck] }).status, "FAIL");
  // 3. PASS + PENDING -> PENDING
  assert.equal(classifyCiStatus({ ok: true, checks: [passCheck, pendingCheck] }).status, "PENDING");
  // 4. PASS + UNAVAILABLE -> UNAVAILABLE (critical fix: was previously PASS!)
  assert.equal(classifyCiStatus({ ok: true, checks: [passCheck, unavailCheck] }).status, "UNAVAILABLE");
  // 5. FAIL + UNAVAILABLE -> FAIL
  assert.equal(classifyCiStatus({ ok: true, checks: [failCheck, unavailCheck] }).status, "FAIL");
  // 6. PENDING + UNAVAILABLE -> PENDING
  assert.equal(classifyCiStatus({ ok: true, checks: [pendingCheck, unavailCheck] }).status, "PENDING");
  // 7. UNAVAILABLE + UNAVAILABLE -> UNAVAILABLE
  assert.equal(
    classifyCiStatus({ ok: true, checks: [unavailCheck, { ...unavailCheck, name: "u2" }] }).status,
    "UNAVAILABLE",
  );
  // 8. NO_TESTS (explicitly no checks configured) -> NO_TESTS
  assert.equal(classifyCiStatus({ ok: true, checks: [] }).status, "NO_TESTS");
  // 9. Query failure / unknown state -> UNKNOWN (never UNAVAILABLE or NO_TESTS)
  const qFail1 = classifyCiStatus({ ok: true, ciQueryFailed: true, checks: null });
  assert.equal(qFail1.status, "UNKNOWN");
  assert.equal(qFail1.queryErrorType, "ci_query_failed");

  const qFail2 = classifyCiStatus({ ok: true, checks: undefined });
  assert.equal(qFail2.status, "UNKNOWN");

  // Configured checks exist, but empty list returned -> UNKNOWN (not blindly NO_TESTS)
  const missingExpected = classifyCiStatus({ ok: true, hasConfiguredChecks: true, checks: [] });
  assert.equal(missingExpected.status, "UNKNOWN");
  assert.equal(missingExpected.queryErrorType, "missing_expected_checks");

  // PR query failure vs CI query failure separation
  const prFail = classifyCiStatus({ ok: false, prQueryOk: false });
  assert.equal(prFail.status, "UNKNOWN");
  assert.equal(prFail.queryErrorType, "pr_query_failed");
});

// =============================================================================
// 3. Unit / Mock Tests — Defect C: evaluateConflictResolution Safe Defaults
// =============================================================================

test("Defect C (Unit/Mock): evaluateConflictResolution defaults missing/null CI to UNKNOWN and rejects stale commit SHA", () => {
  const passCi = {
    ok: true,
    headRefOid: "sha-new-222",
    checks: [{ name: "CI/test", status: "COMPLETED", conclusion: "SUCCESS" }],
  };
  const failCi = {
    ok: true,
    headRefOid: "sha-new-222",
    checks: [{ name: "CI/test", status: "COMPLETED", conclusion: "FAILURE" }],
  };
  const pendingCi = {
    ok: true,
    headRefOid: "sha-new-222",
    checks: [{ name: "CI/test", status: "IN_PROGRESS", conclusion: "" }],
  };

  // 1. Missing CI state (undefined) -> UNKNOWN & blocked
  const cMissing = evaluateConflictResolution({ hasConflicts: false });
  assert.equal(cMissing.ciStatus, "UNKNOWN");
  assert.equal(cMissing.canMerge, false);
  assert.equal(cMissing.action, "block");
  assert.equal(cMissing.conflictsCleared, true);

  // 2. Null CI state -> UNKNOWN & blocked (even when conflicts resolved)
  const cNull = evaluateConflictResolution({
    hasConflicts: true,
    resolved: true,
    headCommitUpdated: true,
    ciStateAfterResolution: null,
  });
  assert.equal(cNull.ciStatus, "UNKNOWN");
  assert.equal(cNull.canMerge, false);
  assert.equal(cNull.action, "block");
  assert.equal(cNull.conflictsCleared, true);

  // 3. No conflicts + CI PASS -> merge
  const cNoConflictPass = evaluateConflictResolution({
    hasConflicts: false,
    ciStateAfterResolution: passCi,
  });
  assert.equal(cNoConflictPass.action, "merge");
  assert.equal(cNoConflictPass.canMerge, true);
  assert.equal(cNoConflictPass.ciStatus, "PASS");

  // 4. No conflicts + CI UNKNOWN -> block (conflict-free != mergeable!)
  const cNoConflictUnknown = evaluateConflictResolution({
    hasConflicts: false,
    ciStateAfterResolution: { ok: true, ciQueryFailed: true, checks: null },
  });
  assert.equal(cNoConflictUnknown.conflictsCleared, true);
  assert.equal(cNoConflictUnknown.canMerge, false);
  assert.equal(cNoConflictUnknown.ciStatus, "UNKNOWN");
  assert.equal(cNoConflictUnknown.action, "block");

  // 5. Conflict resolved with new commit SHA + PASS -> merge
  const cNewCommitPass = evaluateConflictResolution({
    hasConflicts: true,
    conflictType: "simple",
    resolved: true,
    headCommitUpdated: true,
    previousHeadSha: "sha-old-111",
    newHeadSha: "sha-new-222",
    ciCommitSha: "sha-new-222",
    ciStateAfterResolution: passCi,
  });
  assert.equal(cNewCommitPass.action, "merge");
  assert.equal(cNewCommitPass.canMerge, true);
  assert.equal(cNewCommitPass.ciStatus, "PASS");

  // 6. Only previous commit SHA PASS result present -> block (UNKNOWN)
  const cStaleSha = evaluateConflictResolution({
    hasConflicts: true,
    conflictType: "simple",
    resolved: true,
    headCommitUpdated: true,
    previousHeadSha: "sha-old-111",
    newHeadSha: "sha-new-222",
    ciCommitSha: "sha-old-111",
    ciStateAfterResolution: {
      ok: true,
      headRefOid: "sha-old-111",
      checks: [{ name: "CI/test", status: "COMPLETED", conclusion: "SUCCESS" }],
    },
  });
  assert.equal(cStaleSha.canMerge, false);
  assert.equal(cStaleSha.ciStatus, "UNKNOWN");
  assert.equal(cStaleSha.action, "block");

  // 7. Conflict resolved + test FAIL -> block
  const cFail = evaluateConflictResolution({
    hasConflicts: true,
    conflictType: "simple",
    resolved: true,
    headCommitUpdated: true,
    previousHeadSha: "sha-old-111",
    newHeadSha: "sha-new-222",
    ciCommitSha: "sha-new-222",
    ciStateAfterResolution: failCi,
  });
  assert.equal(cFail.canMerge, false);
  assert.equal(cFail.ciStatus, "FAIL");
  assert.equal(cFail.action, "block");

  // 8. Conflict resolved + test PENDING -> wait
  const cPending = evaluateConflictResolution({
    hasConflicts: true,
    conflictType: "simple",
    resolved: true,
    headCommitUpdated: true,
    previousHeadSha: "sha-old-111",
    newHeadSha: "sha-new-222",
    ciCommitSha: "sha-new-222",
    ciStateAfterResolution: pendingCi,
  });
  assert.equal(cPending.canMerge, false);
  assert.equal(cPending.ciStatus, "PENDING");
  assert.equal(cPending.action, "wait");
});

// =============================================================================
// 4. Unit + Real Subprocess CLI Integration Tests — Defect D: Merge Paths & Precedence
// =============================================================================

test("Defect D (Unit): enforces identical safety policy across all merge commands and merge_method precedence", () => {
  const passState = {
    ok: true,
    prQueryOk: true,
    ciQueryOk: true,
    isDraft: false,
    state: "OPEN",
    mergeable: "MERGEABLE",
    checks: [{ name: "CI/verify", status: "COMPLETED", conclusion: "SUCCESS" }],
  };
  const pendingState = {
    ok: true,
    prQueryOk: true,
    ciQueryOk: true,
    isDraft: false,
    state: "OPEN",
    mergeable: "MERGEABLE",
    checks: [{ name: "CI/verify", status: "IN_PROGRESS", conclusion: "" }],
  };

  // All standard merge commands pass on PASS and block on PENDING (including --auto!)
  for (const cmd of [
    "gh pr merge",
    "gh pr merge --auto",
    "gh pr merge --squash",
    "gh pr merge --merge",
    "gh pr merge --rebase",
  ]) {
    assert.equal(evaluateBashCommand(cmd, { prState: passState }).decision, "allow", `Expected allow: ${cmd}`);
    const pendingRes = evaluateBashCommand(cmd, { prState: pendingState });
    assert.equal(pendingRes.decision, "deny", `Expected deny on PENDING: ${cmd}`);
    assert.equal(pendingRes.ciStatus, "PENDING");
  }

  assert.equal(evaluateBashCommand("gh pr merge --admin", { prState: passState }).decision, "deny");
  assert.equal(evaluateBashCommand("gh api repos/o/r/pulls/1/merge -X PUT").decision, "deny");

  // Precedence: repo allowedMethods > explicit project config > explicit CLI flag > default squash
  assert.deepEqual(
    resolveEffectiveMergeMethod({ cliMethods: [], configMethod: "squash", configExplicit: false }),
    { ok: true, method: "squash" },
  );
  assert.deepEqual(
    resolveEffectiveMergeMethod({ cliMethods: ["rebase"], configMethod: "squash", configExplicit: false }),
    { ok: true, method: "rebase" },
  );
  assert.equal(
    resolveEffectiveMergeMethod({ cliMethods: ["squash"], configMethod: "rebase", configExplicit: true }).ok,
    false,
  );
  assert.deepEqual(
    resolveEffectiveMergeMethod({ cliMethods: ["rebase"], configMethod: "rebase", configExplicit: true }),
    { ok: true, method: "rebase" },
  );
  assert.equal(
    resolveEffectiveMergeMethod({
      cliMethods: ["squash", "rebase"],
      configMethod: "squash",
      configExplicit: false,
    }).ok,
    false,
  );
  assert.deepEqual(
    resolveEffectiveMergeMethod({
      cliMethods: [],
      configMethod: "rebase",
      configExplicit: true,
      allowedMethods: ["squash", "merge"],
    }),
    { ok: true, method: "squash" },
  );

  // Command evaluation with explicit config.yaml merge_method: rebase
  const cfgRepo = makeTempDir("gh-conv-mergemethod-");
  try {
    fs.mkdirSync(path.join(cfgRepo, ".git"));
    fs.mkdirSync(path.join(cfgRepo, ".github-convention"));
    fs.writeFileSync(
      path.join(cfgRepo, ".github-convention", "config.yaml"),
      "schema_version: 1\ngithub:\n  merge_method: rebase\n",
    );
    const matchRes = evaluateBashCommand("gh pr merge 42 --rebase", { cwd: cfgRepo, prState: passState });
    assert.equal(matchRes.decision, "allow");
    assert.equal(matchRes.mergeMethod, "rebase");

    const conflictRes = evaluateBashCommand("gh pr merge 42 --squash", { cwd: cfgRepo, prState: passState });
    assert.equal(conflictRes.decision, "deny");
    assert.equal(conflictRes.ciStatus, "INVALID_MERGE_METHOD");
  } finally {
    fs.rmSync(cfgRepo, { recursive: true, force: true });
  }
});

test(
  "Defect D + A (Subprocess Integration): real guard-bash.mjs CLI round-trip with fake gh executable",
  { skip: process.platform === "win32" },
  () => {
    const tempDir = makeTempDir("gh-conv-cli-int-");
    const binDir = path.join(tempDir, "bin");
    const workDir = path.join(tempDir, "repo");
    fs.mkdirSync(binDir, { recursive: true });
    fs.mkdirSync(path.join(workDir, ".git"), { recursive: true });

    const fakeGh = path.join(binDir, "gh");
    fs.writeFileSync(
      fakeGh,
      `#!/usr/bin/env sh
set -eu
SCENARIO="\${FAKE_GH_SCENARIO:-}"
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  if [ "$SCENARIO" = "pr_fail" ]; then
    echo "GraphQL: Could not resolve to a PullRequest" >&2
    exit 1
  fi
  if [ "$SCENARIO" = "rollup_null" ]; then
    printf '{"isDraft":false,"state":"OPEN","mergeable":"MERGEABLE","mergeStateStatus":"CLEAN","headRefOid":"sha123","statusCheckRollup":null}\n'
    exit 0
  fi
  if [ "$SCENARIO" = "pending" ]; then
    printf '{"isDraft":false,"state":"OPEN","mergeable":"MERGEABLE","mergeStateStatus":"BLOCKED","headRefOid":"sha123","statusCheckRollup":[{"name":"CI/verify","status":"IN_PROGRESS","conclusion":""}]}\n'
    exit 0
  fi
  printf '{"isDraft":false,"state":"OPEN","mergeable":"MERGEABLE","mergeStateStatus":"UNSTABLE","headRefOid":"sha123","statusCheckRollup":[{"name":"CI/verify","status":"COMPLETED","conclusion":"FAILURE","detailsUrl":"https://github.com/owner/repo/actions/runs/777/job/1111"}]}\n'
  exit 0
fi
if [ "$1" = "api" ]; then
  ENDPOINT=""
  for ARG in "$@"; do
    case "$ARG" in
      repos/*) ENDPOINT="$ARG" ;;
    esac
  done
  if [ "$ENDPOINT" = "repos/owner/repo/actions/jobs/1111" ]; then
    if [ "$SCENARIO" = "auth_401" ]; then
      printf 'HTTP/2.0 401 Unauthorized\r\n\r\n{"message":"Bad credentials"}\n'
      exit 1
    fi
    printf 'HTTP/2.0 200 OK\r\n\r\n{"id":1111,"check_run_url":"https://api.github.com/repos/owner/repo/check-runs/8888","steps":[]}\n'
    exit 0
  fi
  if [ "$ENDPOINT" = "repos/owner/repo/check-runs/8888/annotations" ]; then
    if [ "$SCENARIO" = "quota" ]; then
      printf 'HTTP/2.0 200 OK\r\n\r\n[{"title":"","message":"The job was not started because recent account payments have failed or your spending limit needs to be increased."}]\n'
      exit 0
    fi
    printf 'HTTP/2.0 200 OK\r\n\r\n[]\n'
    exit 0
  fi
  # Fail if Job ID 1111 was ever guessed as Check Run ID
  exit 1
fi
exit 1
`,
    );
    fs.chmodSync(fakeGh, 0o755);

    const runHook = (command, scenario) =>
      spawnSync(process.execPath, [GUARD_HOOK], {
        cwd: workDir,
        input: JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd: workDir }),
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, FAKE_GH_SCENARIO: scenario },
        encoding: "utf8",
      });

    try {
      // 1. Quota exceeded via real Job -> check_run_url -> Check Run 8888 -> allow
      const quotaRes = runHook("gh pr merge 42 --squash", "quota");
      assert.equal(quotaRes.status, 0);
      assert.equal(quotaRes.stdout.trim(), "");

      // 2. Pending via --auto -> deny
      const pendingAutoRes = runHook("gh pr merge 42 --auto --squash", "pending");
      assert.equal(pendingAutoRes.status, 0);
      assert.equal(JSON.parse(pendingAutoRes.stdout).hookSpecificOutput.permissionDecision, "deny");

      // 3. Auth 401 on gh api -> deny (NOT UNAVAILABLE)
      const authRes = runHook("gh pr merge 42 --squash", "auth_401");
      assert.equal(authRes.status, 0);
      assert.equal(JSON.parse(authRes.stdout).hookSpecificOutput.permissionDecision, "deny");

      // 4. statusCheckRollup: null -> UNKNOWN -> deny (NOT NO_TESTS)
      const nullRollupRes = runHook("gh pr merge 42 --squash", "rollup_null");
      assert.equal(nullRollupRes.status, 0);
      assert.equal(JSON.parse(nullRollupRes.stdout).hookSpecificOutput.permissionDecision, "deny");

      // 5. gh pr view failure -> deny
      const prFailRes = runHook("gh pr merge 42 --squash", "pr_fail");
      assert.equal(prFailRes.status, 0);
      assert.equal(JSON.parse(prFailRes.stdout).hookSpecificOutput.permissionDecision, "deny");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  },
);
