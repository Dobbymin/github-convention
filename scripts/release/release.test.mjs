import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  REPO_ROOT,
  VERIFIED_TARGETS,
  checkBidirectionalCompatibility,
  findForbiddenPackFiles,
  runWorkspacePackDryRun,
  sha256Hex,
  stageArtifacts,
  validatePackageMetadata,
} from "./build-artifacts.mjs";

test("package metadata: all workspace packages define required release fields", () => {
  const packages = validatePackageMetadata(REPO_ROOT);
  assert.deepEqual(Object.keys(packages).sort(), [
    "@dobbymin/github-convention-agent-adapters",
    "@dobbymin/github-convention-cli",
    "@dobbymin/github-convention-core",
    "@dobbymin/github-convention-github-adapter",
    "@dobbymin/github-convention-skill",
  ]);
  assert.equal(
    packages["@dobbymin/github-convention-cli"].manifest.githubConvention.supportedSkill,
    "^0.1.0",
  );
  assert.equal(
    packages["@dobbymin/github-convention-skill"].manifest.githubConvention.compatibleCli,
    "^0.1.0",
  );
});

test("compatibility: validates independent CLI and Skill SemVer in both directions", () => {
  const ok = checkBidirectionalCompatibility(
    { version: "0.1.2", githubConvention: { supportedSkill: "^0.1.0" } },
    { version: "0.1.5", githubConvention: { compatibleCli: "^0.1.0" } },
  );
  assert.equal(ok.compatible, true);

  assert.throws(
    () =>
      checkBidirectionalCompatibility(
        { version: "0.2.0", githubConvention: { supportedSkill: "^0.1.0" } },
        { version: "0.1.0", githubConvention: { compatibleCli: "^0.1.0" } },
      ),
    /incompatible with Skill/i,
  );

  assert.throws(
    () =>
      checkBidirectionalCompatibility(
        { version: "0.1.0", githubConvention: { supportedSkill: "^0.1.0" } },
        { version: "0.2.0", githubConvention: { compatibleCli: "^0.1.0" } },
      ),
    /incompatible with CLI/i,
  );
});

test("forbidden pack files: rejects .harness, _workspace, .env, and secret files", () => {
  const violations = findForbiddenPackFiles([
    "dist/index.js",
    ".harness/state/active/run.json",
    "_workspace/scratch.txt",
    ".env.local",
    "config/secrets.json",
    "package.json",
  ]);
  assert.deepEqual(violations, [
    ".harness/state/active/run.json",
    "_workspace/scratch.txt",
    ".env.local",
    "config/secrets.json",
  ]);
});

test("workspace pack dry-run: includes only whitelisted files and zero unexpected files", () => {
  const cliPack = runWorkspacePackDryRun("@dobbymin/github-convention-cli", REPO_ROOT);
  assert.ok(cliPack.files.includes("package.json"));
  assert.ok(cliPack.files.some((file) => file.startsWith("dist/")));
  assert.equal(
    cliPack.files.some((file) => file.startsWith("src/") || file === "tsconfig.json"),
    false,
  );

  const skillPack = runWorkspacePackDryRun("@dobbymin/github-convention-skill", REPO_ROOT);
  assert.ok(skillPack.files.includes("package.json"));
  assert.ok(skillPack.files.includes("skill/SKILL.md"));
  assert.ok(skillPack.files.some((file) => file.startsWith("skill/references/")));
});

test("build-artifacts.mjs --dry-run: exits 0 with valid JSON and only CI-verified targets", () => {
  const scriptPath = path.normalize(
    path.join(REPO_ROOT, "scripts", "release", "build-artifacts.mjs"),
  );
  const stdout = execFileSync(process.execPath, [scriptPath, "--dry-run"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  const manifest = JSON.parse(stdout);

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.compatibility.compatible, true);
  assert.deepEqual(
    manifest.targets.map((t) => t.target),
    VERIFIED_TARGETS.map((t) => t.id),
  );
  assert.deepEqual(
    manifest.targets.map((t) => t.target),
    ["linux-x64", "darwin-arm64", "darwin-x64", "win32-x64"],
  );
});

test("stageArtifacts: generates archives, launchers, targets.json, and verifiable SHA256SUMS.txt", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ghc-release-test-"));
  const outDir = path.normalize(path.join(tmpRoot, "dist-release"));

  try {
    const result = stageArtifacts(outDir, REPO_ROOT);
    assert.equal(fs.existsSync(path.join(outDir, "targets.json")), true);
    assert.equal(fs.existsSync(path.join(outDir, "SHA256SUMS.txt")), true);

    const sumsText = fs.readFileSync(result.checksumFile, "utf8").trim();
    const lines = sumsText.split(/\r?\n/);
    // 4 archives + 4 launchers + targets.json = 9 entries
    assert.equal(lines.length, VERIFIED_TARGETS.length * 2 + 1);

    for (const line of lines) {
      const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
      assert.ok(match, `Invalid SHA256SUMS line: ${line}`);
      const [, expectedHash, relFile] = match;
      const fullPath = path.join(outDir, relFile);
      assert.equal(fs.existsSync(fullPath), true, `Missing checksummed file: ${relFile}`);
      assert.equal(sha256Hex(fullPath), expectedHash, `Checksum mismatch for ${relFile}`);
    }

    for (const target of result.manifest.targets) {
      assert.equal(fs.existsSync(path.join(outDir, target.archive)), true);
      assert.equal(fs.existsSync(path.join(outDir, target.launcher)), true);
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
