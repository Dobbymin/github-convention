import type { InstallManifest } from "@github-convention/core";

export type FileDiffAction =
  "add" | "update" | "delete" | "preserve_modified" | "conflict" | "unchanged";

export interface FileDiffItem {
  relativePath: string;
  action: FileDiffAction;
  baseHash?: string;
  localHash?: string;
  remoteHash?: string;
  reason?: string;
}

export interface UpdatePlan {
  targetDir: string;
  isSymlink: boolean;
  currentManifest: InstallManifest | null;
  files: FileDiffItem[];
  conflicts: FileDiffItem[];
  summary: {
    add: number;
    update: number;
    delete: number;
    preserve: number;
    conflict: number;
    unchanged: number;
  };
}

export interface UpdateOptions {
  targetDir?: string;
  sourceSkillDir?: string;
  projectRoot?: string;
  globalRoot?: string;
  dryRun?: boolean;
}

export interface UpdateResult {
  targetDir: string;
  success: boolean;
  dryRun: boolean;
  plan: UpdatePlan;
  backupPath?: string;
  rolledBack?: boolean;
  error?: string;
}
