export type InstallType = "canonical" | "symlink" | "copy";
export type SkillScope = "project" | "global";

export interface FileHashRecord {
  relativePath: string;
  sha256: string;
  size: number;
}

export interface InstallManifest {
  schemaVersion: number;
  skillName: string;
  skillVersion: string;
  installedAt: string;
  agentId: string;
  scope: SkillScope;
  targetPath: string;
  installType: InstallType;
  canonicalSourcePath?: string;
  files: FileHashRecord[];
}

export interface IntegrityCheckResult {
  valid: boolean;
  modifiedFiles: string[];
  missingFiles: string[];
  unexpectedFiles: string[];
}
