import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

export const buildSessionStartPayload = ({
  cwd = process.cwd(),
  env = process.env,
  pluginRoot = DEFAULT_PLUGIN_ROOT,
} = {}) => {
  const gitRoot = findGitRoot(cwd);
  const configInCwd = fs.existsSync(path.join(cwd, ".github-convention", "config.yaml"));
  const configInRoot =
    gitRoot !== null && fs.existsSync(path.join(gitRoot, ".github-convention", "config.yaml"));
  const hasConfig = configInCwd || configInRoot;

  if (!gitRoot && !hasConfig) {
    return null;
  }

  const bootstrapPath = path.join(pluginRoot, "skills", "using-github-convention", "SKILL.md");
  const bootstrapContent = fs.existsSync(bootstrapPath)
    ? fs.readFileSync(bootstrapPath, "utf8").trim()
    : "Follow skills/using-github-convention/SKILL.md.";

  const modeHeader = hasConfig
    ? "github-convention active (.github-convention/config.yaml detected)."
    : "github-convention active (zero-config git repository detected).";

  const additionalContext = `${modeHeader}\n\n${bootstrapContent}`;

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

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  try {
    const payload = buildSessionStartPayload();
    if (payload) {
      process.stdout.write(`${JSON.stringify(payload)}\n`);
    }
  } catch {
    // Never block session startup on hook errors.
  }
}
