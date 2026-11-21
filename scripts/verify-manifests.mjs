#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const ROOT_MANIFEST_PATHS = [
  ".claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
  ".codex-plugin/plugin.json",
  "gemini-extension.json",
  "plugin.json",
];

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));

const assertPathExists = (repoRoot, relPath, manifestRelPath, fieldName) => {
  if (typeof relPath !== "string" || relPath.trim().length === 0) {
    throw new Error(`${manifestRelPath}: "${fieldName}" must be a non-empty string`);
  }
  const resolved = path.resolve(repoRoot, relPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`${manifestRelPath}: "${fieldName}" points to missing path "${relPath}"`);
  }
};

export const verifyRootManifests = (repoRoot = REPO_ROOT) => {
  const skillPkgPath = path.join(repoRoot, "packages", "skill", "package.json");
  const skillPkg = readJson(skillPkgPath);
  const expectedVersion = skillPkg.version;
  if (typeof expectedVersion !== "string" || expectedVersion.trim().length === 0) {
    throw new Error("packages/skill/package.json is missing a valid version");
  }

  const verified = [];

  for (const relPath of ROOT_MANIFEST_PATHS) {
    const fullPath = path.join(repoRoot, relPath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Missing root manifest: ${relPath}`);
    }
    const manifest = readJson(fullPath);

    if (manifest.name !== "github-convention") {
      throw new Error(`${relPath}: expected name "github-convention", got "${manifest.name}"`);
    }

    if (relPath === ".claude-plugin/marketplace.json") {
      if (manifest.metadata?.version !== expectedVersion) {
        throw new Error(
          `${relPath}: metadata.version (${manifest.metadata?.version}) !== ${expectedVersion}`,
        );
      }
      if (!Array.isArray(manifest.plugins) || manifest.plugins.length === 0) {
        throw new Error(`${relPath}: plugins array must be non-empty`);
      }
      const primary = manifest.plugins[0];
      if (primary.name !== "github-convention" || primary.version !== expectedVersion) {
        throw new Error(
          `${relPath}: plugins[0] must match name "github-convention" and version ${expectedVersion}`,
        );
      }
      assertPathExists(repoRoot, primary.source, relPath, "plugins[0].source");
    } else {
      if (manifest.version !== expectedVersion) {
        throw new Error(`${relPath}: version (${manifest.version}) !== ${expectedVersion}`);
      }
    }

    if (manifest.skills !== undefined) {
      assertPathExists(repoRoot, manifest.skills, relPath, "skills");
    }
    if (manifest.commands !== undefined) {
      assertPathExists(repoRoot, manifest.commands, relPath, "commands");
    }
    if (manifest.hooks !== undefined) {
      assertPathExists(repoRoot, manifest.hooks, relPath, "hooks");
      readJson(path.resolve(repoRoot, manifest.hooks));
    }

    if (
      relPath === "gemini-extension.json" &&
      (manifest.contextFileName === "GEMINI.md" || manifest.contextFileName === "AGENTS.md")
    ) {
      throw new Error(
        `${relPath}: contextFileName must not point to repo-internal ${manifest.contextFileName}`,
      );
    }

    verified.push(relPath);
  }

  return { expectedVersion, verified };
};

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  try {
    const result = verifyRootManifests(REPO_ROOT);
    process.stdout.write(
      `Verified ${result.verified.length} root manifests at v${result.expectedVersion}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
