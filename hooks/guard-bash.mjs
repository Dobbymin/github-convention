import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SECRET_PATTERNS = [
  { name: "AWS Access Key", regex: /AKIA[0-9A-Z]{16}/ },
  { name: "GitHub Token", regex: /gh[pousr]_[A-Za-z0-9_]{36,}/ },
  { name: "GitHub Fine-Grained PAT", regex: /github_pat_[A-Za-z0-9_]{22,}/ },
  { name: "OpenAI / Anthropic API Key", regex: /sk-(?:proj-|ant-)[A-Za-z0-9_-]{20,}/ },
  { name: "Slack Token", regex: /xox[baprs]-[0-9A-Za-z-]{10,}/ },
  {
    name: "Private Key Header",
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
  },
];

export const VALID_MERGE_METHODS = new Set(["squash", "merge", "rebase"]);

export const resolveMergeMethod = (rawMethod, allowedMethods = null) => {
  const normalized = typeof rawMethod === "string" ? rawMethod.trim().toLowerCase() : "";
  const preferred = VALID_MERGE_METHODS.has(normalized) ? normalized : "squash";
  if (Array.isArray(allowedMethods) && allowedMethods.length > 0) {
    const validAllowed = allowedMethods
      .map((m) => String(m).trim().toLowerCase())
      .filter((m) => VALID_MERGE_METHODS.has(m));
    if (validAllowed.length > 0 && !validAllowed.includes(preferred)) {
      return validAllowed.includes("squash") ? "squash" : validAllowed[0];
    }
  }
  return preferred;
};

export const buildPrMergeCommand = (prRef, { mergeMethod = "squash", allowedMethods = null, deleteBranch = true } = {}) => {
  const method = resolveMergeMethod(mergeMethod, allowedMethods);
  const parts = ["gh", "pr", "merge"];
  if (prRef !== undefined && prRef !== null && String(prRef).trim() !== "") {
    parts.push(String(prRef).trim());
  }
  parts.push(`--${method}`);
  if (deleteBranch) {
    parts.push("--delete-branch");
  }
  return parts.join(" ");
};

const extractCliMergeMethods = (args) => {
  const methods = [];
  for (const arg of args) {
    if (arg === "--squash" || arg === "-s") methods.push("squash");
    else if (arg === "--merge" || arg === "-m") methods.push("merge");
    else if (arg === "--rebase" || arg === "-r") methods.push("rebase");
  }
  return Array.from(new Set(methods));
};

export const resolveEffectiveMergeMethod = ({
  cliMethods = [],
  configMethod = "squash",
  configExplicit = false,
  allowedMethods = null,
} = {}) => {
  const uniqueCli = Array.from(
    new Set(
      cliMethods
        .map((m) => String(m).trim().toLowerCase())
        .filter((m) => VALID_MERGE_METHODS.has(m)),
    ),
  );
  if (uniqueCli.length > 1) {
    return {
      ok: false,
      method: null,
      reason: `Blocked: conflicting CLI merge method flags (${uniqueCli.map((m) => `--${m}`).join(", ")}). Specify at most one merge method.`,
    };
  }

  const cliMethod = uniqueCli[0] ?? null;
  const normalizedConfig = typeof configMethod === "string" ? configMethod.trim().toLowerCase() : "";
  const validConfigMethod = VALID_MERGE_METHODS.has(normalizedConfig) ? normalizedConfig : "squash";

  if (configExplicit && cliMethod && cliMethod !== validConfigMethod) {
    return {
      ok: false,
      method: null,
      reason: `Blocked: CLI merge method (\`--${cliMethod}\`) conflicts with project config \`github.merge_method: ${validConfigMethod}\`.`,
    };
  }

  const chosen = configExplicit ? validConfigMethod : (cliMethod ?? validConfigMethod);
  if (Array.isArray(allowedMethods) && allowedMethods.length > 0) {
    const validAllowed = allowedMethods
      .map((m) => String(m).trim().toLowerCase())
      .filter((m) => VALID_MERGE_METHODS.has(m));
    if (validAllowed.length > 0 && !validAllowed.includes(chosen)) {
      if (cliMethod && !configExplicit) {
        return {
          ok: false,
          method: null,
          reason: `Blocked: requested merge method (\`--${cliMethod}\`) is not allowed by repository settings (allowed: ${validAllowed.join(", ")}).`,
        };
      }
      const fallback = validAllowed.includes("squash") ? "squash" : validAllowed[0];
      return { ok: true, method: fallback };
    }
  }

  return { ok: true, method: chosen };
};

const splitSubcommands = (command) =>
  String(command ?? "")
    .split(/(?:&&|\|\||;|\n)/)
    .map((part) => part.trim())
    .filter(Boolean);

