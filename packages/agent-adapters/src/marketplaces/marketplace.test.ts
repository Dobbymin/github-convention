import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { computeDirectoryManifest } from "@github-convention/core";
import {
  computeAggregateCanonicalSha256,
  getMarketplaceAdapter,
  listMarketplaceAdapters,
  MARKETPLACE_MANIFEST_FILENAME,
  type MarketplaceFormatId,
  type MarketplacePackagingManifest,
} from "../index.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
const CANONICAL_SKILL_DIR = path.normalize(
  path.join(REPO_ROOT, ".agents", "skills", "github-convention"),
);

const withTempDir = (fn: (tmpDir: string) => void): void => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ghc-marketplace-test-"));
  try {
    fn(tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
};

test("marketplace registry: exposes only verified optional formats", () => {
  const adapters = listMarketplaceAdapters();
  assert.equal(adapters.length, 2);

  const ids = adapters.map((a) => a.id).sort();
  assert.deepEqual(ids, ["agents-skill-bundle", "claude-plugin"]);

  for (const adapter of adapters) {
    assert.equal(adapter.verified, true);
    assert.equal(getMarketplaceAdapter(adapter.id).id, adapter.id);
    assert.ok(adapter.name.length > 0);
    assert.ok(adapter.description.length > 0);
  }

  assert.throws(
    () => getMarketplaceAdapter("unverified-marketplace" as MarketplaceFormatId),
    /Unsupported or unverified marketplace format/,
  );
});

test("dry-run and planPackage: produce canonical manifest and digest with zero filesystem mutations", () => {
  withTempDir((tmpDir) => {
    const nonExistentOutDir = path.normalize(path.join(tmpDir, "never-created-out"));
    const canonicalExpected = computeDirectoryManifest(CANONICAL_SKILL_DIR);
    const expectedAggregateSha = computeAggregateCanonicalSha256(canonicalExpected);

    for (const adapter of listMarketplaceAdapters()) {
      const plan = adapter.planPackage({
        projectDir: REPO_ROOT,
        outDir: nonExistentOutDir,
      });

      assert.equal(plan.dryRun, true);
      assert.equal(path.normalize(plan.canonicalSourceDir), CANONICAL_SKILL_DIR);
      assert.equal(plan.canonicalSourceSha256, expectedAggregateSha);
      assert.deepEqual(plan.canonicalFiles, canonicalExpected);
      assert.ok(plan.plannedFiles.some((f) => f.role === "adapter-metadata"));
      assert.ok(plan.plannedFiles.some((f) => f.role === "packaging-manifest"));
      assert.equal(
        plan.plannedFiles.filter((f) => f.role === "canonical-copy").length,
        canonicalExpected.length,
      );

      const dryResult = adapter.packageForMarketplace({
        projectDir: REPO_ROOT,
        outDir: nonExistentOutDir,
        dryRun: true,
      });

      assert.equal(dryResult.dryRun, true);
      assert.deepEqual(dryResult.writtenFiles, []);
      assert.equal(dryResult.canonicalSourceSha256, expectedAggregateSha);
      assert.equal(fs.existsSync(nonExistentOutDir), false);
    }
  });
});

test("staged packaging: writes adapter bundle with zero canonical Skill fork", () => {
  withTempDir((tmpDir) => {
    const canonicalExpected = computeDirectoryManifest(CANONICAL_SKILL_DIR);
    const expectedAggregateSha = computeAggregateCanonicalSha256(canonicalExpected);

    // 1. claude-plugin
    const claudeOut = path.normalize(path.join(tmpDir, "claude-plugin-stage"));
    const claudeAdapter = getMarketplaceAdapter("claude-plugin");
    const claudeResult = claudeAdapter.packageForMarketplace({
      projectDir: REPO_ROOT,
      outDir: claudeOut,
      version: "0.2.0",
    });

    assert.equal(claudeResult.dryRun, false);
    assert.equal(claudeResult.canonicalSourceSha256, expectedAggregateSha);
    assert.ok(claudeResult.manifestPath);
    assert.equal(fs.existsSync(claudeResult.manifestPath), true);

    const pluginMetaPath = path.join(claudeOut, ".claude-plugin", "plugin.json");
    assert.equal(fs.existsSync(pluginMetaPath), true);
    const pluginMeta = JSON.parse(fs.readFileSync(pluginMetaPath, "utf-8")) as {
      name: string;
      version: string;
      canonicalSourceSha256: string;
    };
    assert.equal(pluginMeta.name, "github-convention");
    assert.equal(pluginMeta.version, "0.2.0");
    assert.equal(pluginMeta.canonicalSourceSha256, expectedAggregateSha);

    const stagedClaudeSkillDir = path.join(claudeOut, "skills", "github-convention");
    const stagedClaudeManifest = computeDirectoryManifest(stagedClaudeSkillDir);
    assert.deepEqual(stagedClaudeManifest, canonicalExpected);

    // 2. agents-skill-bundle
    const bundleOut = path.normalize(path.join(tmpDir, "agents-bundle-stage"));
    const bundleAdapter = getMarketplaceAdapter("agents-skill-bundle");
    const bundleResult = bundleAdapter.packageForMarketplace({
      projectDir: REPO_ROOT,
      outDir: bundleOut,
    });

    assert.equal(bundleResult.dryRun, false);
    assert.equal(bundleResult.canonicalSourceSha256, expectedAggregateSha);

    const stagedBundleSkillDir = path.join(bundleOut, "github-convention");
    const stagedBundleManifest = computeDirectoryManifest(stagedBundleSkillDir);
    assert.deepEqual(stagedBundleManifest, canonicalExpected);

    const manifestJson = JSON.parse(
      fs.readFileSync(path.join(bundleOut, MARKETPLACE_MANIFEST_FILENAME), "utf-8"),
    ) as MarketplacePackagingManifest;
    assert.equal(manifestJson.formatId, "agents-skill-bundle");
    assert.equal(manifestJson.canonicalSourceSha256, expectedAggregateSha);
    assert.deepEqual(manifestJson.canonicalFiles, canonicalExpected);
  });
});

test("cleanMarketplaceArtifacts: deletes only unmodified adapter-owned files verified by manifest", () => {
  withTempDir((tmpDir) => {
    const outDir = path.normalize(path.join(tmpDir, "clean-stage"));
    const adapter = getMarketplaceAdapter("agents-skill-bundle");

    // No-op when manifest does not exist
    const unownedFile = path.join(outDir, "user-notes.txt");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(unownedFile, "keep me", "utf-8");

    const emptyClean = adapter.cleanMarketplaceArtifacts(outDir);
    assert.deepEqual(emptyClean.removedFiles, []);
    assert.equal(emptyClean.manifestRemoved, false);
    assert.equal(fs.existsSync(unownedFile), true);

    // Stage bundle alongside unrelated user file
    const result = adapter.packageForMarketplace({
      projectDir: REPO_ROOT,
      outDir,
    });
    assert.ok(result.writtenFiles.length > 1);

    // Modify one adapter-owned file to verify ownership/integrity protection
    const modifiedTarget = path.join(outDir, "bundle.json");
    fs.writeFileSync(modifiedTarget, '{"custom": true}\n', "utf-8");

    const partialClean = adapter.cleanMarketplaceArtifacts(outDir);
    assert.deepEqual(partialClean.skippedFiles, ["bundle.json"]);
    assert.equal(partialClean.manifestRemoved, false);
    assert.equal(fs.existsSync(modifiedTarget), true);
    assert.equal(fs.existsSync(unownedFile), true);

    // Re-stage cleanly and run full clean
    adapter.packageForMarketplace({
      projectDir: REPO_ROOT,
      outDir,
    });
    const fullClean = adapter.cleanMarketplaceArtifacts(outDir);
    assert.deepEqual(fullClean.skippedFiles, []);
    assert.equal(fullClean.manifestRemoved, true);
    assert.equal(fs.existsSync(modifiedTarget), false);
    assert.equal(fs.existsSync(path.join(outDir, MARKETPLACE_MANIFEST_FILENAME)), false);
    assert.equal(fs.existsSync(unownedFile), true);
  });
});
