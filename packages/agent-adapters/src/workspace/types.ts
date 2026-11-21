import type { AgentCapabilities, AgentId } from "../types.js";

export type WorkspaceIsolationStrategy = "native_isolated" | "git_worktree";

export type WorkspaceIsolationDecision = Readonly<{
  agentId: AgentId;
  strategy: WorkspaceIsolationStrategy;
  nativeSupported: boolean;
  reason: string;
}>;

export type WorkspaceSelectionOptions = Readonly<{
  agentId: AgentId;
  capabilities: AgentCapabilities;
  verifiedDistinctWorkspace?: boolean;
  orchestratorRetainsGitControl?: boolean;
}>;
