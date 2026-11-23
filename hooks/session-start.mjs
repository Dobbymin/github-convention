import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VALID_CONTEXT_MODES = new Set(["auto", "compact", "full"]);

const findGitRoot = (startDir) => {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
};

const safeExists = (targetPath) => {
  try {
    return Boolean(targetPath) && fs.existsSync(targetPath);
  } catch {
    return false;
  }
};

const safeReadFile = (targetPath) => {
  try {
    return fs.readFileSync(targetPath, "utf8");
  } catch {
    return null;
  }
};

const hasInstalledClaudePlugin = (installedPluginsPath, pluginName) => {
  const raw = safeReadFile(installedPluginsPath);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    const checkKeys = (obj) => {
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
      return Object.keys(obj).some(
        (key) => key === pluginName || key.startsWith(`${pluginName}@`),
      );
    };
    return checkKeys(parsed) || checkKeys(parsed.plugins);
  } catch {
    return false;
  }
};

export const detectCompanionPlugins = ({
  cwd = process.cwd(),
  gitRoot = null,
  homeDir = null,
} = {}) => {
  const companions = [];
  const baseDirs = Array.from(
    new Set([cwd, gitRoot].filter(Boolean).map((dir) => path.resolve(dir))),
  );
  const harnessSkillDirs = [".agents", ".claude", ".cursor", ".gemini"];

  let hasDevPrinciples = false;

  for (const baseDir of baseDirs) {
    if (safeExists(path.join(baseDir, ".dev-principles.yaml"))) {
      hasDevPrinciples = true;
      break;
    }
    for (const harnessDir of harnessSkillDirs) {
      if (safeExists(path.join(baseDir, harnessDir, "skills", "dev-principles", "SKILL.md"))) {
        hasDevPrinciples = true;
        break;
      }
    }
    if (
      !hasDevPrinciples &&
      (safeExists(path.join(baseDir, ".agents", "plugins", "dev-principles", ".antigravity-plugin", "plugin.json")) ||
        safeExists(path.join(baseDir, ".agents", "plugins", "dev-principles", "skills", "dev-principles", "SKILL.md")))
    ) {
      hasDevPrinciples = true;
    }
    if (hasDevPrinciples) break;
  }

  if (!hasDevPrinciples && homeDir) {
    const resolvedHome = path.resolve(homeDir);
    for (const harnessDir of harnessSkillDirs) {
      if (safeExists(path.join(resolvedHome, harnessDir, "skills", "dev-principles", "SKILL.md"))) {
        hasDevPrinciples = true;
        break;
      }
    }
    if (
      !hasDevPrinciples &&
      (safeExists(path.join(resolvedHome, ".gemini", "config", "skills", "dev-principles", "SKILL.md")) ||
        safeExists(path.join(resolvedHome, ".gemini", "config", "plugins", "dev-principles", ".antigravity-plugin", "plugin.json")) ||
        safeExists(path.join(resolvedHome, ".gemini", "config", "plugins", "dev-principles", "plugin.json")) ||
        safeExists(path.join(resolvedHome, ".gemini", "config", "plugins", "dev-principles", "skills", "dev-principles", "SKILL.md")))
    ) {
      hasDevPrinciples = true;
    }
    if (
      !hasDevPrinciples &&
      safeExists(
        path.join(resolvedHome, ".gemini", "extensions", "dev-principles", "gemini-extension.json"),
      )
    ) {
      hasDevPrinciples = true;
    }
    if (
      !hasDevPrinciples &&
      hasInstalledClaudePlugin(
        path.join(resolvedHome, ".claude", "plugins", "installed_plugins.json"),
        "dev-principles",
      )
    ) {
      hasDevPrinciples = true;
    }
  }

  if (hasDevPrinciples) {
    companions.push("dev-principles");
  }

  return companions;
};

