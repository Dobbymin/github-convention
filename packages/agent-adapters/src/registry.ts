import * as path from "node:path";
import { resolveProbeEnvironment } from "./prober.js";
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentDetectionResult,
  AgentId,
  DetectionConfidence,
  ProbeEnvironment,
} from "./types.js";

interface AdapterConfig {
  id: AgentId;
  name: string;
  executables: string[];
  homeConfigDirs: string[];
  projectConfigDirs: string[];
  projectSkillDir: string;
  globalSkillDir: string;
  projectAlternateSkillDirs?: string[];
  globalAlternateSkillDirs?: string[];
  capabilities: AgentCapabilities;
}

const DEFAULT_CAPABILITIES: AgentCapabilities = {
  supportsAgentSkills: true,
  supportsProjectSkills: true,
  supportsGlobalSkills: true,
  supportsSymlinkDiscovery: true,
  supportsNativeWorkerDelegation: "unknown",
  supportsNativeWorkspaceIsolation: "unknown",
  supportsSkillReload: "unknown",
};

const ADAPTER_CONFIGS: AdapterConfig[] = [
  {
    id: "codex",
    name: "OpenAI Codex",
    executables: ["codex"],
    homeConfigDirs: [".codex", ".agents"],
    projectConfigDirs: [".codex"],
    projectSkillDir: ".agents/skills",
    globalSkillDir: ".agents/skills",
    capabilities: { ...DEFAULT_CAPABILITIES },
  },
  {
    id: "claude-code",
    name: "Claude Code",
    executables: ["claude"],
    homeConfigDirs: [".claude", path.join(".config", "claude")],
    projectConfigDirs: [".claude"],
    projectSkillDir: ".claude/skills",
    globalSkillDir: ".claude/skills",
    capabilities: { ...DEFAULT_CAPABILITIES },
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    executables: ["gemini"],
    homeConfigDirs: [".gemini"],
    projectConfigDirs: [".gemini"],
    projectSkillDir: ".agents/skills",
    globalSkillDir: ".agents/skills",
    projectAlternateSkillDirs: [".gemini/skills"],
    globalAlternateSkillDirs: [".gemini/skills"],
    capabilities: { ...DEFAULT_CAPABILITIES },
  },
  {
    id: "antigravity",
    name: "Google Antigravity",
    executables: ["agy", "antigravity"],
    homeConfigDirs: [path.join(".gemini", "antigravity"), path.join(".gemini", "config")],
    projectConfigDirs: [".agents"],
    projectSkillDir: ".agents/skills",
    globalSkillDir: path.join(".gemini", "config", "skills"),
    capabilities: { ...DEFAULT_CAPABILITIES },
  },
  {
    id: "opencode",
    name: "OpenCode",
    executables: ["opencode"],
    homeConfigDirs: [".opencode", path.join(".config", "opencode")],
    projectConfigDirs: [".opencode"],
    projectSkillDir: ".agents/skills",
    globalSkillDir: ".agents/skills",
    projectAlternateSkillDirs: [".opencode/skills"],
    globalAlternateSkillDirs: [path.join(".config", "opencode", "skills")],
    capabilities: { ...DEFAULT_CAPABILITIES },
  },
  {
    id: "kilo",
    name: "Kilo Code / CLI",
    executables: ["kilo"],
    homeConfigDirs: [".kilo", path.join(".config", "kilo")],
    projectConfigDirs: [".kilo"],
    projectSkillDir: ".agents/skills",
    globalSkillDir: ".agents/skills",
    projectAlternateSkillDirs: [".kilo/skills"],
    globalAlternateSkillDirs: [".kilo/skills"],
    capabilities: { ...DEFAULT_CAPABILITIES },
  },
];

class BaseAgentAdapter implements AgentAdapter {
  readonly id: AgentId;
  readonly name: string;
  readonly paths: {
    projectSkillDir: string;
    globalSkillDir: string;
    projectAlternateSkillDirs?: string[];
    globalAlternateSkillDirs?: string[];
  };
  readonly capabilities: AgentCapabilities;
  private readonly config: AdapterConfig;

  constructor(config: AdapterConfig) {
    this.config = config;
    this.id = config.id;
    this.name = config.name;
    this.paths = {
      projectSkillDir: config.projectSkillDir,
      globalSkillDir: config.globalSkillDir,
      projectAlternateSkillDirs: config.projectAlternateSkillDirs,
      globalAlternateSkillDirs: config.globalAlternateSkillDirs,
    };
    this.capabilities = Object.freeze({ ...config.capabilities });
  }

  detect(env?: ProbeEnvironment): AgentDetectionResult {
    const probe = resolveProbeEnvironment(env);
    const reasons: string[] = [];
    let executablePath: string | undefined;
    let configPath: string | undefined;

    // 1. Probe executable
    for (const exe of this.config.executables) {
      const found = probe.commandExists(exe);
      if (found) {
        executablePath = found;
        reasons.push(`Executable '${exe}' found at ${found}`);
        break;
      }
    }

    // 2. Probe home config directories
    for (const relDir of this.config.homeConfigDirs) {
      const fullDir = path.join(probe.homeDir, relDir);
      if (probe.dirExists(fullDir) || probe.fileExists(fullDir)) {
        configPath = fullDir;
        reasons.push(`Home config directory found at ${fullDir}`);
        break;
      }
    }

    // 3. Probe project config directories
    let projectHintFound = false;
    for (const relDir of this.config.projectConfigDirs) {
      const fullDir = path.join(probe.projectDir, relDir);
      if (probe.dirExists(fullDir) || probe.fileExists(fullDir)) {
        projectHintFound = true;
        reasons.push(`Project-level configuration hint found at ${fullDir}`);
        break;
      }
    }

    // Determine confidence
    let confidence: DetectionConfidence = "not_found";
    if (executablePath) {
      confidence = "confirmed";
    } else if (configPath) {
      confidence = "probable";
    } else if (projectHintFound) {
      confidence = "unknown";
    }

    return {
      agentId: this.id,
      name: this.name,
      confidence,
      paths: {
        projectSkillDir: path.join(probe.projectDir, this.paths.projectSkillDir),
        globalSkillDir: path.join(probe.homeDir, this.paths.globalSkillDir),
        projectAlternateSkillDirs: this.paths.projectAlternateSkillDirs?.map((d) =>
          path.join(probe.projectDir, d),
        ),
        globalAlternateSkillDirs: this.paths.globalAlternateSkillDirs?.map((d) =>
          path.join(probe.homeDir, d),
        ),
      },
      capabilities: this.capabilities,
      executablePath,
      configPath,
      reasons,
    };
  }
}

const ADAPTERS: AgentAdapter[] = ADAPTER_CONFIGS.map((cfg) => new BaseAgentAdapter(cfg));

export const getAllAdapters = (): AgentAdapter[] => {
  return [...ADAPTERS];
};

export const getAdapter = (id: AgentId): AgentAdapter => {
  const found = ADAPTERS.find((a) => a.id === id);
  if (!found) {
    throw new Error(`Unsupported or unknown agent adapter ID: ${id}`);
  }
  return found;
};

export const detectAllAgents = (env?: ProbeEnvironment): AgentDetectionResult[] => {
  return ADAPTERS.map((adapter) => adapter.detect(env));
};
