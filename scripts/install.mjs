#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_ID = "github-convention";
const MARKER_FILE = ".github-convention-script-managed";
const MANIFEST_FILE = ".github-convention-install-manifest";

const stripUncPrefix = (p) => (process.platform === "win32" && p.startsWith("\\\\?\\") ? p.slice(4) : p);

const normalizeCase = (p) => {
  const cleaned = stripUncPrefix(path.resolve(p)).replace(/[\\/]+$/, "") || path.parse(path.resolve(p)).root;
  return process.platform === "win32" ? cleaned.toLowerCase() : cleaned;
};

export const pathsEqual = (a, b) => normalizeCase(a) === normalizeCase(b);

export const canonicalizePath = (inputPath, baseDir = process.cwd()) => {
  const resolved = path.resolve(baseDir, inputPath);
  const missing = [];
  let cur = resolved;

  while (true) {
    try {
      const stat = fs.lstatSync(cur);
      if (stat.isSymbolicLink()) {
        const parent = path.dirname(cur);
        if (parent === cur) break;
        missing.unshift(path.basename(cur));
        cur = parent;
        continue;
      }
      const realBase = stripUncPrefix(fs.realpathSync(cur));
      return missing.length > 0 ? path.join(realBase, ...missing) : realBase;
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) {
        return resolved;
      }
      missing.unshift(path.basename(cur));
      cur = parent;
    }
  }
  return resolved;
};

const validateSkillName = (skillName) => {
  if (!skillName || skillName === "." || skillName === ".." || /[/\\]/.test(skillName)) {
    throw new Error(`Unsafe skill name: ${skillName}`);
  }
};

const verifyDestWithinTarget = (destPath, canonTargetDir, pluginRoot) => {
  const destParent = canonicalizePath(path.dirname(destPath));
  if (!pathsEqual(destParent, canonTargetDir)) return false;
  const root = path.parse(destPath).root;
  if (pathsEqual(destPath, root) || pathsEqual(destPath, canonTargetDir) || pathsEqual(destPath, pluginRoot)) {
    return false;
  }
  return true;
};

const isOwnedSymlink = (destPath, expectedSkillDir) => {
  let linkTarget;
  try {
    linkTarget = stripUncPrefix(fs.readlinkSync(destPath));
  } catch {
    return false;
  }
  const resolvedTarget = path.isAbsolute(linkTarget)
    ? linkTarget
    : path.resolve(path.dirname(destPath), linkTarget);
  return pathsEqual(canonicalizePath(resolvedTarget), canonicalizePath(expectedSkillDir));
};

const isOwnedCopyDir = (destPath, skillName, canonDestPath) => {
  let stat;
  try {
    stat = fs.lstatSync(destPath);
  } catch {
    return false;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) return false;

  const markerPath = path.join(destPath, MARKER_FILE);
  let markerStat;
  try {
    markerStat = fs.lstatSync(markerPath);
  } catch {
    return false;
  }
  if (!markerStat.isFile() || markerStat.isSymbolicLink()) return false;

  const lines = fs.readFileSync(markerPath, "utf8").split(/\r?\n/).filter(Boolean);
  if (lines.includes(`plugin=${PLUGIN_ID}`)) {
    const skillLine = lines.find((l) => l.startsWith("skill="));
    if (skillLine && skillLine !== `skill=${skillName}`) return false;
    const pathLine = lines.find((l) => l.startsWith("install-path="));
    if (pathLine && !pathsEqual(pathLine.slice("install-path=".length), canonDestPath)) {
      return false;
    }
    return true;
  }

  const hasAnyPlugin = lines.some((l) => l.startsWith("plugin="));
  if (lines.includes("managed-by=install.sh") && !hasAnyPlugin) {
    const skillMd = path.join(destPath, "SKILL.md");
    if (fs.existsSync(skillMd)) {
      const content = fs.readFileSync(skillMd, "utf8");
      if (!new RegExp(`^name:\\s*${skillName}\\s*$`, "m").test(content)) {
        return false;
      }
    }
    return true;
  }

  return false;
};

const isOwnedManifest = (manifestPath) => {
  try {
    const stat = fs.lstatSync(manifestPath);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    const lines = fs.readFileSync(manifestPath, "utf8").split(/\r?\n/).filter(Boolean);
    return lines.includes(`plugin=${PLUGIN_ID}`);
  } catch {
    return false;
  }
};

