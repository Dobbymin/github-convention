import * as os from "node:os";
import {
  probeAgents,
  probeConfig,
  probeIntegrity,
  probePermissions,
  probeSystem,
  probeTooling,
} from "./probes.js";
import type { DiagnosticItem, DoctorOptions, DoctorReport } from "./types.js";

export function runDoctor(options: DoctorOptions = {}): DoctorReport {
  const projectRoot = options.projectRoot || process.cwd();
  const globalRoot = options.globalRoot || os.homedir();

  const system = probeSystem();
  const tooling = probeTooling(options.execFn);
  const agents = probeAgents(projectRoot, globalRoot);
  const config = probeConfig(projectRoot, options.configPath);
  const integrity = probeIntegrity(projectRoot);
  const permissions = probePermissions(projectRoot);

  const checks: DiagnosticItem[] = [];

  // Check 1: Node.js runtime
  if (system.nodeSupported) {
    checks.push({
      id: "runtime.node",
      name: "Node.js runtime version",
      status: "ok",
      message: `Node ${system.nodeVersion} is supported (${system.minNodeVersion}).`,
    });
  } else {
    checks.push({
      id: "runtime.node",
      name: "Node.js runtime version",
      status: "error",
      message: `Node ${system.nodeVersion} is not supported. Minimum required: ${system.minNodeVersion}.`,
    });
  }

  // Check 2: Git installed
  if (tooling.git.installed) {
    checks.push({
      id: "tooling.git",
      name: "Git version",
      status: "ok",
      message: `${tooling.git.version} detected.`,
    });
  } else {
    checks.push({
      id: "tooling.git",
      name: "Git version",
      status: "error",
      message: "Git is not installed or not found on PATH.",
    });
  }

  // Check 3: GitHub CLI installed & auth
  if (!tooling.gh.installed) {
    checks.push({
      id: "tooling.gh",
      name: "GitHub CLI (gh)",
      status: "warn",
      message: "GitHub CLI (gh) is not installed. Required for GitHub Issue/PR automation.",
    });
  } else if (!tooling.gh.authenticated) {
    checks.push({
      id: "tooling.gh",
      name: "GitHub CLI authentication",
      status: "warn",
      message:
        "gh is installed but not authenticated. Run 'gh auth login' to enable full features.",
    });
  } else {
    checks.push({
      id: "tooling.gh",
      name: "GitHub CLI authentication",
      status: "ok",
      message: `Authenticated as ${tooling.gh.user ?? "GitHub user"}.`,
    });
  }

  // Check 4: Agent paths & adapters
  const confirmedAgents = agents.filter(
    (a) => a.confidence === "confirmed" || a.confidence === "probable",
  );
  if (confirmedAgents.length > 0) {
    checks.push({
      id: "agents.detected",
      name: "Detected AI agents",
      status: "ok",
      message: `Detected ${confirmedAgents.length} agent environment(s): ${confirmedAgents.map((a) => a.name).join(", ")}.`,
    });
  } else {
    checks.push({
      id: "agents.detected",
      name: "Detected AI agents",
      status: "warn",
      message: "No specific AI agent environments detected in this project or global home.",
    });
  }

  // Check 5: Project permissions
  if (permissions.projectReadable && permissions.projectWritable) {
    checks.push({
      id: "permissions.project",
      name: "Project directory permissions",
      status: "ok",
      message: "Project directory is readable and writable.",
    });
  } else {
    checks.push({
      id: "permissions.project",
      name: "Project directory permissions",
      status: "error",
      message: `Insufficient project directory permissions: read=${permissions.projectReadable}, write=${permissions.projectWritable}.`,
    });
  }

  // Check 6: Configuration
  if (!config.found) {
    checks.push({
      id: "config.status",
      name: "Configuration status",
      status: "ok",
      message: "No project config file found. Using default convention settings.",
    });
  } else if (!config.valid) {
    checks.push({
      id: "config.status",
      name: "Configuration validation",
      status: "error",
      message: `Configuration has validation errors: ${config.errors.join("; ")}`,
    });
  } else if (config.warnings.length > 0) {
    checks.push({
      id: "config.status",
      name: "Configuration validation",
      status: "warn",
      message: `Configuration valid with warnings: ${config.warnings.join("; ")}`,
    });
  } else {
    checks.push({
      id: "config.status",
      name: "Configuration validation",
      status: "ok",
      message: `Configuration at ${config.path} is valid.`,
    });
  }

  // Check 7: Skill integrity
  if (!integrity.installed) {
    checks.push({
      id: "integrity.skill",
      name: "Skill installation integrity",
      status: "ok",
      message: "Skill is not yet installed in this project (.agents/skills/github-convention).",
    });
  } else if (!integrity.manifestFound) {
    checks.push({
      id: "integrity.skill",
      name: "Skill manifest integrity",
      status: "warn",
      message: "Skill directory exists but .manifest.json is missing.",
    });
  } else if (integrity.integrity?.valid) {
    checks.push({
      id: "integrity.skill",
      name: "Skill installation integrity",
      status: "ok",
      message: "All skill files match SHA-256 manifest hashes.",
    });
  } else {
    const details = [
      ...(integrity.integrity?.modifiedFiles.map((f) => `modified: ${f}`) ?? []),
      ...(integrity.integrity?.missingFiles.map((f) => `missing: ${f}`) ?? []),
      ...(integrity.integrity?.unexpectedFiles.map((f) => `unexpected: ${f}`) ?? []),
    ].join(", ");
    checks.push({
      id: "integrity.skill",
      name: "Skill installation integrity",
      status: "error",
      message: `Integrity check failed: ${details}`,
    });
  }

  const hasErrors = checks.some((c) => c.status === "error");

  return {
    healthy: !hasErrors,
    system,
    tooling,
    agents,
    config,
    integrity,
    permissions,
    checks,
  };
}
