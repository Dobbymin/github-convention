import assert from "node:assert/strict";
import test from "node:test";
import type { AgentCapabilities } from "../types.js";
import { selectWorkspaceIsolationStrategy } from "./index.js";

const makeCapabilities = (
  nativeIsolation: AgentCapabilities["supportsNativeWorkspaceIsolation"],
): AgentCapabilities => ({
  supportsAgentSkills: true,
  supportsProjectSkills: true,
  supportsGlobalSkills: true,
  supportsSymlinkDiscovery: true,
  supportsNativeWorkerDelegation: true,
  supportsNativeWorkspaceIsolation: nativeIsolation,
  supportsSkillReload: true,
});

test("selectWorkspaceIsolationStrategy: treats unknown and false as unsupported and falls back to git_worktree", () => {
  const unknownRes = selectWorkspaceIsolationStrategy({
    agentId: "claude-code",
    capabilities: makeCapabilities("unknown"),
    verifiedDistinctWorkspace: true,
    orchestratorRetainsGitControl: true,
  });
  assert.equal(unknownRes.strategy, "git_worktree");
  assert.equal(unknownRes.nativeSupported, false);

  const falseRes = selectWorkspaceIsolationStrategy({
    agentId: "codex",
    capabilities: makeCapabilities(false),
    verifiedDistinctWorkspace: true,
    orchestratorRetainsGitControl: true,
  });
  assert.equal(falseRes.strategy, "git_worktree");
  assert.equal(falseRes.nativeSupported, false);
});

test("selectWorkspaceIsolationStrategy: uses native_isolated only when distinctness and Git control are verified", () => {
  const unverified = selectWorkspaceIsolationStrategy({
    agentId: "antigravity",
    capabilities: makeCapabilities(true),
    verifiedDistinctWorkspace: true,
    orchestratorRetainsGitControl: false,
  });
  assert.equal(unverified.strategy, "git_worktree");

  const verified = selectWorkspaceIsolationStrategy({
    agentId: "antigravity",
    capabilities: makeCapabilities(true),
    verifiedDistinctWorkspace: true,
    orchestratorRetainsGitControl: true,
  });
  assert.equal(verified.strategy, "native_isolated");
  assert.equal(verified.nativeSupported, true);
});
