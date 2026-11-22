#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const MANIFEST_PATHS = [
  ".claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
  ".codex-plugin/plugin.json",
  ".agents/plugins/marketplace.json",
  ".cursor-plugin/plugin.json",
  ".antigravity-plugin/plugin.json",
  "gemini-extension.json",
];

const MAX_SKILL_BYTES = 8192;

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));

export const parseFrontmatter = (content, fileLabel) => {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    throw new Error(`${fileLabel}: missing YAML frontmatter block`);
  }
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    let value = trimmed.slice(colonIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
  }
  return fields;
};

const assertPathExists = (repoRoot, relPath, manifestRel, fieldName) => {
  if (typeof relPath !== "string" || relPath.trim().length === 0) {
    throw new Error(`${manifestRel}: "${fieldName}" must be a non-empty string`);
  }
  const resolved = path.resolve(repoRoot, path.normalize(relPath));
  if (!fs.existsSync(resolved)) {
    throw new Error(`${manifestRel}: "${fieldName}" points to missing path "${relPath}"`);
  }
};

export const validateRepo = (repoRoot = REPO_ROOT) => {
  const rootPkg = readJson(path.join(repoRoot, "package.json"));
  const expectedVersion = rootPkg.version;
  if (typeof expectedVersion !== "string" || expectedVersion.trim().length === 0) {
    throw new Error("package.json is missing a valid version");
  }

  for (const relPath of MANIFEST_PATHS) {
    const fullPath = path.join(repoRoot, path.normalize(relPath));
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Missing manifest: ${relPath}`);
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
    } else if (relPath === ".agents/plugins/marketplace.json") {
      if (!Array.isArray(manifest.plugins) || manifest.plugins.length === 0) {
        throw new Error(`${relPath}: plugins array must be non-empty`);
      }
      const primary = manifest.plugins[0];
      if (primary.name !== "github-convention") {
        throw new Error(`${relPath}: plugins[0].name must be "github-convention"`);
      }
      if (primary.source?.path !== undefined) {
        assertPathExists(repoRoot, primary.source.path, relPath, "plugins[0].source.path");
      }
    } else if (manifest.version !== expectedVersion) {
      throw new Error(`${relPath}: version (${manifest.version}) !== ${expectedVersion}`);
    }

    if (manifest.skills !== undefined) {
      assertPathExists(repoRoot, manifest.skills, relPath, "skills");
    }
    if (manifest.hooks !== undefined) {
      assertPathExists(repoRoot, manifest.hooks, relPath, "hooks");
    }
    for (const [field, assetPath] of [
      ["icon", manifest.icon],
      ["logo", manifest.logo],
      ["interface.logo", manifest.interface?.logo],
    ]) {
      if (assetPath === undefined) continue;
      assertPathExists(repoRoot, assetPath, relPath, field);
      if (assetPath.toLowerCase().endsWith(".png")) {
        const buf = fs.readFileSync(path.resolve(repoRoot, path.normalize(assetPath)));
        const isPng =
          buf.length >= 24 &&
          buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        if (!isPng) {
          throw new Error(`${relPath}: "${field}" is not a valid PNG file (${assetPath})`);
        }
        const width = buf.readUInt32BE(16);
        const height = buf.readUInt32BE(20);
        if (width !== height || width < 512) {
          throw new Error(
            `${relPath}: "${field}" must be a square PNG >= 512x512 (got ${width}x${height})`,
          );
        }
      }
    }

    if (
      relPath === "gemini-extension.json" &&
      (manifest.contextFileName === "GEMINI.md" || manifest.contextFileName === "AGENTS.md")
    ) {
      throw new Error(
        `${relPath}: contextFileName must not point to repo-internal ${manifest.contextFileName}`,
      );
    }
  }

  // Validate skills/*
  const skillsDir = path.join(repoRoot, "skills");
  if (!fs.existsSync(skillsDir)) {
    throw new Error("Missing skills/ directory");
  }
  const skillEntries = fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  if (skillEntries.length === 0) {
    throw new Error("skills/ directory contains no skills");
  }

  for (const skillName of skillEntries) {
    const skillFile = path.join(skillsDir, skillName, "SKILL.md");
    if (!fs.existsSync(skillFile)) {
      throw new Error(`skills/${skillName}: missing SKILL.md`);
    }
    const content = fs.readFileSync(skillFile, "utf8");
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > MAX_SKILL_BYTES) {
      throw new Error(`skills/${skillName}/SKILL.md exceeds ${MAX_SKILL_BYTES} bytes (${bytes})`);
    }
    const fm = parseFrontmatter(content, `skills/${skillName}/SKILL.md`);
    if (fm.name !== skillName) {
      throw new Error(
        `skills/${skillName}/SKILL.md: frontmatter name "${fm.name}" !== "${skillName}"`,
      );
    }
    if (!fm.description || !fm.description.includes("Use ")) {
      throw new Error(
        `skills/${skillName}/SKILL.md: frontmatter description must include a "Use ..." trigger phrase`,
      );
    }
  }

  // Validate agents/*.md
  const agentsDir = path.join(repoRoot, "agents");
  if (!fs.existsSync(agentsDir)) {
    throw new Error("Missing agents/ directory");
  }
  const agentFiles = fs
    .readdirSync(agentsDir, { withFileTypes: true })
    .filter((f) => f.isFile() && f.name.endsWith(".md"))
    .map((f) => f.name)
    .sort();
  if (agentFiles.length === 0) {
    throw new Error("agents/ directory contains no agent definitions");
  }

  for (const fileName of agentFiles) {
    const content = fs.readFileSync(path.join(agentsDir, fileName), "utf8");
    const fm = parseFrontmatter(content, `agents/${fileName}`);
    for (const required of ["name", "description", "model"]) {
      if (!fm[required]) {
        throw new Error(`agents/${fileName}: missing frontmatter field "${required}"`);
      }
    }
    if (fm.tools !== undefined) {
      throw new Error(
        `agents/${fileName}: omit platform-specific "tools" field for cross-harness compatibility with Gemini CLI`,
      );
    }
  }

  // Validate commands/*.md
  const commandsDir = path.join(repoRoot, "commands");
  if (!fs.existsSync(commandsDir)) {
    throw new Error("Missing commands/ directory");
  }
  const commandFiles = fs
    .readdirSync(commandsDir, { withFileTypes: true })
    .filter((f) => f.isFile() && f.name.endsWith(".md"))
    .map((f) => f.name)
    .sort();
  if (commandFiles.length === 0) {
    throw new Error("commands/ directory contains no command definitions");
  }

  for (const fileName of commandFiles) {
    const content = fs.readFileSync(path.join(commandsDir, fileName), "utf8");
    const fm = parseFrontmatter(content, `commands/${fileName}`);
    for (const required of ["description", "argument-hint"]) {
      if (!fm[required]) {
        throw new Error(`commands/${fileName}: missing frontmatter field "${required}"`);
      }
    }
  }

  // Validate hooks/hooks.json
  const hooksJsonPath = path.join(repoRoot, "hooks", "hooks.json");
  if (!fs.existsSync(hooksJsonPath)) {
    throw new Error("Missing hooks/hooks.json");
  }
  const hooksJson = readJson(hooksJsonPath);
  if (!hooksJson.hooks || typeof hooksJson.hooks !== "object") {
    throw new Error("hooks/hooks.json: missing top-level 'hooks' object");
  }
  for (const [eventName, entries] of Object.entries(hooksJson.hooks)) {
    if (!Array.isArray(entries)) {
      throw new Error(`hooks/hooks.json: hooks.${eventName} must be an array`);
    }
    for (const entry of entries) {
      for (const hook of entry.hooks ?? []) {
        const cmd = String(hook.command ?? "");
        const refMatch = cmd.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^\s"']+)/g);
        if (refMatch) {
          for (const ref of refMatch) {
            const rel = ref.replace("${CLAUDE_PLUGIN_ROOT}/", "");
            assertPathExists(repoRoot, rel, "hooks/hooks.json", `hooks.${eventName}`);
          }
        }
      }
    }
  }

  // Validate optional root hooks.json (Antigravity native hooks)
  const rootHooksJsonPath = path.join(repoRoot, "hooks.json");
  if (fs.existsSync(rootHooksJsonPath)) {
    const rootHooks = readJson(rootHooksJsonPath);
    if (!rootHooks || typeof rootHooks !== "object" || Array.isArray(rootHooks)) {
      throw new Error("hooks.json: must be a top-level JSON object");
    }
    for (const [hookName, hookConfig] of Object.entries(rootHooks)) {
      if (!hookConfig || typeof hookConfig !== "object" || Array.isArray(hookConfig)) {
        throw new Error(`hooks.json: "${hookName}" must be an object`);
      }
      for (const [eventName, entries] of Object.entries(hookConfig)) {
        if (eventName === "enabled") continue;
        if (!Array.isArray(entries)) {
          throw new Error(`hooks.json: ${hookName}.${eventName} must be an array`);
        }
        for (const entry of entries) {
          const handlers = Array.isArray(entry.hooks) ? entry.hooks : [entry];
          for (const handler of handlers) {
            const cmd = String(handler?.command ?? "");
            const relMatch = cmd.match(/\.(?:\/|\\)hooks(?:\/|\\)([^\s"']+)/);
            if (relMatch) {
              assertPathExists(
                repoRoot,
                path.join("hooks", relMatch[1]),
                "hooks.json",
                `${hookName}.${eventName}`,
              );
            }
          }
        }
      }
    }
  }

  return {
    version: expectedVersion,
    manifests: MANIFEST_PATHS.length,
    skills: skillEntries.length,
    agents: agentFiles.length,
    commands: commandFiles.length,
  };
};

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  try {
    const summary = validateRepo(REPO_ROOT);
    process.stdout.write(
      `Validated v${summary.version}: ${summary.manifests} manifests, ${summary.skills} skills, ${summary.agents} agents, ${summary.commands} commands.\n`,
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
