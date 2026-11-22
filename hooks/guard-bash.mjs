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
  // positionals[0] is remote (if any), positionals[1..] are refspecs.
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

  for (const segment of segments) {
    const tokens = tokenize(segment);
    if (tokens.length === 0) continue;

    // 4. Never allow `gh pr merge` (user owns merge).
    if (tokens[0] === "gh" && tokens[1] === "pr" && tokens[2] === "merge") {
      return {
        decision: "deny",
        reason: "Blocked: `gh pr merge` is forbidden. The user owns PR merging.",
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

      // 2. Block direct push to default branch (or main/master).
      const defaultBranch = options.defaultBranch ?? detectDefaultBranch(cwd);
      const protectedBranches = new Set([defaultBranch, "main", "master"]);
      const currentBranch =
        options.currentBranch ?? runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
      const targetBranches = extractPushTargetBranches(args);

      const pushesProtectedTarget = targetBranches.some((branch) => protectedBranches.has(branch));
      const barePushOnProtectedBranch =
        targetBranches.length === 0 && currentBranch && protectedBranches.has(currentBranch);

      if (pushesProtectedTarget || barePushOnProtectedBranch) {
        return {
          decision: "deny",
          reason: `Blocked: direct push to protected default branch (${defaultBranch}) is forbidden. Create a feature branch and open a PR instead.`,
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

  return { decision: "allow" };
};

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  try {
    const raw = fs.readFileSync(0, "utf8").trim();
    if (!raw) process.exit(0);
    const input = JSON.parse(raw);
    const command = input?.tool_input?.command ?? "";
    const cwd = input?.cwd ?? process.cwd();
    const result = evaluateBashCommand(command, { cwd });
    if (result.decision === "deny") {
      process.stdout.write(
        `${JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: result.reason,
          },
        })}\n`,
      );
    }
  } catch {
    // Fail open only on malformed stdin; command safety checks are self-contained.
  }
}