const removeOwnedSymlink = (destPath) => {
  if (process.platform === "win32") {
    try {
      fs.rmdirSync(destPath);
      return;
    } catch {
      // Fallback for file symlinks
    }
  }
  fs.unlinkSync(destPath);
};

const discoverSkills = (skillsRoot) => {
  if (!fs.existsSync(skillsRoot)) {
    throw new Error(`Skills directory not found: ${skillsRoot}`);
  }
  return fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(skillsRoot, d.name, "SKILL.md")))
    .map((d) => ({
      name: d.name,
      dir: canonicalizePath(path.join(skillsRoot, d.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

const resolveTargetDir = ({ scope = "project", scopeExplicit = false, target = "", cwd = process.cwd(), env = process.env, homeDir }) => {
  const effectiveHome = homeDir ?? env.HOME ?? env.USERPROFILE ?? os.homedir();
  let rawTarget = target;
  let scopeLabel;

  if (!rawTarget) {
    if (scope === "project") {
      rawTarget = path.join(cwd, ".agents", "skills");
    } else if (scope === "global") {
      rawTarget = path.join(effectiveHome, ".agents", "skills");
    } else {
      throw new Error(`Invalid --scope: ${scope} (expected project or global)`);
    }
    scopeLabel = scope;
  } else {
    scopeLabel = scopeExplicit ? scope : "custom";
  }

  const canonTarget = canonicalizePath(rawTarget, cwd);
  return { canonTarget, scopeLabel };
};

const assertSafeTarget = (canonTarget, rawTarget, pluginRoot, skillsRoot) => {
  const fsRoot = path.parse(canonTarget).root;
  if (
    !canonTarget ||
    pathsEqual(canonTarget, fsRoot) ||
    pathsEqual(canonTarget, pluginRoot) ||
    pathsEqual(canonTarget, skillsRoot)
  ) {
    throw new Error(`Refusing unsafe target directory: ${rawTarget || canonTarget}`);
  }
};

export const runInstaller = ({
  scope = "project",
  scopeExplicit = false,
  target = "",
  mode = "symlink",
  dryRun = false,
  cwd = process.cwd(),
  env = process.env,
  homeDir,
  pluginRoot = DEFAULT_PLUGIN_ROOT,
} = {}) => {
  const canonRoot = canonicalizePath(pluginRoot);
  const skillsRoot = path.join(canonRoot, "skills");
  const skills = discoverSkills(skillsRoot);
  if (skills.length === 0) {
    throw new Error(`No skills found under ${skillsRoot}`);
  }

  const { canonTarget, scopeLabel } = resolveTargetDir({
    scope,
    scopeExplicit,
    target,
    cwd,
    env,
    homeDir,
  });
  assertSafeTarget(canonTarget, target, canonRoot, skillsRoot);

  const manifestPath = path.join(canonTarget, MANIFEST_FILE);
  const conflicts = [];

  try {
    fs.lstatSync(manifestPath);
    if (!isOwnedManifest(manifestPath)) {
      conflicts.push(`Conflict: refusing to overwrite unmanaged manifest file at ${manifestPath}.`);
    }
  } catch {
    // Manifest does not exist yet
  }

  // Pass 1: Pre-flight ownership and path safety check (zero mutations)
  for (const skill of skills) {
    validateSkillName(skill.name);
    const dest = path.join(canonTarget, skill.name);
    if (!verifyDestWithinTarget(dest, canonTarget, canonRoot)) {
      conflicts.push(`Conflict: destination path escapes target directory (${dest}).`);
      continue;
    }

    let stat;
    try {
      stat = fs.lstatSync(dest);
    } catch {
      continue;
    }

    if (stat.isSymbolicLink()) {
      if (!isOwnedSymlink(dest, skill.dir)) {
        let targetStr = "<unreadable>";
        try {
          targetStr = fs.readlinkSync(dest);
        } catch {
          // ignore
        }
        conflicts.push(
          `Conflict: refusing to replace unmanaged symlink at ${dest} (points to: ${targetStr}).`,
        );
      }
    } else if (stat.isDirectory()) {
      if (!isOwnedCopyDir(dest, skill.name, dest)) {
        conflicts.push(
          `Conflict: refusing to overwrite unmanaged directory at ${dest} (missing valid ${MARKER_FILE} for ${PLUGIN_ID}).`,
        );
      }
    } else {
      conflicts.push(`Conflict: refusing to overwrite existing non-directory file at ${dest}.`);
    }
  }

  if (conflicts.length > 0) {
    throw new Error(`${conflicts.join("\n")}\nAborted installation: ${conflicts.length} conflict(s) detected. No files were modified.`);
  }

  const actions = [];
  if (dryRun) {
    for (const skill of skills) {
      const dest = path.join(canonTarget, skill.name);
      actions.push(`[dry-run] Would install (${mode}): ${skill.dir} -> ${dest}`);
    }
    actions.push(`[dry-run] Would write ownership manifest: ${manifestPath}`);
    return { ok: true, dryRun: true, target: canonTarget, count: skills.length, actions };
  }

  fs.mkdirSync(canonTarget, { recursive: true });
  const manifestLines = [
    "schema_version=1",
    `plugin=${PLUGIN_ID}`,
    "managed_by=scripts/install.mjs",
    `install_scope=${scopeLabel}`,
    `install_target=${canonTarget}`,
    `install_mode=${mode}`,
    `source_root=${canonRoot}`,
  ];

  for (const skill of skills) {
    const dest = path.join(canonTarget, skill.name);
    let existing = null;
    try {
      existing = fs.lstatSync(dest);
    } catch {
      existing = null;
    }

    if (existing) {
      if (!verifyDestWithinTarget(dest, canonTarget, canonRoot)) {
        throw new Error(`Unsafe destination path: ${dest}`);
      }
      if (existing.isSymbolicLink()) {
        if (!isOwnedSymlink(dest, skill.dir)) throw new Error(`Unmanaged symlink: ${dest}`);
        removeOwnedSymlink(dest);
      } else {
        if (!isOwnedCopyDir(dest, skill.name, dest)) throw new Error(`Unmanaged directory: ${dest}`);
        fs.rmSync(dest, { recursive: true, force: true });
      }
    }

    if (mode === "symlink") {
      fs.symlinkSync(skill.dir, dest, process.platform === "win32" ? "junction" : "dir");
      actions.push(`Installed symlink: ${dest} -> ${skill.dir}`);
    } else {
      fs.mkdirSync(dest, { recursive: true });
      fs.cpSync(skill.dir, dest, { recursive: true });
      const markerContent = [
        "schema_version=1",
        `plugin=${PLUGIN_ID}`,
        "managed-by=scripts/install.mjs",
        "install-mode=copy",
        `skill=${skill.name}`,
        `install-path=${dest}`,
        `source=${skill.dir}`,
        "",
      ].join("\n");
      fs.writeFileSync(path.join(dest, MARKER_FILE), markerContent, "utf8");
      actions.push(`Installed copy: ${dest}`);
    }
    manifestLines.push(`entry|${skill.name}|${mode}|${dest}|${skill.dir}`);
  }

  const manifestTmp = `${manifestPath}.tmp.${process.pid}`;
  fs.writeFileSync(manifestTmp, `${manifestLines.join("\n")}\n`, "utf8");
  fs.renameSync(manifestTmp, manifestPath);

  return { ok: true, dryRun: false, target: canonTarget, count: skills.length, actions };
};

export const runUninstaller = ({
  scope = "project",
  scopeExplicit = false,
  target = "",
  dryRun = false,
  cwd = process.cwd(),
  env = process.env,
  homeDir,
  pluginRoot = DEFAULT_PLUGIN_ROOT,
} = {}) => {
  const canonRoot = canonicalizePath(pluginRoot);
  const skillsRoot = path.join(canonRoot, "skills");
  const skills = discoverSkills(skillsRoot);

  const { canonTarget } = resolveTargetDir({
    scope,
    scopeExplicit,
    target,
    cwd,
    env,
    homeDir,
  });
  assertSafeTarget(canonTarget, target, canonRoot, skillsRoot);

  const manifestPath = path.join(canonTarget, MANIFEST_FILE);
  const conflicts = [];

  try {
    fs.lstatSync(manifestPath);
    if (!isOwnedManifest(manifestPath)) {
      conflicts.push(`Conflict: refusing to remove unmanaged manifest file at ${manifestPath}.`);
    }
  } catch {
    // Manifest does not exist
  }

  // Pass 1: Pre-flight ownership and containment check (zero deletions)
  for (const skill of skills) {
    validateSkillName(skill.name);
    const dest = path.join(canonTarget, skill.name);
    if (!verifyDestWithinTarget(dest, canonTarget, canonRoot)) {
      conflicts.push(`Conflict: destination path escapes target directory (${dest}).`);
      continue;
    }

    let stat;
    try {
      stat = fs.lstatSync(dest);
    } catch {
      continue;
    }

    if (stat.isSymbolicLink()) {
      if (!isOwnedSymlink(dest, skill.dir)) {
        let targetStr = "<unreadable>";
        try {
          targetStr = fs.readlinkSync(dest);
        } catch {
          // ignore
        }
        conflicts.push(
          `Conflict: refusing to remove unmanaged symlink at ${dest} (points to: ${targetStr}).`,
        );
      }
    } else if (!isOwnedCopyDir(dest, skill.name, dest)) {
      conflicts.push(
        `Conflict: refusing to remove unmanaged path at ${dest} (missing valid ${MARKER_FILE} for ${PLUGIN_ID}).`,
      );
    }
  }

  if (conflicts.length > 0) {
    throw new Error(`${conflicts.join("\n")}\nAborted uninstall: ${conflicts.length} conflict(s) detected. No files were removed.`);
  }

  const actions = [];
  for (const skill of skills) {
    const dest = path.join(canonTarget, skill.name);
    let stat;
    try {
      stat = fs.lstatSync(dest);
    } catch {
      continue;
    }

    if (dryRun) {
      actions.push(
        stat.isSymbolicLink()
          ? `[dry-run] Would remove owned symlink: ${dest}`
          : `[dry-run] Would remove owned directory: ${dest}`,
      );
      continue;
    }

    if (!verifyDestWithinTarget(dest, canonTarget, canonRoot)) {
      throw new Error(`Unsafe destination path: ${dest}`);
    }
    if (stat.isSymbolicLink()) {
      if (!isOwnedSymlink(dest, skill.dir)) throw new Error(`Unmanaged symlink: ${dest}`);
      removeOwnedSymlink(dest);
      actions.push(`Removed symlink: ${dest}`);
    } else {
      if (!isOwnedCopyDir(dest, skill.name, dest)) throw new Error(`Unmanaged directory: ${dest}`);
      fs.rmSync(dest, { recursive: true, force: true });
      actions.push(`Removed managed directory: ${dest}`);
    }
  }

  if (fs.existsSync(manifestPath) && isOwnedManifest(manifestPath)) {
    if (dryRun) {
      actions.push(`[dry-run] Would remove ownership manifest: ${manifestPath}`);
    } else {
      fs.unlinkSync(manifestPath);
      actions.push(`Removed ownership manifest: ${manifestPath}`);
    }
  }

  return { ok: true, dryRun, target: canonTarget, actions };
};

const printUsage = () => {
  process.stdout.write(
    [
      "Usage: node scripts/install.mjs [install|uninstall] [options]",
      "",
      "Cross-platform installer/uninstaller for github-convention skills (Windows, macOS, Linux).",
      "",
      "Options:",
      "  --uninstall               Uninstall github-convention skills",
      "  --scope <project|global>  Target scope (default: project)",
      "  --target <dir>            Explicit target parent directory for skills",
      "  --copy                    Copy files instead of creating symlinks/junctions",
      "  --dry-run                 Preview actions without modifying files",
      "  -h, --help                Show this help message",
      "",
    ].join("\n"),
  );
};

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  const args = process.argv.slice(2);
  let action = "install";
  let scope = "project";
  let scopeExplicit = false;
  let target = "";
  let mode = "symlink";
  let dryRun = false;

  try {
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      if (arg === "install" || arg === "uninstall") {
        action = arg;
      } else if (arg === "--uninstall") {
        action = "uninstall";
      } else if (arg === "--scope") {
        if (!args[i + 1]) throw new Error("Missing value for --scope");
        scope = args[i + 1];
        scopeExplicit = true;
        i += 1;
      } else if (arg === "--target") {
        if (!args[i + 1]) throw new Error("Missing value for --target");
        target = args[i + 1];
        i += 1;
      } else if (arg === "--copy") {
        mode = "copy";
      } else if (arg === "--dry-run") {
        dryRun = true;
      } else if (arg === "-h" || arg === "--help") {
        printUsage();
        process.exit(0);
      } else {
        throw new Error(`Unknown option: ${arg}`);
      }
    }

    const result =
      action === "uninstall"
        ? runUninstaller({ scope, scopeExplicit, target, dryRun })
        : runInstaller({ scope, scopeExplicit, target, mode, dryRun });
    if (result.actions.length > 0) {
      process.stdout.write(`${result.actions.join("\n")}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
