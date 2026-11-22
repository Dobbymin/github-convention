#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectCompanionPlugins, resolveContextMode } from "../hooks/session-start.mjs";

const DEFAULT_PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_FILE = ".github-convention-install-manifest";

const safeExec = (cmd, args, cwd) => {
  try {
    return execFileSync(cmd, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
};

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

const inspectInstallManifest = (skillsDir) => {
  const resolvedDir = path.resolve(skillsDir);
  const manifestPath = path.join(resolvedDir, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) {
    return { target: resolvedDir, status: "not_installed", entries: 0, missingEntries: [] };
  }
  try {
    const raw = fs.readFileSync(manifestPath, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    if (!lines.includes("plugin=github-convention")) {
      return { target: resolvedDir, status: "unmanaged", entries: 0, missingEntries: [] };
    }
    const entryLines = lines.filter((line) => line.startsWith("entry|"));
    const missingEntries = [];
    for (const line of entryLines) {
      const parts = line.split("|");
      const skillName = parts[1];
      const destPath = parts[3];
      if (!destPath || !fs.existsSync(destPath)) {
        missingEntries.push(skillName || destPath || "unknown");
      }
    }
    return {
      target: resolvedDir,
      status: missingEntries.length === 0 ? "ok" : "missing_entries",
      entries: entryLines.length,
      missingEntries,
    };
  } catch {
    return { target: resolvedDir, status: "unreadable", entries: 0, missingEntries: [] };
  }
};

export const runDoctor = ({
  cwd = process.cwd(),
  env = process.env,
  pluginRoot = DEFAULT_PLUGIN_ROOT,
  homeDir,
  target = null,
} = {}) => {
  const resolvedCwd = path.resolve(cwd);
  const effectiveHomeDir =
    homeDir !== undefined
      ? homeDir
      : env.HOME || env.USERPROFILE || (env === process.env ? os.homedir() : null);

  const gitVersion = safeExec("git", ["--version"], resolvedCwd);
  const gitRoot = findGitRoot(resolvedCwd);
  const originHead = gitRoot ? safeExec("git", ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], gitRoot) : null;
  const defaultBranch = originHead ? originHead.split("/").pop() : null;
  const currentBranch = gitRoot ? safeExec("git", ["rev-parse", "--abbrev-ref", "HEAD"], gitRoot) : null;

  const ghVersion = safeExec("gh", ["--version"], resolvedCwd);
  let ghAuthenticated = false;
  if (ghVersion) {
    const authRes = spawnSync("gh", ["auth", "status"], {
      cwd: resolvedCwd,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    ghAuthenticated = authRes.status === 0;
  }

  const baseForConventions = gitRoot ?? resolvedCwd;
  const configPath = path.join(baseForConventions, ".github-convention", "config.yaml");
  const configText = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";

  const conventions = {
    issueTemplatesDir: fs.existsSync(path.join(baseForConventions, ".github", "ISSUE_TEMPLATE")),
    prTemplate: fs.existsSync(path.join(baseForConventions, ".github", "pull_request_template.md")),
    workflowsDir: fs.existsSync(path.join(baseForConventions, ".github", "workflows")),
    projectConfig: fs.existsSync(configPath),
  };

  const hooks = {
    claudeHooksJson: fs.existsSync(path.join(pluginRoot, "hooks", "hooks.json")),
    antigravityHooksJson: fs.existsSync(path.join(pluginRoot, "hooks.json")),
    sessionStartScript: fs.existsSync(path.join(pluginRoot, "hooks", "session-start.mjs")),
    guardBashScript: fs.existsSync(path.join(pluginRoot, "hooks", "guard-bash.mjs")),
  };

  const companions = detectCompanionPlugins({
    cwd: resolvedCwd,
    gitRoot,
    homeDir: effectiveHomeDir,
  });
  const contextMode = resolveContextMode({ configText, env });

  const manifestTargets = target
    ? [target]
    : [
        path.join(resolvedCwd, ".agents", "skills"),
        ...(effectiveHomeDir ? [path.join(effectiveHomeDir, ".agents", "skills")] : []),
      ];
  const installManifests = manifestTargets.map(inspectInstallManifest);

  return {
    ok: Boolean(gitVersion) && hooks.sessionStartScript && hooks.guardBashScript,
    git: {
      installed: Boolean(gitVersion),
      version: gitVersion,
      gitRoot,
      defaultBranch,
      currentBranch,
    },
    gh: {
      installed: Boolean(ghVersion),
      authenticated: ghAuthenticated,
    },
    conventions,
    hooks,
    session: {
      companions,
      contextMode,
    },
    installManifests,
  };
};

const formatTextReport = (report) => {
  const lines = [
    `github-convention doctor (${report.ok ? "OK" : "ISSUES"})`,
    `- Git: ${report.git.installed ? report.git.version : "not found"} | root: ${report.git.gitRoot ?? "none"} | default: ${report.git.defaultBranch ?? "unknown"} | branch: ${report.git.currentBranch ?? "none"}`,
    `- GitHub CLI: ${report.gh.installed ? "installed" : "missing"} | auth: ${report.gh.authenticated ? "authenticated" : "unauthenticated"}`,
    `- Conventions: issueTemplates=${report.conventions.issueTemplatesDir}, prTemplate=${report.conventions.prTemplate}, workflows=${report.conventions.workflowsDir}, config=${report.conventions.projectConfig}`,
    `- Hooks: claude=${report.hooks.claudeHooksJson}, antigravity=${report.hooks.antigravityHooksJson}, sessionStart=${report.hooks.sessionStartScript}, guardBash=${report.hooks.guardBashScript}`,
    `- Session: companions=[${report.session.companions.join(", ")}], contextMode=${report.session.contextMode}`,
    `- Install Manifests:`,
    ...report.installManifests.map(
      (m) => `  - ${m.target}: ${m.status} (entries=${m.entries}${m.missingEntries.length ? `, missing=[${m.missingEntries.join(", ")}]` : ""})`,
    ),
  ];
  return `${lines.join("\n")}\n`;
};

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  const args = process.argv.slice(2);
  let json = false;
  let cwd = process.cwd();
  let target = null;

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--json") {
      json = true;
    } else if (args[i] === "--cwd" && args[i + 1]) {
      cwd = args[i + 1];
      i += 1;
    } else if (args[i] === "--target" && args[i + 1]) {
      target = args[i + 1];
      i += 1;
    } else if (args[i] === "-h" || args[i] === "--help") {
      process.stdout.write("Usage: node scripts/doctor.mjs [--cwd <dir>] [--target <dir>] [--json]\n");
      process.exit(0);
    }
  }

  const report = runDoctor({ cwd, target });
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : formatTextReport(report));
}