const tokenize = (segment) => {
  const tokens = [];
  const regex = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  let match;
  while ((match = regex.exec(segment)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
};

const ENV_ASSIGNMENT_REGEX = /^[A-Za-z_][A-Za-z0-9_]*=/;

const stripCommandPrefixes = (tokens) => {
  let idx = 0;
  while (idx < tokens.length) {
    const tok = tokens[idx];
    if (ENV_ASSIGNMENT_REGEX.test(tok)) {
      idx += 1;
      continue;
    }
    if (tok === "command" || tok === "builtin" || tok === "exec") {
      idx += 1;
      while (idx < tokens.length && tokens[idx].startsWith("-")) {
        if (tokens[idx] === "-a") {
          idx += 2;
        } else {
          idx += 1;
        }
      }
      continue;
    }
    if (tok === "env") {
      idx += 1;
      while (idx < tokens.length) {
        const arg = tokens[idx];
        if (arg === "-u" || arg === "--unset" || arg === "-C" || arg === "-S") {
          idx += 2;
          continue;
        }
        if (arg.startsWith("-")) {
          idx += 1;
          continue;
        }
        if (ENV_ASSIGNMENT_REGEX.test(arg)) {
          idx += 1;
          continue;
        }
        break;
      }
      continue;
    }
    break;
  }
  return tokens.slice(idx);
};

const parseGitSubcommand = (tokens) => {
  if (tokens[0] !== "git") return null;
  let idx = 1;
  while (idx < tokens.length) {
    const tok = tokens[idx];
    if (tok === "-C" || tok === "-c" || tok === "--git-dir" || tok === "--work-tree") {
      idx += 2;
      continue;
    }
    if (tok.startsWith("-")) {
      idx += 1;
      continue;
    }
    return { subcommand: tok, args: tokens.slice(idx + 1) };
  }
  return null;
};

export const readGithubConfig = (startDir) => {
  let current = path.resolve(startDir);
  while (true) {
    const cfgPath = path.join(current, ".github-convention", "config.yaml");
    try {
      if (fs.existsSync(cfgPath)) {
        const text = fs.readFileSync(cfgPath, "utf8");
        const githubSection = text.match(/^github:\s*\r?\n((?:[ \t]+.*\r?\n?)*)/m);
        if (githubSection) {
          const section = githubSection[1];
          const branchMatch = section.match(/^\s+default_branch:\s*["']?([^\s"'#]+)["']?/m);
          const configured = branchMatch ? branchMatch[1] : "";
          const autoMergeMatch = section.match(/^\s+auto_merge_on_ci_pass:\s*(true|false)/im);
          const mergeMethodMatch = section.match(/^\s+merge_method:\s*["']?([^\s"'#]+)["']?/m);
          const rawMethod = mergeMethodMatch ? mergeMethodMatch[1].trim().toLowerCase() : "";
          const mergeMethodExplicit = VALID_MERGE_METHODS.has(rawMethod);
          return {
            defaultBranch: configured && configured !== "detect" ? configured : null,
            autoMergeOnCiPass: autoMergeMatch ? autoMergeMatch[1].toLowerCase() === "true" : true,
            mergeMethod: mergeMethodExplicit ? rawMethod : "squash",
            mergeMethodExplicit,
          };
        }
      }
    } catch {
      // Ignore unreadable config; fallback to defaults.
    }
    if (fs.existsSync(path.join(current, ".git"))) {
      return { defaultBranch: null, autoMergeOnCiPass: true, mergeMethod: "squash", mergeMethodExplicit: false };
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return { defaultBranch: null, autoMergeOnCiPass: true, mergeMethod: "squash", mergeMethodExplicit: false };
    }
    current = parent;
  }
};

const extractPrMergeTarget = (args) => {
  const valueFlags = new Set([
    "-b",
    "--body",
    "-F",
    "--body-file",
    "-t",
    "--subject",
    "--match-head-commit",
    "-R",
    "--repo",
  ]);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (valueFlags.has(arg)) {
      i += 1;
      continue;
    }
    if (arg.startsWith("-")) continue;
    return arg;
  }
  return null;
};

const UNAVAILABLE_MESSAGE_PATTERNS = [
  /recent account payments have failed/i,
  /spending limit needs to be increased/i,
  /billing & plans/i,
  /actions is disabled/i,
  /github actions is disabled/i,
  /workflows? disabled/i,
  /quota exceeded/i,
  /minutes quota/i,
];

const isUnavailableMessage = (text) =>
  typeof text === "string" && UNAVAILABLE_MESSAGE_PATTERNS.some((re) => re.test(text));

export const extractActionsJobFromUrl = (url) => {
  const raw = String(url ?? "");
  const match = raw.match(/\/github\.com\/([^/]+\/[^/]+)\/actions\/runs\/\d+\/job\/(\d+)/);
  if (!match) return null;
  return { repoSlug: match[1], jobId: match[2] };
};

export const extractCheckRunFromUrl = (url) => {
  const raw = String(url ?? "").trim();
  if (!raw) return null;
  const apiMatch = raw.match(/(?:https?:\/\/api\.github\.com\/)?repos\/([^/]+\/[^/]+)\/check-runs\/(\d+)(?:\/.*)?$/);
  if (apiMatch) {
    return { repoSlug: apiMatch[1], checkRunId: apiMatch[2] };
  }
  const webRunMatch = raw.match(/\/github\.com\/([^/]+\/[^/]+)\/runs\/(\d+)(?:[?#].*)?$/);
  if (webRunMatch) {
    return { repoSlug: webRunMatch[1], checkRunId: webRunMatch[2] };
  }
  return null;
};

const NETWORK_ERROR_REGEX = /dial tcp|connection refused|no such host|timed?\s*out|econnrefused|enotfound|etimedout|eof|tls|network/i;
const AUTH_ERROR_REGEX = /bad credentials|not logged in|authentication|unauthorized|requires authentication/i;

const parseGhIncludedOutput = (stdout, stderr, exitStatus, spawnError) => {
  const outText = String(stdout ?? "");
  const errText = String(stderr ?? "");
  let statusCode = null;
  let body = outText.trim();

  if (/^HTTP\/\S+\s+\d{3}/m.test(outText)) {
    let remaining = outText;
    while (/^HTTP\/\S+\s+(\d{3})/.test(remaining)) {
      const codeMatch = remaining.match(/^HTTP\/\S+\s+(\d{3})/);
      statusCode = Number.parseInt(codeMatch[1], 10);
      const sepMatch = remaining.match(/\r?\n\r?\n/);
      if (!sepMatch) {
        remaining = "";
        break;
      }
      remaining = remaining.slice(sepMatch.index + sepMatch[0].length);
    }
    body = remaining.trim();
  }

  if (statusCode === null) {
    const errHttpMatch = errText.match(/\bHTTP\s+(\d{3})\b/i);
    if (errHttpMatch) {
      statusCode = Number.parseInt(errHttpMatch[1], 10);
    }
  }

  const ok = !spawnError && exitStatus === 0 && (statusCode === null || (statusCode >= 200 && statusCode < 300));
  let errorKind = null;
  if (!ok) {
    const combinedErr = `${errText}\n${body}`;
    if (spawnError || NETWORK_ERROR_REGEX.test(combinedErr)) {
      errorKind = "network";
    } else if (statusCode === 401 || AUTH_ERROR_REGEX.test(combinedErr)) {
      errorKind = "auth";
    } else if (statusCode === 403 && !isUnavailableMessage(combinedErr)) {
      errorKind = "auth";
    } else if (statusCode === 404) {
      errorKind = "not_found";
    } else {
      errorKind = "api_error";
    }
  }

  return { ok, statusCode, body, stderr: errText.trim(), errorKind };
};

const defaultGhApi = (endpoint, { cwd } = {}) => {
  const res = spawnSync("gh", ["api", "--include", endpoint], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return parseGhIncludedOutput(res.stdout, res.stderr, res.status, res.error);
};

export const inspectCheckRunUnavailableViaGh = (check, cwdOrOptions = {}) => {
  const opts = typeof cwdOrOptions === "string" ? { cwd: cwdOrOptions } : (cwdOrOptions ?? {});
  const cwd = opts.cwd;
  const ghApi = opts.ghApi ?? defaultGhApi;

  const jobInfo = extractActionsJobFromUrl(check?.detailsUrl);
  let checkRunTarget =
    extractCheckRunFromUrl(check?.check_run_url) ??
    extractCheckRunFromUrl(check?.detailsUrl);

  if (jobInfo) {
    let jobRes;
    try {
      jobRes = ghApi(`repos/${jobInfo.repoSlug}/actions/jobs/${jobInfo.jobId}`, { cwd });
    } catch (error) {
      return {
        status: "lookup_error",
        checkRunId: null,
        httpStatus: null,
        errorKind: "network",
        reason: `Failed to query Actions job ${jobInfo.jobId}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    if (!jobRes?.ok) {
      const errText = `${jobRes?.body ?? ""}\n${jobRes?.stderr ?? ""}`;
      if ((jobRes?.statusCode === 402 || jobRes?.statusCode === 403) && isUnavailableMessage(errText)) {
        return {
          status: "unavailable",
          checkRunId: null,
          httpStatus: jobRes.statusCode,
          errorKind: null,
          reason: "GitHub Actions job blocked by billing/quota or Actions disabled.",
        };
      }
      return {
        status: "lookup_error",
        checkRunId: null,
        httpStatus: jobRes?.statusCode ?? null,
        errorKind: jobRes?.errorKind ?? "api_error",
        reason: `Actions job lookup failed (HTTP ${jobRes?.statusCode ?? "unknown"}, kind=${jobRes?.errorKind ?? "api_error"}).`,
      };
    }

    let job;
    try {
      job = JSON.parse(jobRes.body);
    } catch {
      return {
        status: "lookup_error",
        checkRunId: null,
        httpStatus: jobRes.statusCode ?? 200,
        errorKind: "invalid_json",
        reason: "Actions job response was not valid JSON.",
      };
    }

    const steps = Array.isArray(job?.steps) ? job.steps : [];
    if (steps.length > 0) {
      return {
        status: "failed",
        checkRunId: extractCheckRunFromUrl(job?.check_run_url)?.checkRunId ?? null,
        httpStatus: jobRes.statusCode ?? 200,
        errorKind: null,
        reason: "Job executed steps before failing.",
      };
    }

    checkRunTarget =
      extractCheckRunFromUrl(job?.check_run_url) ??
      (job?.check_run_id ? { repoSlug: jobInfo.repoSlug, checkRunId: String(job.check_run_id) } : null) ??
      checkRunTarget ??
      (check?.checkRunId ? { repoSlug: jobInfo.repoSlug, checkRunId: String(check.checkRunId) } : null);

    if (!checkRunTarget?.checkRunId) {
      return {
        status: "lookup_error",
        checkRunId: null,
        httpStatus: jobRes.statusCode ?? 200,
        errorKind: "missing_check_run_id",
        reason: `Actions job ${jobInfo.jobId} did not provide a check_run_url or check_run_id; refusing to guess Check Run ID from Job ID.`,
      };
    }
  } else if (check?.checkRunId && check?.repoSlug) {
    if (Array.isArray(check?.steps) && check.steps.length > 0) {
      return {
        status: "failed",
        checkRunId: String(check.checkRunId),
        httpStatus: null,
        errorKind: null,
        reason: "Check run executed steps before failing.",
      };
    }
    checkRunTarget = { repoSlug: String(check.repoSlug), checkRunId: String(check.checkRunId) };
  }

  if (!checkRunTarget?.checkRunId || !checkRunTarget?.repoSlug) {
    return {
      status: "lookup_error",
      checkRunId: null,
      httpStatus: null,
      errorKind: "missing_check_run_id",
      reason: "No valid Check Run ID could be determined from check metadata.",
    };
  }

  if (Array.isArray(check?.steps) && check.steps.length > 0) {
    return {
      status: "failed",
      checkRunId: checkRunTarget.checkRunId,
      httpStatus: null,
      errorKind: null,
      reason: "Check run executed steps before failing.",
    };
  }

  let annRes;
  try {
    annRes = ghApi(`repos/${checkRunTarget.repoSlug}/check-runs/${checkRunTarget.checkRunId}/annotations`, { cwd });
  } catch (error) {
    return {
      status: "lookup_error",
      checkRunId: checkRunTarget.checkRunId,
      httpStatus: null,
      errorKind: "network",
      reason: `Check Run annotations lookup failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!annRes?.ok) {
    const errText = `${annRes?.body ?? ""}\n${annRes?.stderr ?? ""}`;
    if ((annRes?.statusCode === 402 || annRes?.statusCode === 403) && isUnavailableMessage(errText)) {
      return {
        status: "unavailable",
        checkRunId: checkRunTarget.checkRunId,
        httpStatus: annRes.statusCode,
        errorKind: null,
        reason: "Check Run annotations blocked by billing/quota or Actions disabled.",
      };
    }
    return {
      status: "lookup_error",
      checkRunId: checkRunTarget.checkRunId,
      httpStatus: annRes?.statusCode ?? null,
      errorKind: annRes?.errorKind ?? "api_error",
      reason: `Check Run annotations lookup failed (HTTP ${annRes?.statusCode ?? "unknown"}, kind=${annRes?.errorKind ?? "api_error"}).`,
    };
  }

  let annotations;
  try {
    annotations = JSON.parse(annRes.body);
  } catch {
    return {
      status: "lookup_error",
      checkRunId: checkRunTarget.checkRunId,
      httpStatus: annRes.statusCode ?? 200,
      errorKind: "invalid_json",
      reason: "Check Run annotations response was not valid JSON.",
    };
  }

  if (
    Array.isArray(annotations) &&
    annotations.some((ann) => isUnavailableMessage(ann?.message) || isUnavailableMessage(ann?.title))
  ) {
    return {
      status: "unavailable",
      checkRunId: checkRunTarget.checkRunId,
      httpStatus: annRes.statusCode ?? 200,
      errorKind: null,
      reason: "Check Run annotation confirmed CI unavailability (billing/quota/disabled).",
    };
  }

  return {
    status: "failed",
    checkRunId: checkRunTarget.checkRunId,
    httpStatus: annRes.statusCode ?? 200,
    errorKind: null,
    reason: "Check Run failed without CI unavailability evidence.",
  };
};

const inspectPrMergeReadiness = (prRef, cwd) => {
  try {
    const ghArgs = ["pr", "view"];
    if (prRef) ghArgs.push(prRef);
    ghArgs.push("--json", "isDraft,state,mergeable,mergeStateStatus,headRefOid,statusCheckRollup");
    const raw = execFileSync("gh", ghArgs, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const parsed = JSON.parse(raw);
    const hasRollupArray = Array.isArray(parsed?.statusCheckRollup);
    return {
      ok: true,
      prQueryOk: true,
      ciQueryOk: hasRollupArray,
      isDraft: Boolean(parsed?.isDraft),
      state: parsed?.state ?? "OPEN",
      mergeable: parsed?.mergeable ?? null,
      mergeStateStatus: parsed?.mergeStateStatus ?? null,
      headRefOid: parsed?.headRefOid ?? null,
      ciQueryFailed: !hasRollupArray,
      checks: hasRollupArray ? parsed.statusCheckRollup : null,
    };
  } catch {
    return { ok: false, prQueryOk: false, ciQueryOk: false, isDraft: false, state: "UNKNOWN", checks: null };
  }
};

const PASSING_CONCLUSIONS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

const FAILING_CONCLUSIONS = new Set([
  "FAILURE",
  "TIMED_OUT",
  "CANCELLED",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
  "STALE",
]);

const evaluateCheckUnavailability = (check, { cwd, ghApi } = {}) => {
  if (!check || typeof check !== "object") return { status: "failed" };
  if (check.unavailable === true || check.billingBlocked === true || check.ciDisabled === true) {
    if (Array.isArray(check.steps) && check.steps.length > 0) {
      return { status: "failed" };
    }
    return { status: "unavailable" };
  }
  const texts = [
    check.message,
    check.summary,
    check.text,
    check.title,
    check.reason,
    ...(Array.isArray(check.annotations)
      ? check.annotations.map((a) => (typeof a === "string" ? a : a?.message))
      : []),
  ];
  if (texts.some((t) => isUnavailableMessage(t))) {
    if (Array.isArray(check.steps) && check.steps.length > 0) {
      return { status: "failed" };
    }
    return { status: "unavailable" };
  }
  const conclusion = String(check.conclusion ?? "").toUpperCase();
  if (
    (conclusion === "FAILURE" || conclusion === "STARTUP_FAILURE") &&
    (check.detailsUrl || check.check_run_url || check.checkRunId) &&
    (cwd || ghApi)
  ) {
    return inspectCheckRunUnavailableViaGh(check, { cwd, ghApi });
  }
  return { status: "failed" };
};

export const classifyCiStatus = (prState, { cwd, ghApi, expectedHeadSha = null } = {}) => {
  if (!prState || prState.ok === false || prState.prQueryOk === false) {
    return {
      status: "UNKNOWN",
      queryErrorType: "pr_query_failed",
      reason: "PR status query failed or PR could not be verified.",
      passing: [],
      failing: [],
      pending: [],
      unavailable: [],
      unknown: [],
      lookupErrors: [],
    };
  }

  const targetSha = expectedHeadSha ?? prState.expectedHeadSha ?? prState.headRefOid ?? prState.headSha ?? null;
  const ciSha = prState.ciHeadSha ?? null;
  if (targetSha && ciSha && targetSha !== ciSha) {
    return {
      status: "UNKNOWN",
      queryErrorType: "stale_commit_ci",
      reason: `CI results belong to stale commit ${ciSha} instead of current commit ${targetSha}.`,
      passing: [],
      failing: [],
      pending: [],
      unavailable: [],
      unknown: [],
      lookupErrors: [],
    };
  }

  const checks = Array.isArray(prState.checks) ? prState.checks : null;
  const passing = [];
  const failing = [];
  const pending = [];
  const unavailable = [];
  const unknown = [];
  const lookupErrors = [];

  if (checks) {
    for (const check of checks) {
      const name = check?.name || check?.context || "check";
      const checkSha = check?.headSha ?? check?.commitSha ?? null;
      if (targetSha && checkSha && checkSha !== targetSha) {
        unknown.push(name);
        continue;
      }

      const conclusion = String(check?.conclusion ?? "").toUpperCase();
      const status = String(check?.status ?? "").toUpperCase();
      const checkState = String(check?.state ?? "").toUpperCase();

      if (
        (status && status !== "COMPLETED") ||
        checkState === "PENDING" ||
        checkState === "EXPECTED" ||
        checkState === "IN_PROGRESS" ||
        checkState === "QUEUED" ||
        checkState === "WAITING"
      ) {
        pending.push(name);
        continue;
      }

      const unavailEval = evaluateCheckUnavailability(check, { cwd, ghApi });
      if (unavailEval.status === "unavailable") {
        unavailable.push(name);
        continue;
      }
      if (unavailEval.status === "lookup_error") {
        lookupErrors.push({ name, ...unavailEval });
      }

      if (
        FAILING_CONCLUSIONS.has(conclusion) ||
        checkState === "FAILURE" ||
        checkState === "ERROR"
      ) {
        failing.push(name);
        continue;
      }

      if (
        PASSING_CONCLUSIONS.has(conclusion) ||
        checkState === "SUCCESS"
      ) {
        passing.push(name);
        continue;
      }

      unknown.push(name);
    }
  }

  // Priority 1: Any known FAIL blocks merge, regardless of other PASS / UNAVAILABLE / query results.
  if (failing.length > 0) {
    return {
      status: "FAIL",
      queryErrorType: null,
      reason: `Failing CI check(s): ${failing.join(", ")}.`,
      passing,
      failing,
      pending,
      unavailable,
      unknown,
      lookupErrors,
    };
  }

  // Priority 2: Any PENDING check requires waiting (never treated as UNAVAILABLE).
  if (pending.length > 0) {
    return {
      status: "PENDING",
      queryErrorType: null,
      reason: `Pending CI check(s): ${pending.join(", ")}.`,
      passing,
      failing,
      pending,
      unavailable,
      unknown,
      lookupErrors,
    };
  }

  // Priority 3 (safety): CI query failure or unrecognized check state -> UNKNOWN (never treated as UNAVAILABLE or NO_TESTS).
  if (
    prState.ciQueryFailed === true ||
    prState.ciQueryOk === false ||
    Boolean(prState.checksError) ||
    checks === null ||
    unknown.length > 0
  ) {
    return {
      status: "UNKNOWN",
      queryErrorType: "ci_query_failed",
      reason:
        unknown.length > 0
          ? `Unrecognized or stale CI check state(s): ${unknown.join(", ")}.`
          : "CI check status could not be queried reliably.",
      passing,
      failing,
      pending,
      unavailable,
      unknown,
      lookupErrors,
    };
  }

  // Priority 4/5: If any check or repo/account-level signal is UNAVAILABLE (even alongside PASS checks), classify as UNAVAILABLE (NOT PASS).
  if (
    prState.ciUnavailable === true ||
    prState.actionsDisabled === true ||
    prState.billingLimited === true ||
    isUnavailableMessage(prState.ciUnavailableReason) ||
    unavailable.length > 0
  ) {
    return {
      status: "UNAVAILABLE",
      queryErrorType: null,
      reason:
        prState.ciUnavailableReason ||
        (unavailable.length > 0
          ? `CI runner unavailable for check(s): ${unavailable.join(", ")}.`
          : "CI execution is unavailable (Actions disabled or account quota/billing limit)."),
      passing,
      failing,
      pending,
      unavailable,
      unknown,
      lookupErrors,
    };
  }

  // Priority 6: Explicitly no checks configured on project -> NO_TESTS (unless configured checks were expected).
  if (checks.length === 0) {
    if ((prState.hasConfiguredChecks === true || Number(prState.expectedChecksCount ?? 0) > 0) && prState.noTests !== true) {
      return {
        status: "UNKNOWN",
        queryErrorType: "missing_expected_checks",
        reason: "Project has configured CI checks, but no check results were returned.",
        passing,
        failing,
        pending,
        unavailable,
        unknown,
        lookupErrors,
      };
    }
    return {
      status: "NO_TESTS",
      queryErrorType: null,
      reason: "No CI checks or tests configured for this project.",
      passing,
      failing,
      pending,
      unavailable,
      unknown,
      lookupErrors,
    };
  }

  // All checks completed cleanly -> PASS
  return {
    status: "PASS",
    queryErrorType: null,
    reason: "All CI checks passed.",
    passing,
    failing,
    pending,
    unavailable,
    unknown,
    lookupErrors,
  };
};

export const evaluateConflictResolution = ({
  hasConflicts = false,
  conflictType = "none",
  resolved = false,
  preservedChanges = true,
  withinIssueScope = true,
  headCommitUpdated = true,
  previousHeadSha = null,
  newHeadSha = null,
  ciCommitSha = null,
  localChecksPassed = true,
  prState = null,
  ciStateAfterResolution = null,
  autoMergeOnCiPass = true,
  cwd,
  ghApi,
} = {}) => {
  const isPrReady = () => {
    if (!prState) return true;
    if (prState.ok === false || prState.prQueryOk === false) return false;
    const lifecycle = String(prState.state ?? "OPEN").toUpperCase();
    if (lifecycle !== "OPEN" || prState.isDraft === true || Number(prState.unresolvedBlockers ?? 0) > 0) {
      return false;
    }
    return true;
  };

  if (!hasConflicts) {
    const prReady = isPrReady();
    if (!prReady) {
      return {
        conflictStatus: "none",
        conflictsCleared: true,
        prReady: false,
        action: "block",
        canMerge: false,
        ciStatus: "UNKNOWN",
        reason: "No conflicts detected, but PR is not in a mergeable OPEN/non-Draft/unblocked state.",
      };
    }
    if (!ciStateAfterResolution) {
      return {
        conflictStatus: "none",
        conflictsCleared: true,
        prReady: true,
        action: "block",
        canMerge: false,
        ciStatus: "UNKNOWN",
        reason: "No conflicts detected, but CI state was not provided (UNKNOWN).",
      };
    }
    const ci = classifyCiStatus(ciStateAfterResolution, {
      cwd,
      ghApi,
      expectedHeadSha: newHeadSha ?? prState?.headRefOid ?? null,
    });
    if (ci.status === "FAIL" || ci.status === "UNKNOWN") {
      return {
        conflictStatus: "none",
        conflictsCleared: true,
        prReady: true,
        action: "block",
        canMerge: false,
        ciStatus: ci.status,
        reason: ci.reason,
      };
    }
    if (ci.status === "PENDING") {
      return {
        conflictStatus: "none",
        conflictsCleared: true,
        prReady: true,
        action: "wait",
        canMerge: false,
        ciStatus: ci.status,
        reason: ci.reason,
      };
    }
    return {
      conflictStatus: "none",
      conflictsCleared: true,
      prReady: true,
      action: autoMergeOnCiPass === false ? "manual_merge" : "merge",
      canMerge: autoMergeOnCiPass !== false,
      ciStatus: ci.status,
      reason: `No conflicts detected; CI status is ${ci.status}.`,
    };
  }

  if (conflictType === "complex" || conflictType === "ambiguous" || conflictType === "design") {
    return {
      conflictStatus: "complex",
      conflictsCleared: false,
      prReady: isPrReady(),
      action: "ask_user",
      canMerge: false,
      ciStatus: "UNKNOWN",
      reason: "Complex or design-impacting merge conflict requires explicit user confirmation.",
    };
  }

  if (!preservedChanges) {
    return {
      conflictStatus: "unsafe",
      conflictsCleared: false,
      prReady: isPrReady(),
      action: "block",
      canMerge: false,
      ciStatus: "UNKNOWN",
      reason: "Blocked: conflict resolution lost existing branch changes or Issue requirements.",
    };
  }

  if (!withinIssueScope) {
    return {
      conflictStatus: "out_of_scope",
      conflictsCleared: false,
      prReady: isPrReady(),
      action: "block",
      canMerge: false,
      ciStatus: "UNKNOWN",
      reason: "Blocked: conflict resolution introduced out-of-scope changes beyond the Issue.",
    };
  }

  if (!resolved) {
    return {
      conflictStatus: "unresolved",
      conflictsCleared: false,
      prReady: isPrReady(),
      action: "block",
      canMerge: false,
      ciStatus: "UNKNOWN",
      reason: "Blocked: PR conflicts remain unresolved.",
    };
  }

  if (!localChecksPassed) {
    return {
      conflictStatus: "resolved",
      conflictsCleared: true,
      prReady: isPrReady(),
      action: "block",
      canMerge: false,
      ciStatus: "FAIL",
      reason: "Blocked: local tests or quality gates failed after resolving conflicts.",
    };
  }

  if (!headCommitUpdated || (previousHeadSha && newHeadSha && previousHeadSha === newHeadSha)) {
    return {
      conflictStatus: "resolved",
      conflictsCleared: true,
      prReady: isPrReady(),
      action: "block",
      canMerge: false,
      ciStatus: "UNKNOWN",
      reason: "Blocked: CI results from a prior commit cannot be reused after conflict resolution.",
    };
  }

  if (!ciStateAfterResolution) {
    return {
      conflictStatus: "resolved",
      conflictsCleared: true,
      prReady: isPrReady(),
      action: "block",
      canMerge: false,
      ciStatus: "UNKNOWN",
      reason: "Blocked: CI state for the conflict-resolution commit was not provided (UNKNOWN).",
    };
  }

  const effectiveCiSha =
    ciCommitSha ??
    ciStateAfterResolution?.headRefOid ??
    ciStateAfterResolution?.headSha ??
    ciStateAfterResolution?.commitSha ??
    null;

  if (
    (previousHeadSha && effectiveCiSha && effectiveCiSha === previousHeadSha) ||
    (newHeadSha && effectiveCiSha && effectiveCiSha !== newHeadSha)
  ) {
    return {
      conflictStatus: "resolved",
      conflictsCleared: true,
      prReady: isPrReady(),
      action: "block",
      canMerge: false,
      ciStatus: "UNKNOWN",
      reason: `Blocked: CI result commit (${effectiveCiSha}) does not match the new conflict-resolution commit (${newHeadSha ?? "unknown"}).`,
    };
  }

  const prReady = isPrReady();
  if (!prReady) {
    return {
      conflictStatus: "resolved",
      conflictsCleared: true,
      prReady: false,
      action: "block",
      canMerge: false,
      ciStatus: "UNKNOWN",
      reason: "Blocked: conflicts resolved, but PR is not OPEN/non-Draft/unblocked.",
    };
  }

  const ci = classifyCiStatus(ciStateAfterResolution, {
    cwd,
    ghApi,
    expectedHeadSha: newHeadSha ?? effectiveCiSha ?? null,
  });
  if (ci.status === "FAIL") {
    return {
      conflictStatus: "resolved",
      conflictsCleared: true,
      prReady: true,
      action: "block",
      canMerge: false,
      ciStatus: "FAIL",
      reason: `Blocked: CI failed on the conflict-resolution commit (${ci.reason})`,
    };
  }
  if (ci.status === "PENDING") {
    return {
      conflictStatus: "resolved",
      conflictsCleared: true,
      prReady: true,
      action: "wait",
      canMerge: false,
      ciStatus: "PENDING",
      reason: `Wait: CI is still running on the conflict-resolution commit (${ci.reason})`,
    };
  }
  if (ci.status === "UNKNOWN") {
    return {
      conflictStatus: "resolved",
      conflictsCleared: true,
      prReady: true,
      action: "block",
      canMerge: false,
      ciStatus: "UNKNOWN",
      reason: `Blocked: CI status on the conflict-resolution commit is unknown (${ci.reason})`,
    };
  }

  // PASS, NO_TESTS, or UNAVAILABLE
  return {
    conflictStatus: "resolved",
    conflictsCleared: true,
    prReady: true,
    action: autoMergeOnCiPass === false ? "manual_merge" : "merge",
    canMerge: autoMergeOnCiPass !== false,
    ciStatus: ci.status,
    reason: `Conflicts resolved and verified on new commit (CI status: ${ci.status}).`,
  };
};

const evaluatePrMerge = (
  args,
  {
    cwd,
    prState,
    autoMergeOnCiPass,
    mergeMethod = "squash",
    mergeMethodExplicit = false,
    allowedMergeMethods = null,
    ghApi,
  },
) => {
  if (autoMergeOnCiPass === false) {
    return {
      decision: "deny",
      ciStatus: "DISABLED",
      reason:
        "Blocked: PR merge is disabled by `github.auto_merge_on_ci_pass: false` in `.github-convention/config.yaml`.",
    };
  }
  if (args.includes("--admin")) {
    return {
      decision: "deny",
      ciStatus: "FORBIDDEN_ADMIN",
      reason: "Blocked: `gh pr merge --admin` is forbidden. Never bypass branch protection.",
    };
  }

  const cliMethods = extractCliMergeMethods(args);
  const methodResolution = resolveEffectiveMergeMethod({
    cliMethods,
    configMethod: mergeMethod,
    configExplicit: mergeMethodExplicit,
    allowedMethods: allowedMergeMethods,
  });
  if (!methodResolution.ok) {
    return {
      decision: "deny",
      ciStatus: "INVALID_MERGE_METHOD",
      reason: methodResolution.reason,
    };
  }

  const prRef = extractPrMergeTarget(args);
  const state = prState ?? inspectPrMergeReadiness(prRef, cwd);
  if (!state || state.ok === false || state.prQueryOk === false) {
    return {
      decision: "deny",
      ciStatus: "UNKNOWN",
      reason:
        "Blocked: could not verify PR state via `gh pr view`. Confirm the PR exists and is OPEN before merging.",
    };
  }

  const prLifecycleState = String(state.state ?? "OPEN").toUpperCase();
  if (prLifecycleState === "MERGED") {
    return {
      decision: "deny",
      ciStatus: "MERGED",
      reason: "Terminated: PR is already MERGED. No further merge action is required.",
    };
  }
  if (prLifecycleState !== "OPEN") {
    return {
      decision: "deny",
      ciStatus: prLifecycleState,
      reason: `Blocked: PR state is ${prLifecycleState} (must be OPEN to merge).`,
    };
  }

  if (state.isDraft) {
    return {
      decision: "deny",
      ciStatus: "DRAFT",
      reason: "Blocked: cannot merge a Draft PR. Mark PR ready and verify CI passes first.",
    };
  }

  const mergeable = String(state.mergeable ?? "").toUpperCase();
  const mergeStateStatus = String(state.mergeStateStatus ?? "").toUpperCase();
  if (
    state.hasConflicts === true ||
    mergeable === "CONFLICTING" ||
    mergeStateStatus === "DIRTY"
  ) {
    return {
      decision: "deny",
      ciStatus: "CONFLICTING",
      reason:
        "Blocked: PR has merge conflicts (`CONFLICTING` / `DIRTY`). Resolve conflicts against the base branch, re-run verification on the new commit, and re-check CI before merging.",
    };
  }

  if (Number(state.unresolvedBlockers ?? 0) > 0) {
    return {
      decision: "deny",
      ciStatus: "BLOCKED",
      reason: `Blocked: PR has ${state.unresolvedBlockers} unresolved review blocker(s).`,
    };
  }

  const ci = classifyCiStatus(state, { cwd, ghApi });

  if (ci.status === "FAIL") {
    return {
      decision: "deny",
      ciStatus: "FAIL",
      reason: `Blocked: cannot merge PR with failing CI check(s): ${ci.failing.join(", ")}.`,
    };
  }

  // PENDING always waits, even if `--auto` was passed on the command line.
  if (ci.status === "PENDING") {
    return {
      decision: "deny",
      ciStatus: "PENDING",
      reason: `Blocked: cannot merge PR while CI check(s) are still pending (${ci.pending.join(", ")}). Wait until CI finishes and re-evaluate (do not use \`--auto\` to bypass pending checks).`,
    };
  }

  if (ci.status === "UNKNOWN") {
    return {
      decision: "deny",
      ciStatus: "UNKNOWN",
      reason: `Blocked: CI check status is UNKNOWN (${ci.reason}). Diagnose why CI status could not be verified before merging.`,
    };
  }

  // PASS, NO_TESTS, and UNAVAILABLE are allowed to proceed when PR is OPEN, non-Draft, and conflict-free.
  return { decision: "allow", ciStatus: ci.status, mergeMethod: methodResolution.method };
};

const runGit = (args, cwd) => {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
};

const detectDefaultBranch = (cwd) => {
  const ref = runGit(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], cwd);
  if (ref) {
    const parts = ref.split("/");
    return parts[parts.length - 1] || "main";
  }
  return "main";
};

const hasShortFlag = (token, letter) =>
  token.startsWith("-") && !token.startsWith("--") && token.slice(1).includes(letter);

const extractPushTargetBranches = (args) => {
  const positionals = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "-o" || arg === "--push-option" || arg === "--repo" || arg === "--receive-pack") {
      i += 1;
      continue;
    }
    if (arg.startsWith("-")) continue;
    positionals.push(arg);
  }
  const refspecs = positionals.slice(1);
  return refspecs.map((spec) => {
    const cleaned = spec.startsWith("+") ? spec.slice(1) : spec;
    const dst = cleaned.includes(":") ? cleaned.split(":").pop() : cleaned;
    return dst.replace(/^refs\/heads\//, "");
  });
};

const redactMatch = (value) => {
  if (value.startsWith("-----BEGIN")) return "-----BEGIN ... PRIVATE KEY-----";
  const prefix = value.slice(0, Math.min(4, value.length));
  return `${prefix}****`;
};

const scanDiffForSecrets = (diffText) => {
  if (!diffText) return null;
  for (const line of diffText.split(/\r?\n/)) {
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    const added = line.slice(1);
    for (const pattern of SECRET_PATTERNS) {
      const match = added.match(pattern.regex);
      if (match) {
        return { name: pattern.name, redacted: redactMatch(match[0]) };
      }
    }
  }
  return null;
};

export const evaluateBashCommand = (command, options = {}) => {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const segments = splitSubcommands(command);

  const ghConfig = readGithubConfig(cwd);
  let lastMergeResult = null;

  for (const segment of segments) {
    const rawTokens = tokenize(segment);
    const tokens = stripCommandPrefixes(rawTokens);
    if (tokens.length === 0) continue;

    // 4. Allow `gh pr merge` only under verified CI states (PASS, NO_TESTS, UNAVAILABLE); block `gh api` merge bypasses.
    if (tokens[0] === "gh" && tokens[1] === "pr" && tokens[2] === "merge") {
      const mergeResult = evaluatePrMerge(tokens.slice(3), {
        cwd,
        prState: options.prState,
        autoMergeOnCiPass: options.autoMergeOnCiPass ?? ghConfig.autoMergeOnCiPass,
        mergeMethod: options.mergeMethod ?? ghConfig.mergeMethod,
        mergeMethodExplicit: options.mergeMethodExplicit ?? ghConfig.mergeMethodExplicit,
        allowedMergeMethods: options.allowedMergeMethods ?? null,
        ghApi: options.ghApi,
      });
      if (mergeResult.decision === "deny") {
        return mergeResult;
      }
      lastMergeResult = mergeResult;
      continue;
    }
    if (
      tokens[0] === "gh" &&
      tokens[1] === "api" &&
      tokens.slice(2).some((arg) => /\/pulls\/[^/\s]+\/merge(?:$|\?)|mergePullRequest/.test(arg))
    ) {
      return {
        decision: "deny",
        reason: "Blocked: merging PRs via `gh api` is forbidden. Use `gh pr merge` after CI checks pass.",
      };
    }

    const gitCmd = parseGitSubcommand(tokens);
    if (!gitCmd) continue;

    const { subcommand, args } = gitCmd;

    // 3. Block `--no-verify` (or `git commit -n`) unless explicitly diagnosed/allowed.
    if ((subcommand === "commit" || subcommand === "push") && env.GITHUB_CONVENTION_ALLOW_NO_VERIFY !== "1") {
      const hasNoVerify =
        args.includes("--no-verify") ||
        (subcommand === "commit" && args.some((arg) => hasShortFlag(arg, "n")));
      if (hasNoVerify) {
        return {
          decision: "deny",
          reason:
            "Blocked: `--no-verify` is forbidden by default. Fix hook failures or set `GITHUB_CONVENTION_ALLOW_NO_VERIFY=1` only for a diagnosed tool/environment issue.",
        };
      }
    }

    if (subcommand === "push") {
      const hasForceWithLease = args.some((arg) => arg.startsWith("--force-with-lease"));
      const hasPlainForce =
        args.includes("--force") || args.some((arg) => hasShortFlag(arg, "f"));

      // 1. Block plain `--force` / `-f` without `--force-with-lease`.
      if (hasPlainForce && !hasForceWithLease) {
        return {
          decision: "deny",
          reason:
            "Blocked: plain `git push --force` / `-f` is forbidden. Use `--force-with-lease` only on an owned feature branch after verifying remote state.",
        };
      }

      // 2. Block direct push or deletion push to default/configured protected branch (or main/master).
      const defaultBranch = options.defaultBranch ?? detectDefaultBranch(cwd);
      const configuredBranch = options.configuredDefaultBranch ?? ghConfig.defaultBranch;
      const protectedBranches = new Set([defaultBranch, "main", "master"]);
      if (configuredBranch) {
        protectedBranches.add(configuredBranch);
      }
      const currentBranch =
        options.currentBranch ?? runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
      const targetBranches = extractPushTargetBranches(args);
      const isDeletePush =
        args.includes("--delete") ||
        args.some((arg) => hasShortFlag(arg, "d")) ||
        args.some((arg) => !arg.startsWith("-") && arg.startsWith(":"));

      const pushesProtectedTarget = targetBranches.some((branch) => protectedBranches.has(branch));
      const barePushOnProtectedBranch =
        targetBranches.length === 0 && currentBranch && protectedBranches.has(currentBranch);

      if (pushesProtectedTarget || barePushOnProtectedBranch) {
        return {
          decision: "deny",
          reason: isDeletePush
            ? `Blocked: deleting protected branch (${Array.from(protectedBranches).join("/")}) via \`git push\` is forbidden.`
            : `Blocked: direct push to protected default branch (${configuredBranch || defaultBranch}) is forbidden. Create a feature branch and open a PR instead.`,
        };
      }
    }

    // 5. Block `git commit` when staged diff contains high-confidence secrets.
    if (subcommand === "commit") {
      const stagedDiff = options.stagedDiff ?? runGit(["diff", "--cached", "-U0"], cwd);
      const finding = scanDiffForSecrets(stagedDiff);
      if (finding) {
        return {
          decision: "deny",
          reason: `Blocked: staged changes contain a suspected ${finding.name} (${finding.redacted}). Remove and rotate the secret before committing.`,
        };
      }
    }
  }

  return lastMergeResult
    ? { decision: "allow", ciStatus: lastMergeResult.ciStatus, mergeMethod: lastMergeResult.mergeMethod }
    : { decision: "allow" };
};

export const handleGuardHookInput = (input, options = {}) => {
  const isAntigravity = Boolean(
    input?.toolCall || input?.hookEventName === "PreToolUse" || Array.isArray(input?.workspacePaths),
  );
  const command = input?.tool_input?.command ?? input?.toolCall?.args?.CommandLine ?? "";
  const cwd =
    options.cwd ??
    input?.cwd ??
    (Array.isArray(input?.workspacePaths) ? input.workspacePaths[0] : undefined) ??
    process.cwd();

  const result = evaluateBashCommand(command, { ...options, cwd });

  if (isAntigravity) {
    if (result.decision === "deny") {
      return { decision: "deny", reason: result.reason };
    }
    return { decision: "allow" };
  }

  if (result.decision === "deny") {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: result.reason,
      },
    };
  }

  return null;
};

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  try {
    const raw = fs.readFileSync(0, "utf8").trim();
    if (!raw) process.exit(0);
    const input = JSON.parse(raw);
    const output = handleGuardHookInput(input);
    if (output) {
      process.stdout.write(`${JSON.stringify(output)}\n`);
    }
  } catch {
    // Fail open only on malformed stdin; command safety checks are self-contained.
  }
}
