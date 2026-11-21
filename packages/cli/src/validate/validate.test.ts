import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { saveManifest, type InstallManifest } from "@github-convention/core";
import { runCli } from "../runner.js";
import { runValidate } from "./validator.js";

describe("Validate Diagnostic System", () => {
  it("validates missing explicit config as failure", () => {
    const res = runValidate({ configPath: "/non/existent/path/config.yaml" });
    assert.equal(res.valid, false);
    assert.ok(res.errors.length > 0);
    assert.ok(res.checks.some((c) => c.status === "fail"));
  });

  it("passes when default config is absent", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-default-"));
    try {
      const res = runValidate({ projectRoot: tempDir });
      assert.equal(res.valid, true);
      assert.equal(res.checks.find((c) => c.id === "config.exists")?.status, "pass");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("validates schema and safety invariant violations", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-safety-"));
    try {
      const cfgPath = path.join(tempDir, ".github-convention.yaml");
      // Violation of immutable invariant: require_issue_approval: false
      fs.writeFileSync(
        cfgPath,
        "schema_version: 1\ngithub:\n  require_issue_approval: false\n",
        "utf-8",
      );

      const res = runValidate({ projectRoot: tempDir });
      assert.equal(res.valid, false);
      assert.ok(res.errors.some((e) => e.includes("Safety invariant violation")));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("warns on unknown configuration keys", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-unknown-"));
    try {
      const cfgPath = path.join(tempDir, ".github-convention.yaml");
      fs.writeFileSync(cfgPath, "schema_version: 1\nunknown_section:\n  foo: bar\n", "utf-8");

      const res = runValidate({ projectRoot: tempDir });
      assert.equal(res.valid, true);
      assert.ok(res.warnings.some((w) => w.includes("unknown_section")));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("validates SKILL.md and YAML frontmatter", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-skill-"));
    try {
      const skillDir = path.join(tempDir, ".agents", "skills", "github-convention");
      fs.mkdirSync(skillDir, { recursive: true });

      // 1. Missing SKILL.md
      let res = runValidate({ projectRoot: tempDir });
      assert.equal(res.valid, false);
      assert.ok(res.errors.some((e) => e.includes("Missing 'SKILL.md'")));

      // 2. SKILL.md without frontmatter
      const skillMd = path.join(skillDir, "SKILL.md");
      fs.writeFileSync(skillMd, "# No frontmatter here\n", "utf-8");
      res = runValidate({ projectRoot: tempDir });
      assert.equal(res.valid, false);
      assert.ok(res.errors.some((e) => e.includes("missing YAML frontmatter")));

      // 3. SKILL.md with valid frontmatter
      fs.writeFileSync(
        skillMd,
        "---\nname: github-convention\ndescription: Test description\n---\n# Content\n",
        "utf-8",
      );
      res = runValidate({ projectRoot: tempDir });
      assert.equal(res.valid, true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("validates manifest integrity accurately", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-manifest-"));
    try {
      const skillDir = path.join(tempDir, ".agents", "skills", "github-convention");
      fs.mkdirSync(skillDir, { recursive: true });
      const skillMd = path.join(skillDir, "SKILL.md");
      fs.writeFileSync(
        skillMd,
        "---\nname: github-convention\ndescription: Test description\n---\n",
        "utf-8",
      );

      const fakeManifest: InstallManifest = {
        schemaVersion: 1,
        skillName: "github-convention",
        skillVersion: "0.1.0",
        agentId: "claude-code",
        scope: "project",
        installedAt: new Date().toISOString(),
        installType: "copy",
        canonicalSourcePath: "/tmp/canonical",
        targetPath: skillDir,
        files: [
          {
            relativePath: "SKILL.md",
            sha256: "incorrect_sha_hash_12345",
            size: 10,
          },
        ],
      };
      saveManifest(skillDir, fakeManifest);

      const res = runValidate({ projectRoot: tempDir });
      assert.equal(res.valid, false);
      assert.ok(res.errors.some((e) => e.includes("integrity violation")));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("guarantees zero filesystem mutations during validate", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-read-only-"));
    try {
      const beforeList = fs.readdirSync(tempDir);
      const res = runValidate({ projectRoot: tempDir });
      const afterList = fs.readdirSync(tempDir);

      assert.deepEqual(afterList, beforeList);
      assert.equal(res.valid, true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("executes validate via CLI runner with JSON format", async () => {
    const res = await runCli(["validate", "--output", "json"], {
      stdout: () => {},
      stderr: () => {},
    });
    assert.equal(res.exitCode, 0);
    assert.equal(res.envelope.command, "validate");
    assert.equal(res.envelope.status, "completed");
    const data = res.envelope.data as Record<string, unknown>;
    assert.equal(data.valid, true);
  });
});
