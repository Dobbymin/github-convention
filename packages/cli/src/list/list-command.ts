import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  detectAllAgents,
  getAllAdapters,
  type AgentId,
  type DetectionConfidence,
} from "@dobbymin/github-convention-agent-adapters";
import { loadManifest, type InstallType } from "@dobbymin/github-convention-core";

const SKILL_NAME = "github-convention";

export interface InstalledScopeStatus {
  installed: boolean;
  path: string;
  installType: InstallType | null;
  skillVersion: string | null;
  symlink: boolean;
}

export interface AgentListEntry {
  agentId: AgentId;
  name: string;
  confidence: DetectionConfidence;
  project: InstalledScopeStatus;
  global: InstalledScopeStatus;
}

export interface ListCommandOptions {
  projectRoot?: string;
  homeDir?: string;
  agents?: readonly string[];
}

export interface ListCommandResult {
  project: string;
  agents: AgentListEntry[];
  installedCount: number;
}

const inspectSkillTarget = (targetPath: string): InstalledScopeStatus => {
  let symlink = false;
  let exists = false;

  try {
    const stat = fs.lstatSync(targetPath);
    symlink = stat.isSymbolicLink();
    exists = symlink || stat.isDirectory() || stat.isFile();
  } catch {
    exists = false;
  }

  const manifest = exists ? loadManifest(targetPath) : null;
  const installType: InstallType | null =
    manifest?.installType ?? (symlink ? "symlink" : exists ? "copy" : null);

  return {
    installed: exists,
    path: targetPath,
    installType,
    skillVersion: manifest?.skillVersion ?? null,
    symlink,
  };
};

export const validateAgentIds = (agentIds: readonly string[]): AgentId[] => {
  const validIds = new Set<string>(getAllAdapters().map((adapter) => adapter.id));
  const invalid = agentIds.filter((id) => !validIds.has(id));
  if (invalid.length > 0) {
    throw new Error(
      `Unknown agent adapter ID(s): ${invalid.join(", ")}. Supported: ${Array.from(validIds).join(", ")}.`,
    );
  }
  return agentIds as AgentId[];
};

export const runList = (options: ListCommandOptions = {}): ListCommandResult => {
  const projectRoot = options.projectRoot ?? process.cwd();
  const homeDir = options.homeDir ?? os.homedir();
  const filterSet =
    options.agents && options.agents.length > 0
      ? new Set<AgentId>(validateAgentIds(options.agents))
      : null;

  const detections = detectAllAgents({ projectDir: projectRoot, homeDir }).filter((det) =>
    filterSet ? filterSet.has(det.agentId) : true,
  );

  const agents: AgentListEntry[] = detections.map((det) => {
    const projectTarget = path.join(det.paths.projectSkillDir, SKILL_NAME);
    const globalTarget = path.join(det.paths.globalSkillDir, SKILL_NAME);

    return {
      agentId: det.agentId,
      name: det.name,
      confidence: det.confidence,
      project: inspectSkillTarget(projectTarget),
      global: inspectSkillTarget(globalTarget),
    };
  });

  const installedCount = agents.filter(
    (entry) => entry.project.installed || entry.global.installed,
  ).length;

  return {
    project: projectRoot,
    agents,
    installedCount,
  };
};
