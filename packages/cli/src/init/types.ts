import type { RepositoryAnalysis } from "@github-convention/core";
import type { IgnorePlan } from "../ignore/index.js";

export interface InitOptions {
  projectRoot?: string;
  dryRun?: boolean;
  adapterFallbackPaths?: string[];
}

export interface PlannedFileAction {
  relativePath: string;
  action: "create" | "update" | "skip";
  reason: string;
}

export interface InitPlan {
  projectRoot: string;
  analysis: RepositoryAnalysis;
  configAction: PlannedFileAction;
  conventionsAction: PlannedFileAction;
  ignorePlan: IgnorePlan;
  actions: PlannedFileAction[];
  proposedConfigYaml?: string;
  proposedConventionsReadme?: string;
}

export interface InitResult {
  projectRoot: string;
  dryRun: boolean;
  initialized: boolean;
  cacheWritten: boolean;
  plan: InitPlan;
  writtenFiles: string[];
  warnings: string[];
}
