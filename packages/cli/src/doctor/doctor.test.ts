import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { runCli } from "../runner.js";
import { runDoctor } from "./doctor.js";
import { probeAgents, probeConfig, probePermissions, probeSystem, probeTooling } from "./probes.js";

describe("Doctor Diagnostic System", () => {
  it("probes system runtime accurately", () => {
    const sys = probeSystem();
    assert.equal(sys.platform, process.platform);
    assert.equal(sys.arch, process.arch);
    assert.equal(sys.nodeVersion, process.version);
    assert.equal(sys.nodeSupported, true);
  });

  it("probes tooling with mock exec", () => {
    const mockExec = (cmd: string, args: string[]) => {
      if (cmd === "git") {
        return { status: 0, stdout: "git version 2.45.0\n", stderr: "" };
      }
      if (cmd === "gh" && args[0] === "--version") {
        return { status: 0, stdout: "gh version 2.50.0 (2026-05-01)\n", stderr: "" };
      }
      if (cmd === "gh" && args[0] === "auth" && args[1] === "status") {
        return {
          status: 0,
          stdout: "Logged in to github.com account octocat (keyring)\n",
          stderr: "",
        };
      }
      return { status: 1, stdout: "", stderr: "command not found" };
    };

    const tooling = probeTooling(mockExec);
    assert.equal(tooling.git.installed, true);
    assert.equal(tooling.git.version, "git version 2.45.0");
    assert.equal(tooling.gh.installed, true);
    assert.equal(tooling.gh.authenticated, true);
    assert.equal(tooling.gh.user, "octocat");
  });

  it("handles missing tooling gracefully", () => {
    const failingExec = () => ({ status: 127, stdout: "", stderr: "command not found" });
    const tooling = probeTooling(failingExec);
    assert.equal(tooling.git.installed, false);
    assert.equal(tooling.gh.installed, false);
    assert.equal(tooling.gh.authenticated, false);
  });

  it("probes all registered agents", () => {
    const agents = probeAgents();
    assert.ok(agents.length >= 6);
    const ids = agents.map((a) => a.id);
    assert.ok(ids.includes("claude-code"));
    assert.ok(ids.includes("antigravity"));
    assert.ok(ids.includes("codex"));

    for (const agent of agents) {
      assert.ok(agent.name);
      assert.ok(agent.capabilities);
    }
  });

  it("probes config correctly", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "doc-cfg-"));
    try {
      // 1. Missing config
      const resMissing = probeConfig(tempDir);
      assert.equal(resMissing.found, false);
      assert.equal(resMissing.valid, true);

      // 2. Valid config
      const cfgPath = path.join(tempDir, ".github-convention.yaml");
      fs.writeFileSync(cfgPath, "schema_version: 1\ngithub:\n  default_branch: main\n", "utf-8");
      const resValid = probeConfig(tempDir);
      assert.equal(resValid.found, true);
      assert.equal(resValid.valid, true);
      assert.equal(resValid.errors.length, 0);

      // 3. Invalid config
      fs.writeFileSync(cfgPath, "schema_version: -1\n", "utf-8");
      const resInvalid = probeConfig(tempDir);
      assert.equal(resInvalid.found, true);
      assert.equal(resInvalid.valid, false);
      assert.ok(resInvalid.errors.length > 0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("probes permissions without mutation", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "doc-perm-"));
    try {
      const perms = probePermissions(tempDir);
      assert.equal(perms.projectReadable, true);
      assert.equal(perms.projectWritable, true);

      const files = fs.readdirSync(tempDir);
      assert.equal(files.length, 0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("guarantees zero filesystem mutation during doctor run", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "doc-read-only-"));
    try {
      const beforeList = fs.readdirSync(tempDir);
      const report = runDoctor({
        projectRoot: tempDir,
        execFn: () => ({ status: 0, stdout: "mock", stderr: "" }),
      });
      const afterList = fs.readdirSync(tempDir);

      assert.deepEqual(afterList, beforeList);
      assert.equal(report.healthy, true);
      assert.ok(report.checks.length > 0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("executes doctor via CLI runner with JSON format", async () => {
    const res = await runCli(["doctor", "--output", "json"], {
      stdout: () => {},
      stderr: () => {},
    });
    assert.equal(res.exitCode, 0);
    assert.equal(res.envelope.command, "doctor");
    assert.equal(res.envelope.status, "completed");
    const data = res.envelope.data as Record<string, unknown>;
    assert.ok(data.healthy !== undefined);
  });
});