export const resolveContextMode = ({ configText = "", env = process.env } = {}) => {
  const envMode = typeof env.GITHUB_CONVENTION_CONTEXT_MODE === "string"
    ? env.GITHUB_CONVENTION_CONTEXT_MODE.trim().toLowerCase()
    : "";
  if (VALID_CONTEXT_MODES.has(envMode)) {
    return envMode;
  }

  if (configText) {
    const match = configText.match(/^\s*context_mode:\s*["']?([a-zA-Z0-9_-]+)["']?/m);
    const configMode = match ? match[1].toLowerCase() : "";
    if (VALID_CONTEXT_MODES.has(configMode)) {
      return configMode;
    }
  }

  return "auto";
};

const buildCompactContext = ({ modeHeader, companions }) => {
  const companionLine = companions.length > 0
    ? `Companion detected: ${companions.join(", ")} (deduplicated workflow scope).`
    : "Context mode: compact (minimal workflow bootstrap).";

  return [
    modeHeader,
    companionLine,
    "",
    "Priority: safety invariants > project config (.github-convention/config.yaml, repo docs) > user config > plugin defaults.",
    "Scope split: github-convention owns Git/GitHub workflow (Issue, Branch, Worktree, Commit, Push, PR, CI, Release) and Orchestrator Git mutation authority; code architecture, SoC, type safety, and Rule ID reviews remain with dev-principles.",
    "Entry: read `skills/using-github-convention/SKILL.md` and load only the active phase skill (`issue-planning`, `parallel-execution`, `git-pr-workflow`, `review-ci-loop`, `release-and-recovery`).",
    "Guardrails: match user language (keep technical identifiers/prefixes/`Closes #N` verbatim), obtain explicit approval before remote writes/releases/rollbacks, keep Git/GitHub mutations Orchestrator-only (never workers/reviewers), never push default branch, resolve PR conflicts safely (re-verifying on the new commit), and merge OPEN non-Draft conflict-free PRs on CI `PASS`/`NO_TESTS`/`UNAVAILABLE` (always wait on `PENDING`, block `FAIL`/`UNKNOWN`) using `github.merge_method` (`squash`|`merge`|`rebase`, default `squash`) unless `github.auto_merge_on_ci_pass: false`.",
  ].join("\n");
};

const buildStandaloneAutoContext = ({ modeHeader }) =>
  [
    modeHeader,
    "",
    "Priority: safety invariants > project config (.github-convention/config.yaml, repo docs) > user config > plugin defaults.",
    "Entry: `skills/using-github-convention/SKILL.md` (load only the phase skill needed):",
    "- `skills/issue-planning/SKILL.md` (`agents/repo-analyzer.md`, `/gh-plan`) — repo conventions & Issue DAG",
    "- `skills/parallel-execution/SKILL.md` (`agents/task-worker.md`) — isolated worktree workers & diff verification",
    "- `skills/git-pr-workflow/SKILL.md` (`agents/pr-reviewer.md`, `/gh-pr`) — branch, unit commits, gates, PR create/update",
    "- `skills/review-ci-loop/SKILL.md` (`/gh-review`) — PR review triage & bounded CI retries",
    "- `skills/release-and-recovery/SKILL.md` (`/gh-status`, `/gh-doctor`) — secrets, hooks, SemVer release, recovery",
    "",
    "Core invariants:",
    "- Zero-config default from `.github/`, templates, labels, CI, and git history; `.github-convention/config.yaml` overrides when present.",
    "- Language: match user language for Issues, PRs, commits, and reports; keep technical identifiers, commands, prefixes, and `Closes #N` verbatim.",
    "- Approval: require explicit user approval before creating Issues, changing hooks/CI/branch protection, architecture changes from review, tags/releases, or rollbacks.",
    "- Authority: Orchestrator owns all Git/GitHub mutations (Workers/Reviewers never commit, push, or mutate GitHub). Never push directly to default branch; resolve PR conflicts via 10-step flow and merge OPEN non-Draft conflict-free PRs on CI `PASS`/`NO_TESTS`/`UNAVAILABLE` (always wait on `PENDING`, block `FAIL`/`UNKNOWN`) using `github.merge_method` (`squash`|`merge`|`rebase`, default `squash`) unless `github.auto_merge_on_ci_pass: false`.",
  ].join("\n");

const isAntigravityInvocation = ({ stdinInput, env }) =>
  Boolean(
    stdinInput?.hookEventName === "SessionStart" ||
      Array.isArray(stdinInput?.workspacePaths) ||
      (env.PLUGIN_ROOT && !env.CLAUDE_PLUGIN_ROOT && !env.CURSOR_PLUGIN_ROOT),
  );

export const buildSessionStartPayload = ({
  cwd,
  env = process.env,
  pluginRoot = DEFAULT_PLUGIN_ROOT,
  homeDir,
  stdinInput = null,
} = {}) => {
  const effectiveCwd =
    cwd ?? stdinInput?.cwd ?? (Array.isArray(stdinInput?.workspacePaths) ? stdinInput.workspacePaths[0] : undefined) ?? process.cwd();
  const isAntigravity = isAntigravityInvocation({ stdinInput, env });

  const gitRoot = findGitRoot(effectiveCwd);
  const cwdConfigPath = path.join(effectiveCwd, ".github-convention", "config.yaml");
  const rootConfigPath = gitRoot !== null ? path.join(gitRoot, ".github-convention", "config.yaml") : null;
  const configPath = safeExists(cwdConfigPath)
    ? cwdConfigPath
    : rootConfigPath && safeExists(rootConfigPath)
      ? rootConfigPath
      : null;
  const hasConfig = configPath !== null;

  if (!gitRoot && !hasConfig) {
    return isAntigravity ? { injectSteps: [] } : null;
  }

  const effectiveHomeDir =
    homeDir !== undefined
      ? homeDir
      : env.HOME || env.USERPROFILE || (env === process.env ? os.homedir() : null);

  const configText = configPath ? safeReadFile(configPath) ?? "" : "";
  const contextMode = resolveContextMode({ configText, env });
  const companions = detectCompanionPlugins({ cwd: effectiveCwd, gitRoot, homeDir: effectiveHomeDir });

  const modeHeader = hasConfig
    ? "github-convention active (.github-convention/config.yaml detected)."
    : "github-convention active (zero-config git repository detected).";

  let additionalContext;
  if (contextMode === "full") {
    const bootstrapPath = path.join(pluginRoot, "skills", "using-github-convention", "SKILL.md");
    const bootstrapContent = safeExists(bootstrapPath)
      ? (safeReadFile(bootstrapPath) ?? "").trim()
      : "Follow skills/using-github-convention/SKILL.md.";
    const boundaryNote = companions.length > 0
      ? `\n\nCompanion detected: ${companions.join(", ")} (code architecture/Rule ID reviews stay with ${companions.join(", ")}; Git/GitHub workflow & Orchestrator authority stay with github-convention).`
      : "";
    additionalContext = `${modeHeader}\n\n${bootstrapContent}${boundaryNote}`;
  } else if (contextMode === "compact" || companions.length > 0) {
    additionalContext = buildCompactContext({ modeHeader, companions });
  } else {
    additionalContext = buildStandaloneAutoContext({ modeHeader });
  }

  if (isAntigravity) {
    return {
      injectSteps: [
        {
          systemMessage: {
            systemMessage: additionalContext,
          },
        },
      ],
    };
  }

  if (env.CURSOR_PLUGIN_ROOT) {
    return { additional_context: additionalContext };
  }

  if (env.CLAUDE_PLUGIN_ROOT && !env.COPILOT_CLI) {
    return {
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext,
      },
    };
  }

  return { additionalContext };
};

const readStdinIfAvailable = (timeoutMs = 50) =>
  new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve("");
      return;
    }
    const chunks = [];
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.stdin.removeListener("data", onData);
      process.stdin.removeListener("end", finish);
      process.stdin.removeListener("error", finish);
      process.stdin.pause();
      resolve(Buffer.concat(chunks).toString("utf8").trim());
    };
    const timer = setTimeout(finish, timeoutMs);
    timer.unref();
    const onData = (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    };
    process.stdin.on("data", onData);
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
    process.stdin.resume();
  });

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  try {
    const rawStdin = await readStdinIfAvailable();
    let stdinInput = null;
    if (rawStdin) {
      try {
        stdinInput = JSON.parse(rawStdin);
      } catch {
        stdinInput = null;
      }
    }
    const payload = buildSessionStartPayload({ stdinInput });
    if (payload) {
      process.stdout.write(`${JSON.stringify(payload)}\n`);
    }
  } catch {
    // Never block session startup on hook errors.
  }
}
