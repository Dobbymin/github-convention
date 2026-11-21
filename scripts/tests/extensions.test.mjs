import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveSessionContext } from "../../hooks/session-context.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

const withTempDir = (fn) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ghc-ext-test-"));
  try {
    fn(tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
};

test("resolveSessionContext: returns null without config.yaml and message with config.yaml", () => {
  withTempDir((tmpDir) => {
    assert.equal(resolveSessionContext(tmpDir), null);

    const configDir = path.join(tmpDir, ".github-convention");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "config.yaml"), "version: 1\n", "utf8");

    const msg = resolveSessionContext(tmpDir);
    assert.ok(typeof msg === "string" && msg.includes("github-convention"));
  });
});

test("commands/gh-*.md: all slash commands have valid frontmatter and non-empty body", () => {
  const expected = ["gh-plan.md", "gh-pr.md", "gh-status.md", "gh-doctor.md"];
  for (const name of expected) {
    const filePath = path.join(REPO_ROOT, "commands", name);
    assert.equal(fs.existsSync(filePath), true, `Missing command: ${name}`);
    const content = fs.readFileSync(filePath, "utf8");
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]+)$/);
    assert.ok(match, `Missing YAML frontmatter in ${name}`);
    assert.match(match[1], /^description:\s*.+/m);
    assert.match(match[1], /^argument-hint:\s*.+/m);
    assert.ok(match[2].trim().length > 0);
  }
});

test("hooks/hooks.json: defines valid SessionStart hook", () => {
  const hooksPath = path.join(REPO_ROOT, "hooks", "hooks.json");
  const parsed = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
  assert.ok(Array.isArray(parsed.hooks?.SessionStart));
  assert.ok(parsed.hooks.SessionStart.length > 0);
});

test("install.sh and uninstall.sh: dry-run, copy install/uninstall, and unmanaged protection", (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX shell installer test skipped on Windows");
    return;
  }

  withTempDir((tmpDir) => {
    const installScript = path.join(REPO_ROOT, "install.sh");
    const uninstallScript = path.join(REPO_ROOT, "uninstall.sh");
    const targetDir = path.join(tmpDir, "target-skill");

    const dryOut = execFileSync(
      "sh",
      [installScript, "--dry-run", "--copy", "--target", targetDir],
      {
        encoding: "utf8",
      },
    );
    assert.match(dryOut, /\[dry-run\]/);
    assert.equal(fs.existsSync(targetDir), false);

    execFileSync("sh", [installScript, "--copy", "--target", targetDir], { encoding: "utf8" });
    assert.equal(fs.existsSync(path.join(targetDir, "SKILL.md")), true);
    assert.equal(fs.existsSync(path.join(targetDir, ".github-convention-script-managed")), true);

    execFileSync("sh", [uninstallScript, "--target", targetDir], { encoding: "utf8" });
    assert.equal(fs.existsSync(targetDir), false);

    // Unmanaged non-empty directory must not be overwritten or deleted
    const unmanagedDir = path.join(tmpDir, "unmanaged");
    fs.mkdirSync(unmanagedDir, { recursive: true });
    fs.writeFileSync(path.join(unmanagedDir, "custom.txt"), "keep", "utf8");

    assert.throws(() =>
      execFileSync("sh", [installScript, "--copy", "--target", unmanagedDir], { stdio: "pipe" }),
    );
    assert.throws(() =>
      execFileSync("sh", [uninstallScript, "--target", unmanagedDir], { stdio: "pipe" }),
    );
    assert.equal(fs.existsSync(path.join(unmanagedDir, "custom.txt")), true);
  });
});
