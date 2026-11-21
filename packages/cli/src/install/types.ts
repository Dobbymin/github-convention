import type { AgentId } from "@github-convention/agent-adapters";
import type { InstallType, SkillScope } from "@github-convention/core";

export type InstallScopeSelection = "project" | "global" | "both";

export interface InstallTargetRequest {
  agentId: AgentId;
  scope: InstallScopeSelection;
}

export interface InstallPlanOptions {
  targets: InstallTargetRequest[];
  projectRoot?: string;
  homeDir?: string;
  sourceSkillDir?: string;
  dryRun?: boolean;
  forceCopy?: boolean;
}

export interface InstallExecutionItem {
  agentId: AgentId;
  scope: SkillScope;
  targetPath: string;
  installType: InstallType;
  status: "created" | "updated" | "already_current" | "failed";
  filesCount: number;
  error?: string;
}

export interface InstallResult {
  canonicalSourcePath: string;
  items: InstallExecutionItem[];
  success: boolean;
}
