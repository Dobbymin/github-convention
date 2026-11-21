import type { InstallManifest } from "@dobbymin/github-convention-core";
import type { InstallScope } from "../options.js";

export type UninstallAction = "remove" | "preserve_modified" | "missing" | "preserve_unowned";

export interface UninstallItem {
  relativePath: string;
  action: UninstallAction;
  reason: string;
}

export interface UninstallPlan {
  targetDir: string;
  kind: "symlink" | "managed_copy" | "not_installed" | "unmanaged";
  manifest: InstallManifest | null;
  items: UninstallItem[];
  summary: {
    remove: number;
    preserve: number;
    missing: number;
    unowned: number;
  };
}

export interface UninstallOptions {
  targetDir?: string;
  projectRoot?: string;
  homeDir?: string;
  agents?: readonly string[];
  scope?: InstallScope;
  dryRun?: boolean;
}

export interface UninstallResult {
  targetDir: string;
  success: boolean;
  dryRun: boolean;
  plan: UninstallPlan;
  manifestRemoved: boolean;
  directoryRemoved: boolean;
  retainedPath?: string;
  error?: string;
}

export interface MultiUninstallResult {
  success: boolean;
  dryRun: boolean;
  targets: UninstallResult[];
  items: UninstallItem[];
  summary: UninstallPlan["summary"];
  warnings: string[];
  error?: string;
}
