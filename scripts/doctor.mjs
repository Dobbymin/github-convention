#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectCompanionPlugins, resolveContextMode } from "../hooks/session-start.mjs";
import {
  canonicalizePath,
  isOwnedCopyDir,
  isOwnedManifest,
  isOwnedSymlink,
  isSafeSkillName,
  verifyDestWithinTarget,
} from "./install.mjs";

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

const inspectInstallManifest = (skillsDir, pluginRoot = DEFAULT_PLUGIN_ROOT) => {
  const resolvedDir = canonicalizePath(skillsDir);
  const canonRoot = canonicalizePath(pluginRoot);
  const skillsRoot = path.join(canonRoot, "skills");
  const manifestPath = path.join(resolvedDir, MANIFEST_FILE);
  try {
    fs.lstatSync(manifestPath);
  } catch {
    return {
      target: resolvedDir,
      status: "not_installed",
      entries: 0,
      missingEntries: [],
      tamperedEntries: [],
    };
  }
  try {
    if (!isOwnedManifest(manifestPath)) {
      return {
        target: resolvedDir,
        status: "unmanaged",
        entries: 0,
        missingEntries: [],
        tamperedEntries: [],
      };
    }
    const raw = fs.readFileSync(manifestPath, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const entryLines = lines.filter((line) => line.startsWith("entry|"));
    const missingEntries = [];
    const tamperedEntries = [];
    for (const line of entryLines) {
      const parts = line.split("|");
      const skillName = parts[1] ?? "";
      const mode = parts[2] ?? "";
      const destPath = parts[3] ? canonicalizePath(parts[3]) : path.join(resolvedDir, skillName);
      const expectedSource = parts[4]
        ? canonicalizePath(parts[4])
        : path.join(skillsRoot, skillName);

      if (!isSafeSkillName(skillName) || !verifyDestWithinTarget(destPath, resolvedDir, canonRoot, skillName)) {
        tamperedEntries.push(skillName || destPath || "unknown");
        continue;
      }

      let stat;
      try {
        stat = fs.lstatSync(destPath);
      } catch {
        missingEntries.push(skillName);
        continue;
      }

      if (mode === "symlink") {
        if (!stat.isSymbolicLink() || !isOwnedSymlink(destPath, expectedSource, skillsRoot)) {
          tamperedEntries.push(skillName);
        }
      } else if (mode === "copy") {
        if (!stat.isDirectory() || stat.isSymbolicLink() || !isOwnedCopyDir(destPath, skillName, destPath, expectedSource, skillsRoot)) {
          tamperedEntries.push(skillName);
        }
      } else {
        tamperedEntries.push(skillName);
      }
    }
    let status = "ok";
    if (tamperedEntries.length > 0) {
      status = "tampered_entries";
    } else if (missingEntries.length > 0) {
      status = "missing_entries";
    }
    return {
      target: resolvedDir,
      status,
      entries: entryLines.length,
      missingEntries,
      tamperedEntries,
    };
  } catch {
    return {
      target: resolvedDir,
      status: "unreadable",
      entries: 0,
      missingEntries: [],
      tamperedEntries: [],
    };
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
  const installManifests = manifestTargets.map((t) => inspectInstallManifest(t, pluginRoot));

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
      (m) =>
        `  - ${m.target}: ${m.status} (entries=${m.entries}${m.missingEntries.length ? `, missing=[${m.missingEntries.join(", ")}]` : ""}${m.tamperedEntries?.length ? `, tampered=[${m.tamperedEntries.join(", ")}]` : ""})`,
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
