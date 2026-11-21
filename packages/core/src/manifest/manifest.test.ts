import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import {
  computeDirectoryManifest,
  computeFileHash,
  type InstallManifest,
  loadManifest,
  saveManifest,
  verifyManifestIntegrity,
} from "./index.js";

test("hasher: computes sha256 and directory manifest with relative paths", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "manifest-test-"));
  fs.writeFileSync(path.join(tmpDir, "SKILL.md"), "# Test Skill", "utf-8");
  fs.mkdirSync(path.join(tmpDir, "sub"));
  fs.writeFileSync(path.join(tmpDir, "sub", "doc.md"), "Documentation", "utf-8");

  const fileHash = computeFileHash(path.join(tmpDir, "SKILL.md"));
  assert.equal(fileHash.size, 12);
  assert.equal(fileHash.sha256.length, 64);

  const manifestRecords = computeDirectoryManifest(tmpDir);
  assert.equal(manifestRecords.length, 2);
  assert.equal(manifestRecords[0].relativePath, "SKILL.md");
  assert.equal(manifestRecords[1].relativePath, "sub/doc.md");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("manifest: saves, loads, and verifies integrity accurately", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "manifest-test-"));
  fs.writeFileSync(path.join(tmpDir, "SKILL.md"), "# Original Skill", "utf-8");

  const records = computeDirectoryManifest(tmpDir);
  const manifest: InstallManifest = {
    schemaVersion: 1,
    skillName: "github-convention",
    skillVersion: "0.1.0",
    installedAt: new Date().toISOString(),
    agentId: "claude-code",
    scope: "project",
    targetPath: tmpDir,
    installType: "copy",
    files: records,
  };

  saveManifest(tmpDir, manifest);
  const loaded = loadManifest(tmpDir);
  assert.ok(loaded);
  assert.equal(loaded.skillName, "github-convention");
  assert.equal(loaded.files.length, 1);

  // Initial check: valid
  const check1 = verifyManifestIntegrity(tmpDir, loaded);
  assert.equal(check1.valid, true);
  assert.equal(check1.modifiedFiles.length, 0);

  // Modify file -> detected as modified
  fs.writeFileSync(path.join(tmpDir, "SKILL.md"), "# Tampered Skill Content", "utf-8");
  const check2 = verifyManifestIntegrity(tmpDir, loaded);
  assert.equal(check2.valid, false);
  assert.deepEqual(check2.modifiedFiles, ["SKILL.md"]);

  // Add extra file -> detected as unexpected
  fs.writeFileSync(path.join(tmpDir, "extra.txt"), "Extra", "utf-8");
  const check3 = verifyManifestIntegrity(tmpDir, loaded);
  assert.equal(check3.valid, false);
  assert.deepEqual(check3.unexpectedFiles, ["extra.txt"]);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
