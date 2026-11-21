import type { WorkspaceIsolationDecision, WorkspaceSelectionOptions } from "./types.js";

export const selectWorkspaceIsolationStrategy = (
  options: WorkspaceSelectionOptions,
): WorkspaceIsolationDecision => {
  const nativeCap = options.capabilities.supportsNativeWorkspaceIsolation;
  const nativeSupported =
    nativeCap === true &&
    options.verifiedDistinctWorkspace === true &&
    options.orchestratorRetainsGitControl === true;

  if (nativeSupported) {
    return {
      agentId: options.agentId,
      strategy: "native_isolated",
      nativeSupported: true,
      reason:
        "Agent supports verified native workspace isolation and Orchestrator retains Git control.",
    };
  }

  const reason =
    nativeCap !== true
      ? `Native workspace isolation is '${String(nativeCap)}' (treated as unsupported); using Orchestrator-owned Git Worktree.`
      : "Native workspace distinctness or Orchestrator Git control not verified; using Orchestrator-owned Git Worktree.";

  return {
    agentId: options.agentId,
    strategy: "git_worktree",
    nativeSupported: false,
    reason,
  };
};
