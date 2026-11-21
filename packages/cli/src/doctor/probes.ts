import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getAllAdapters } from "@github-convention/agent-adapters";
import {
  loadConfigFile,
  loadManifest,
  validateConfig,
  verifyManifestIntegrity,
} from "@github-convention/core";
import type {
  AgentDiagnosticSummary,
  ConfigDiagnostics,
  IntegrityDiagnostics,
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

export function probeConfig(
  projectRoot: string = process.cwd(),
  explicitConfigPath?: string,
): ConfigDiagnostics {
  let configPath: string | null = explicitConfigPath ?? null;

  if (!configPath) {
    const candidates = [
      path.join(projectRoot, ".github-convention.yaml"),
      path.join(projectRoot, ".github-convention.yml"),
      path.join(projectRoot, ".github-convention.json"),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        configPath = c;
        break;
      }
    }
  }

  if (!configPath || !fs.existsSync(configPath)) {
    return {
      found: false,
      path: configPath,
      valid: true,
      errors: [],
      warnings: [],
    };
  }

  try {
    const parsed = loadConfigFile(configPath);
    const validation = validateConfig(parsed);

    return {
      found: true,
      path: configPath,
      valid: validation.valid,
      errors: validation.errors.map((e) => `[${e.path}] ${e.message}`),
      warnings: validation.warnings.map((w) => `[${w.path}] ${w.message}`),
    };
  } catch (err) {
    return {
      found: true,
      path: configPath,
      valid: false,
      errors: [err instanceof Error ? err.message : String(err)],
      warnings: [],
    };
  }
}

export function probeIntegrity(projectRoot: string = process.cwd()): IntegrityDiagnostics {
  const canonicalDir = path.join(projectRoot, ".agents", "skills", "github-convention");
  if (!fs.existsSync(canonicalDir)) {
    return {
      installed: false,
      skillDir: canonicalDir,
      manifestFound: false,
      integrity: null,
    };
  }

  const manifest = loadManifest(canonicalDir);
  if (!manifest) {
    return {
      installed: true,
      skillDir: canonicalDir,
      manifestFound: false,
      integrity: null,
    };
  }

  const integrity = verifyManifestIntegrity(canonicalDir, manifest);
  return {
    installed: true,
    skillDir: canonicalDir,
    manifestFound: true,
    integrity,
  };
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
