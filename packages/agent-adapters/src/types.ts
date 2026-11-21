export type AgentId =
  "codex" | "claude-code" | "gemini-cli" | "antigravity" | "opencode" | "kilo" | "copilot";

export type DetectionConfidence = "confirmed" | "probable" | "unknown" | "not_found";

export type TriStateCapability = true | false | "unknown";

export interface AgentCapabilities {
  supportsAgentSkills: TriStateCapability;
  supportsProjectSkills: TriStateCapability;
  supportsGlobalSkills: TriStateCapability;
  supportsSymlinkDiscovery: TriStateCapability;
  supportsNativeWorkerDelegation: TriStateCapability;
  supportsNativeWorkspaceIsolation: TriStateCapability;
  supportsSkillReload: TriStateCapability;
}

export interface AgentPaths {
  projectSkillDir: string;
  globalSkillDir: string;
  projectAlternateSkillDirs?: string[];
  globalAlternateSkillDirs?: string[];
}

export interface AgentDetectionResult {
  agentId: AgentId;
  name: string;
  confidence: DetectionConfidence;
  paths: AgentPaths;
  capabilities: AgentCapabilities;
  executablePath?: string;
  configPath?: string;
  reasons: string[];
}

export interface ProbeEnvironment {
  homeDir?: string;
  projectDir?: string;
  pathDirs?: string[];
  fileExists?: (filePath: string) => boolean;
  dirExists?: (dirPath: string) => boolean;
  commandExists?: (cmd: string) => string | null;
}

export interface AgentAdapter {
  readonly id: AgentId;
  readonly name: string;
  readonly paths: AgentPaths;
  readonly capabilities: AgentCapabilities;
  detect(env?: ProbeEnvironment): AgentDetectionResult;
}
