import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  detectAllAgents,
  getAdapter,
  getAllAdapters,
  isCapabilitySupported,
  isTargetModifiable,
  type ProbeEnvironment,
} from "./index.js";

test("adapters registry: provides all 6 documented agent adapters", () => {
  const adapters = getAllAdapters();
  assert.equal(adapters.length, 6);

  const ids = adapters.map((a) => a.id).sort();
  assert.deepEqual(ids, ["antigravity", "claude-code", "codex", "gemini-cli", "kilo", "opencode"]);

  for (const id of ids) {
    const adapter = getAdapter(id);
    assert.equal(adapter.id, id);
    assert.ok(adapter.name);
    assert.ok(adapter.paths.projectSkillDir);
    assert.ok(adapter.paths.globalSkillDir);
  }
});

test("confidence levels: distinguishes confirmed, probable, unknown, and not_found", () => {
  const claudeAdapter = getAdapter("claude-code");

  // 1. confirmed: executable found in PATH
  const envConfirmed: ProbeEnvironment = {
    homeDir: "/mock/home",
    projectDir: "/mock/project",
    commandExists: (cmd) => (cmd === "claude" ? "/usr/local/bin/claude" : null),
    dirExists: () => false,
    fileExists: () => false,
  };
  const res1 = claudeAdapter.detect(envConfirmed);
  assert.equal(res1.confidence, "confirmed");
  assert.equal(res1.executablePath, "/usr/local/bin/claude");

  // 2. probable: config dir exists, but executable not found
  const envProbable: ProbeEnvironment = {
    homeDir: "/mock/home",
    projectDir: "/mock/project",
    commandExists: () => null,
    dirExists: (p) => p.includes(".claude"),
    fileExists: () => false,
  };
  const res2 = claudeAdapter.detect(envProbable);
  assert.equal(res2.confidence, "probable");
  assert.ok(res2.configPath);

  // 3. unknown: project-level hint exists only
  const envUnknown: ProbeEnvironment = {
    homeDir: "/mock/home",
    projectDir: "/mock/project",
    commandExists: () => null,
    dirExists: (p) => p === "/mock/project/.claude",
    fileExists: () => false,
  };
  const res3 = claudeAdapter.detect(envUnknown);
  assert.equal(res3.confidence, "unknown");

  // 4. not_found: nothing found
  const envNotFound: ProbeEnvironment = {
    homeDir: "/mock/home",
    projectDir: "/mock/project",
    commandExists: () => null,
    dirExists: () => false,
    fileExists: () => false,
  };
  const res4 = claudeAdapter.detect(envNotFound);
  assert.equal(res4.confidence, "not_found");
});

test("target modifiability: only confirmed or user-selected probable targets can be modified", () => {
  assert.equal(isTargetModifiable("confirmed", false), true);
  assert.equal(isTargetModifiable("confirmed", true), true);

  assert.equal(isTargetModifiable("probable", false), false);
  assert.equal(isTargetModifiable("probable", true), true);

  assert.equal(isTargetModifiable("unknown", false), false);
  assert.equal(isTargetModifiable("unknown", true), false);

  assert.equal(isTargetModifiable("not_found", false), false);
  assert.equal(isTargetModifiable("not_found", true), false);
});

test("3-state capabilities: true/false/unknown distinguished and unknown treated as unsupported", () => {
  assert.equal(isCapabilitySupported(true), true);
  assert.equal(isCapabilitySupported(false), false);
  assert.equal(isCapabilitySupported("unknown"), false);

  const antigravity = getAdapter("antigravity");
  assert.equal(antigravity.capabilities.supportsAgentSkills, true);
  assert.equal(antigravity.capabilities.supportsNativeWorkerDelegation, "unknown");

  // Evaluation treats 'unknown' as false for decisions
  assert.equal(
    isCapabilitySupported(antigravity.capabilities.supportsNativeWorkerDelegation),
    false,
  );
});

test("detectAllAgents: produces doctor-ready capability report for all adapters", () => {
  const env: ProbeEnvironment = {
    homeDir: "/mock/home",
    projectDir: "/mock/project",
    commandExists: (cmd) => (cmd === "agy" ? "/usr/local/bin/agy" : null),
    dirExists: (p) => p.includes(".codex"),
    fileExists: () => false,
  };

  const reports = detectAllAgents(env);
  assert.equal(reports.length, 6);

  const agyReport = reports.find((r) => r.agentId === "antigravity");
  assert.ok(agyReport);
  assert.equal(agyReport.confidence, "confirmed");

  const codexReport = reports.find((r) => r.agentId === "codex");
  assert.ok(codexReport);
  assert.equal(codexReport.confidence, "probable");
});
