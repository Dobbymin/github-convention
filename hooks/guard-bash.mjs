import { execFileSync } from "node:child_process";
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
          return {
            defaultBranch: configured && configured !== "detect" ? configured : null,
            autoMergeOnCiPass: autoMergeMatch ? autoMergeMatch[1].toLowerCase() === "true" : true,
            mergeMethod: resolveMergeMethod(mergeMethodMatch ? mergeMethodMatch[1] : "squash"),
          };
        }
      }
    } catch {
      // Ignore unreadable config; fallback to defaults.
    }
    if (fs.existsSync(path.join(current, ".git"))) {
      return { defaultBranch: null, autoMergeOnCiPass: true, mergeMethod: "squash" };
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return { defaultBranch: null, autoMergeOnCiPass: true, mergeMethod: "squash" };
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

const inspectCheckRunUnavailableViaGh = (check, cwd) => {
  const detailsUrl = String(check?.detailsUrl ?? "");
  const jobMatch = detailsUrl.match(/\/github\.com\/([^/]+\/[^/]+)\/actions\/runs\/\d+\/job\/(\d+)/);
  if (!jobMatch) return false;
  const [, repoSlug, jobId] = jobMatch;
  try {
    const rawJob = execFileSync("gh", ["api", `repos/${repoSlug}/actions/jobs/${jobId}`], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const job = JSON.parse(rawJob);
    const steps = Array.isArray(job?.steps) ? job.steps : [];
    if (steps.length > 0) {
      return false;
    }
    const rawAnnotations = execFileSync(
      "gh",
      ["api", `repos/${repoSlug}/check-runs/${jobId}/annotations`],
      {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    const annotations = JSON.parse(rawAnnotations);
    return (
      Array.isArray(annotations) &&
      annotations.some((ann) => isUnavailableMessage(ann?.message) || isUnavailableMessage(ann?.title))
    );
  } catch {
    return false;
  }
};

const inspectPrMergeReadiness = (prRef, cwd) => {
  try {
    const ghArgs = ["pr", "view"];
    if (prRef) ghArgs.push(prRef);
    ghArgs.push("--json", "isDraft,state,mergeable,mergeStateStatus,statusCheckRollup");
    const raw = execFileSync("gh", ghArgs, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const parsed = JSON.parse(raw);
    return {
      ok: true,
      isDraft: Boolean(parsed?.isDraft),
      state: parsed?.state ?? "OPEN",
      mergeable: parsed?.mergeable ?? null,
      mergeStateStatus: parsed?.mergeStateStatus ?? null,
      ciQueryFailed: parsed?.statusCheckRollup === undefined,
      checks: Array.isArray(parsed?.statusCheckRollup) ? parsed.statusCheckRollup : [],
    };
  } catch {
    return { ok: false, isDraft: false, state: "UNKNOWN", checks: [] };
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

const isCheckExplicitlyUnavailable = (check, { cwd } = {}) => {
  if (!check || typeof check !== "object") return false;
  if (check.unavailable === true || check.billingBlocked === true || check.ciDisabled === true) {
    return true;
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
      return false;
    }
    return true;
  }
  const conclusion = String(check.conclusion ?? "").toUpperCase();
  if ((conclusion === "FAILURE" || conclusion === "STARTUP_FAILURE") && cwd && check.detailsUrl) {
    return inspectCheckRunUnavailableViaGh(check, cwd);
  }
  return false;
};

export const classifyCiStatus = (prState, { cwd } = {}) => {
  if (!prState || prState.ok === false) {
    return {
      status: "UNKNOWN",
      reason: "PR status query failed or PR could not be verified.",
      passing: [],
      failing: [],
      pending: [],
      unavailable: [],
      unknown: [],
    };
  }

  const checks = Array.isArray(prState.checks) ? prState.checks : null;
  const passing = [];
  const failing = [];
  const pending = [];
  const unavailable = [];
  const unknown = [];

  if (checks) {
    for (const check of checks) {
      const name = check?.name || check?.context || "check";
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

      if (isCheckExplicitlyUnavailable(check, { cwd })) {
        unavailable.push(name);
        continue;
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

  // Real test failures are NEVER ignored, even if CI query partially failed or other jobs are unavailable.
  if (failing.length > 0) {
    return {
      status: "FAIL",
      reason: `Failing CI check(s): ${failing.join(", ")}.`,
      passing,
      failing,
      pending,
      unavailable,
      unknown,
    };
  }

  // In-progress checks must NEVER be treated as UNAVAILABLE; always wait.
  if (pending.length > 0) {
    return {
      status: "PENDING",
      reason: `Pending CI check(s): ${pending.join(", ")}.`,
      passing,
      failing,
      pending,
      unavailable,
      unknown,
    };
  }

  // CI query failure vs UNAVAILABLE distinction: if CI status query failed or returned unrecognized check states, classify as UNKNOWN.
  if (prState.ciQueryFailed || prState.checksError || checks === null || unknown.length > 0) {
    return {
      status: "UNKNOWN",
      reason:
        unknown.length > 0
          ? `Unrecognized CI check state(s): ${unknown.join(", ")}.`
          : "CI check status could not be queried reliably.",
      passing,
      failing,
      pending,
      unavailable,
      unknown,
    };
  }

  // Explicit repository/account-level CI unavailability (Actions disabled, billing/quota block).
  if (
    prState.ciUnavailable === true ||
    prState.actionsDisabled === true ||
    prState.billingLimited === true ||
    isUnavailableMessage(prState.ciUnavailableReason) ||
    (unavailable.length > 0 && passing.length === 0)
  ) {
    return {
      status: "UNAVAILABLE",
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
    };
  }

  // No tests / no CI checks configured on project.
  if (checks.length === 0 || prState.noTests === true) {
    return {
      status: "NO_TESTS",
      reason: "No CI checks or tests configured for this project.",
      passing,
      failing,
      pending,
      unavailable,
      unknown,
    };
  }

  return {
    status: "PASS",
    reason: "All CI checks passed.",
    passing,
    failing,
    pending,
    unavailable,
    unknown,
  };
};

export const evaluateConflictResolution = ({
  hasConflicts = false,
  conflictType = "none",
  resolved = false,
  preservedChanges = true,
  withinIssueScope = true,
  headCommitUpdated = true,
  localChecksPassed = true,
  ciStateAfterResolution = null,
  autoMergeOnCiPass = true,
} = {}) => {
  if (!hasConflicts) {
    const ci = ciStateAfterResolution ? classifyCiStatus(ciStateAfterResolution) : { status: "PASS" };
    if (ci.status === "FAIL" || ci.status === "UNKNOWN") {
      return { action: "block", canMerge: false, ciStatus: ci.status, reason: ci.reason };
    }
    if (ci.status === "PENDING") {
      return { action: "wait", canMerge: false, ciStatus: ci.status, reason: ci.reason };
    }
    return {
      action: autoMergeOnCiPass === false ? "manual_merge" : "merge",
      canMerge: autoMergeOnCiPass !== false,
      ciStatus: ci.status,
      reason: "No conflicts detected; ready for merge evaluation.",
    };
  }

  if (conflictType === "complex" || conflictType === "ambiguous" || conflictType === "design") {
    return {
      action: "ask_user",
      canMerge: false,
      ciStatus: "UNKNOWN",
      reason: "Complex or design-impacting merge conflict requires explicit user confirmation.",
    };
  }

  if (!preservedChanges) {
    return {
      action: "block",
      canMerge: false,
      ciStatus: "UNKNOWN",
      reason: "Blocked: conflict resolution lost existing branch changes or Issue requirements.",
    };
  }

  if (!withinIssueScope) {
    return {
      action: "block",
      canMerge: false,
      ciStatus: "UNKNOWN",
      reason: "Blocked: conflict resolution introduced out-of-scope changes beyond the Issue.",
    };
  }

  if (!resolved) {
    return {
      action: "block",
      canMerge: false,
      ciStatus: "UNKNOWN",
      reason: "Blocked: PR conflicts remain unresolved.",
    };
  }

  if (!localChecksPassed) {
    return {
      action: "block",
      canMerge: false,
      ciStatus: "FAIL",
      reason: "Blocked: local tests or quality gates failed after resolving conflicts.",
    };
  }

  if (!headCommitUpdated) {
    return {
      action: "block",
      canMerge: false,
      ciStatus: "UNKNOWN",
      reason: "Blocked: CI results from a prior commit cannot be reused after conflict resolution.",
    };
  }

  const ci = classifyCiStatus(ciStateAfterResolution ?? { ok: true, checks: [] });
  if (ci.status === "FAIL") {
    return {
      action: "block",
      canMerge: false,
      ciStatus: "FAIL",
      reason: `Blocked: CI failed on the conflict-resolution commit (${ci.reason})`,
    };
  }
  if (ci.status === "PENDING") {
    return {
      action: "wait",
      canMerge: false,
      ciStatus: "PENDING",
      reason: `Wait: CI is still running on the conflict-resolution commit (${ci.reason})`,
    };
  }
  if (ci.status === "UNKNOWN") {
    return {
      action: "block",
      canMerge: false,
      ciStatus: "UNKNOWN",
      reason: `Blocked: CI status on the conflict-resolution commit is unknown (${ci.reason})`,
    };
  }

  // PASS, NO_TESTS, or UNAVAILABLE
  return {
    action: autoMergeOnCiPass === false ? "manual_merge" : "merge",
    canMerge: autoMergeOnCiPass !== false,
    ciStatus: ci.status,
    reason: `Conflicts resolved and verified on new commit (CI status: ${ci.status}).`,
  };
};

const evaluatePrMerge = (args, { cwd, prState, autoMergeOnCiPass }) => {
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

  const prRef = extractPrMergeTarget(args);
  const state = prState ?? inspectPrMergeReadiness(prRef, cwd);
  if (!state || state.ok === false) {
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

  const ci = classifyCiStatus(state, { cwd });

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
  return { decision: "allow", ciStatus: ci.status };
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
  let lastMergeStatus = null;

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
      });
      if (mergeResult.decision === "deny") {
        return mergeResult;
      }
      lastMergeStatus = mergeResult.ciStatus;
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

  return lastMergeStatus ? { decision: "allow", ciStatus: lastMergeStatus } : { decision: "allow" };
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
