import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getAllAdapters } from "@dobbymin/github-convention-agent-adapters";
import {
  analyzeRepository,
  loadConfigFile,
  loadManifest,
  resolveConfig,
  validateConfig,
  verifyManifestIntegrity,
  type ConventionConflict,
} from "@dobbymin/github-convention-core";
import { runList } from "../list/index.js";
import type {
  AgentDiagnosticSummary,
  ConfigDiagnostics,
  IntegrityDiagnostics,
  IntegrityTargetResult,
  PermissionsDiagnostics,
  SystemDiagnostics,
  ToolingDiagnostics,
} from "./types.js";

export const defaultExec = (
  command: string,
  args: string[],
): { status: number | null; stdout: string; stderr: string } => {
  try {
    const res = childProcess.spawnSync(command, args, {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return {
      status: res.status,
      stdout: res.stdout || "",
      stderr: res.stderr || "",
    };
  } catch (err) {
    return {
      status: -1,
      stdout: "",
      stderr: String(err),
    };
  }
};

export function probeSystem(): SystemDiagnostics {
  const version = process.version;
  const major = parseInt(version.replace(/^v/, "").split(".")[0] || "0", 10);
  const nodeSupported = major >= 20;

  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: version,
    nodeSupported,
    minNodeVersion: ">=20.0.0",
  };
}

export function probeTooling(
  execFn: (
    cmd: string,
    args: string[],
  ) => { status: number | null; stdout: string; stderr: string } = defaultExec,
): ToolingDiagnostics {
  // Git probe
  const gitRes = execFn("git", ["--version"]);
  const gitInstalled = gitRes.status === 0;
  const gitVersion = gitInstalled ? gitRes.stdout.trim() : null;

  // GH probe
  const ghRes = execFn("gh", ["--version"]);
  const ghInstalled = ghRes.status === 0;
  const ghVersion = ghInstalled ? ghRes.stdout.split("\n")[0]?.trim() || null : null;

  // GH auth status
  let ghAuthenticated = false;
  let ghUser: string | null = null;

  if (ghInstalled) {
    const authRes = execFn("gh", ["auth", "status"]);
    if (authRes.status === 0) {
      ghAuthenticated = true;
      const combined = `${authRes.stdout}\n${authRes.stderr}`;
      const match = /account\s+([A-Za-z0-9_-]+)/i.exec(combined);
      if (match) {
        ghUser = match[1];
      }
    }
  }

  return {
    git: {
      installed: gitInstalled,
      version: gitVersion,
    },
    gh: {
      installed: ghInstalled,
      version: ghVersion,
      authenticated: ghAuthenticated,
      user: ghUser,
    },
  };
}

export function probeAgents(
  projectRoot: string = process.cwd(),
  globalRoot: string = os.homedir(),
): AgentDiagnosticSummary[] {
  const adapters = getAllAdapters();

  return adapters.map((adapter) => {
    const detection = adapter.detect({ projectDir: projectRoot, homeDir: globalRoot });
    const targetPath = detection.paths.projectSkillDir;
    const pathExists = fs.existsSync(targetPath);

    let modifiable = false;
    try {
      let checkDir = targetPath;
      while (!fs.existsSync(checkDir) && path.dirname(checkDir) !== checkDir) {
        checkDir = path.dirname(checkDir);
      }
      fs.accessSync(checkDir, fs.constants.W_OK);
      modifiable = true;
    } catch {
      modifiable = false;
    }

    return {
      id: adapter.id,
      name: adapter.name,
      confidence: detection.confidence,
      targetPath,
      pathExists,
      modifiable,
      capabilities: adapter.capabilities,
    };
  });
}

export const findProjectConfigFile = (projectRoot: string): string | null => {
  const candidates = [
    path.join(projectRoot, ".github-convention", "config.yaml"),
    path.join(projectRoot, ".github-convention", "config.yml"),
    path.join(projectRoot, ".github-convention", "config.json"),
    path.join(projectRoot, ".github-convention.yaml"),
    path.join(projectRoot, ".github-convention.yml"),
    path.join(projectRoot, ".github-convention.json"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  return null;
};

export const findGlobalConfigFile = (globalRoot: string): string | null => {
  const candidates = [
    path.join(globalRoot, ".github-convention", "config.yaml"),
    path.join(globalRoot, ".github-convention", "config.yml"),
    path.join(globalRoot, ".github-convention", "config.json"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  return null;
};

export function probeConfig(
  projectRoot: string = process.cwd(),
  explicitConfigPath?: string,
  globalRoot: string = os.homedir(),
): ConfigDiagnostics {
  const configPath: string | null = explicitConfigPath ?? findProjectConfigFile(projectRoot);
  const globalConfigPath = findGlobalConfigFile(globalRoot);

  const hasProject = Boolean(configPath && fs.existsSync(configPath));
  const hasGlobal = Boolean(globalConfigPath && fs.existsSync(globalConfigPath));

  if (!hasProject && !hasGlobal) {
    return {
      found: false,
      path: configPath,
      valid: true,
      errors: [],
      warnings: [],
    };
  }

  try {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (hasProject && configPath) {
      const parsed = loadConfigFile(configPath);
      const validation = validateConfig(parsed);
      errors.push(...validation.errors.map((e) => `[${e.path}] ${e.message}`));
      warnings.push(...validation.warnings.map((w) => `[${w.path}] ${w.message}`));
    }

    if (errors.length === 0) {
      const resolved = resolveConfig({
        ...(hasGlobal && globalConfigPath ? { globalConfigPath } : {}),
        ...(hasProject && configPath ? { projectConfigPath: configPath } : {}),
      });
      for (const w of resolved.warnings) {
        const msg = `[${w.path}] ${w.message}`;
        if (!warnings.includes(msg)) {
          warnings.push(msg);
        }
      }
    }

    return {
      found: true,
      path: configPath ?? globalConfigPath,
      valid: errors.length === 0,
      errors,
      warnings,
    };
  } catch (err) {
    return {
      found: true,
      path: configPath ?? globalConfigPath,
      valid: false,
      errors: [err instanceof Error ? err.message : String(err)],
      warnings: [],
    };
  }
}

export function probeIntegrity(
  projectRoot: string = process.cwd(),
  globalRoot: string = os.homedir(),
): IntegrityDiagnostics {
  const canonicalDir = path.join(projectRoot, ".agents", "skills", "github-convention");
  const seen = new Set<string>();
  const targets: IntegrityTargetResult[] = [];

  const inspectDir = (agentId: string, scope: string, skillDir: string): void => {
    const resolved = path.resolve(skillDir);
    if (seen.has(resolved)) return;
    seen.add(resolved);

    if (!fs.existsSync(resolved)) return;
    try {
      if (fs.lstatSync(resolved).isSymbolicLink()) return;
    } catch {
      return;
    }

    const manifest = loadManifest(resolved);
    if (!manifest) {
      targets.push({
        agentId,
        scope,
        skillDir: resolved,
        manifestFound: false,
        integrity: null,
      });
      return;
    }

    targets.push({
      agentId,
      scope,
      skillDir: resolved,
      manifestFound: true,
      integrity: verifyManifestIntegrity(resolved, manifest),
    });
  };

  inspectDir("canonical", "project", canonicalDir);

  const listResult = runList({ projectRoot, homeDir: globalRoot });
  for (const agent of listResult.agents) {
    if (agent.project.installed && !agent.project.symlink) {
      inspectDir(agent.agentId, "project", agent.project.path);
    }
    if (agent.global.installed && !agent.global.symlink) {
      inspectDir(agent.agentId, "global", agent.global.path);
    }
  }

  if (targets.length === 0) {
    return {
      installed: false,
      skillDir: canonicalDir,
      manifestFound: false,
      integrity: null,
      targets: [],
    };
  }

  const canonicalTarget = targets.find((t) => t.agentId === "canonical") ?? targets[0];
  return {
    installed: true,
    skillDir: canonicalTarget.skillDir,
    manifestFound: targets.every((t) => t.manifestFound),
    integrity: canonicalTarget.integrity,
    targets,
  };
}

export function probeConventionConflicts(
  projectRoot: string = process.cwd(),
): ConventionConflict[] {
  const { analysis } = analyzeRepository({ projectRoot, dryRun: true });
  return analysis.conflicts.filter((c) => c.status === "unresolved");
}

export function probePermissions(projectRoot: string = process.cwd()): PermissionsDiagnostics {
  let projectReadable = false;
  let projectWritable = false;

  try {
    fs.accessSync(projectRoot, fs.constants.R_OK);
    projectReadable = true;
  } catch {
    projectReadable = false;
  }

  try {
    fs.accessSync(projectRoot, fs.constants.W_OK);
    projectWritable = true;
  } catch {
    projectWritable = false;
  }

  return {
    projectReadable,
    projectWritable,
  };
}
