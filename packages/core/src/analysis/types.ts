import type { CacheSourceDiff } from "../cache/types.js";

export type SourceCategory =
  | "instruction"
  | "package_manifest"
  | "issue_template"
  | "pr_template"
  | "workflow"
  | "labels"
  | "project_config"
  | "project_convention";

export type PackageManagerName = "npm" | "pnpm" | "yarn" | "bun";
export type CommitStyleName = "conventional" | "gitmoji" | "freeform";
export type MergeStrategyName = "squash" | "rebase" | "merge";

export interface PackageScriptsSummary {
  format?: string;
  lint?: string;
  typecheck?: string;
  test?: string;
  build?: string;
  secretScan?: string;
}

export interface SourceConventionSignals {
  category: SourceCategory;
  packageManager?: PackageManagerName;
  defaultBranch?: string;
  commitStyle?: CommitStyleName;
  mergeStrategy?: MergeStrategyName;
  scripts?: PackageScriptsSummary;
  workflowChecks?: string[];
  labels?: string[];
}

export interface GitSamplingResult {
  isGitRepo: boolean;
  currentBranch: string | null;
  recentCommitSubjects: string[];
  inferredCommitStyle: CommitStyleName | null;
}

export interface ConventionConflictSource {
  relativePath: string;
  sha256: string;
  value: string;
}

export interface ConflictResolutionRecord {
  conflictId: string;
  topic: string;
  selectedValue: string;
  selectedSource: string;
  sourceHashes: Record<string, string>;
  resolvedAt: string;
  note?: string;
}

export interface ConflictResolutionStore {
  schemaVersion: 1;
  updatedAt: string;
  resolutions: Record<string, ConflictResolutionRecord>;
}

export interface ConventionConflict {
  id: string;
  topic: string;
  description: string;
  sources: ConventionConflictSource[];
  status: "unresolved" | "resolved";
  resolution?: ConflictResolutionRecord;
}

export interface RepositoryAnalysis {
  projectRoot: string;
  analyzedAt: string;
  discoveredFiles: string[];
  scripts: PackageScriptsSummary;
  packageManagers: string[];
  templates: {
    issueTemplates: string[];
    prTemplates: string[];
    labelsFile: string | null;
  };
  workflows: string[];
  projectConfigPath: string | null;
  projectConventions: string[];
  git: GitSamplingResult;
  conflicts: ConventionConflict[];
  cacheDiff: {
    added: string[];
    changed: string[];
    unchanged: string[];
    deleted: string[];
  };
}

export interface AnalyzeRepositoryOptions {
  projectRoot?: string;
  dryRun?: boolean;
  onAnalyzeFile?: (relativePath: string) => void;
}

export interface RepositoryAnalysisResult {
  analysis: RepositoryAnalysis;
  diff: CacheSourceDiff;
  cacheWritten: boolean;
  cachePath: string;
}
