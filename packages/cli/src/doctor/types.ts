import type {
  AgentCapabilities,
  AgentId,
  DetectionConfidence,
} from "@dobbymin/github-convention-agent-adapters";
import type { IntegrityCheckResult } from "@dobbymin/github-convention-core";

export type DiagnosticLevel = "ok" | "warn" | "error";

export interface DiagnosticItem {
  id: string;
  name: string;
  status: DiagnosticLevel;
  message: string;
}

export interface SystemDiagnostics {
  platform: string;
  arch: string;
  nodeVersion: string;
  nodeSupported: boolean;
  minNodeVersion: string;
}

export interface ToolingDiagnostics {
  git: {
    installed: boolean;
    version: string | null;
  };
  gh: {
    installed: boolean;
    version: string | null;
    authenticated: boolean;
    user: string | null;
  };
}

export interface AgentDiagnosticSummary {
  id: AgentId;
  name: string;
  confidence: DetectionConfidence;
  targetPath: string;
  pathExists: boolean;
  modifiable: boolean;
  capabilities: AgentCapabilities;
}

export interface ConfigDiagnostics {
  found: boolean;
  path: string | null;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface IntegrityTargetResult {
  agentId: string;
  scope: string;
  skillDir: string;
  manifestFound: boolean;
  integrity: IntegrityCheckResult | null;
}

export interface IntegrityDiagnostics {
  installed: boolean;
  skillDir: string | null;
  manifestFound: boolean;
  integrity: IntegrityCheckResult | null;
  targets?: IntegrityTargetResult[];
}

export interface PermissionsDiagnostics {
  projectReadable: boolean;
  projectWritable: boolean;
}

export interface DoctorReport {
  healthy: boolean;
  system: SystemDiagnostics;
  tooling: ToolingDiagnostics;
  agents: AgentDiagnosticSummary[];
  config: ConfigDiagnostics;
  integrity: IntegrityDiagnostics;
  permissions: PermissionsDiagnostics;
  checks: DiagnosticItem[];
}

export interface DoctorOptions {
  projectRoot?: string;
  globalRoot?: string;
  configPath?: string;
  execFn?: (
    command: string,
    args: string[],
  ) => { status: number | null; stdout: string; stderr: string };
}
