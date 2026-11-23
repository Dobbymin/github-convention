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

const isPathWithinDir = (childPath, parentDir) => {
  const normChild = normalizeCase(childPath);
  const normParent = normalizeCase(parentDir);
  if (normChild === normParent) return false;
  const prefix = normParent.endsWith(path.sep) ? normParent : `${normParent}${path.sep}`;
  return normChild.startsWith(prefix);
};

export const isSafeSkillName = (skillName) =>
  Boolean(skillName) && skillName !== "." && skillName !== ".." && !/[/\\]/.test(skillName);

const validateSkillName = (skillName) => {
  if (!isSafeSkillName(skillName)) {
    throw new Error(`Unsafe skill name: ${skillName}`);
  }
};

export const verifyDestWithinTarget = (destPath, canonTargetDir, pluginRoot, expectedName = path.basename(destPath)) => {
  if (!destPath || !canonTargetDir || !isSafeSkillName(expectedName)) return false;
  const destParent = canonicalizePath(path.dirname(destPath));
  if (!pathsEqual(destParent, canonTargetDir)) return false;
  const canonDest = canonicalizePath(destPath);
  const expectedDest = path.join(canonTargetDir, expectedName);
  if (!pathsEqual(destPath, expectedDest) || !pathsEqual(canonDest, expectedDest)) return false;
  const root = path.parse(canonDest).root;
  const skillsRoot = path.join(pluginRoot, "skills");
  if (
    pathsEqual(canonDest, root) ||
    pathsEqual(canonDest, canonTargetDir) ||
    pathsEqual(canonDest, pluginRoot) ||
    pathsEqual(canonDest, skillsRoot)
  ) {
    return false;
  }
  return true;
};

export const isOwnedSymlink = (destPath, expectedSkillDir, skillsRoot = path.dirname(expectedSkillDir)) => {
  let stat;
  try {
    stat = fs.lstatSync(destPath);
  } catch {
    return false;
  }
  if (!stat.isSymbolicLink()) return false;

  let linkTarget;
  try {
    linkTarget = stripUncPrefix(fs.readlinkSync(destPath));
  } catch {
    return false;
  }
  if (!linkTarget) return false;

  const resolvedTarget = path.isAbsolute(linkTarget)
    ? linkTarget
    : path.resolve(path.dirname(destPath), linkTarget);
  const canonActual = canonicalizePath(resolvedTarget);
  const canonExpected = canonicalizePath(expectedSkillDir);
  const canonSkillsRoot = canonicalizePath(skillsRoot);
  if (!isPathWithinDir(canonActual, canonSkillsRoot)) return false;
  return pathsEqual(canonActual, canonExpected);
};

const verifyCopyDirContents = (destDir, sourceDir) => {
  let entries;
  try {
    entries = fs.readdirSync(destDir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.name === MARKER_FILE) continue;
    const destEntry = path.join(destDir, entry.name);
    const srcEntry = path.join(sourceDir, entry.name);
    let destStat;
    let srcStat;
    try {
      destStat = fs.lstatSync(destEntry);
      srcStat = fs.lstatSync(srcEntry);
    } catch {
      return false;
    }
    if (destStat.isSymbolicLink() || srcStat.isSymbolicLink()) return false;
    if (destStat.isDirectory()) {
      if (!srcStat.isDirectory()) return false;
      if (!verifyCopyDirContents(destEntry, srcEntry)) return false;
    } else if (destStat.isFile()) {
      if (!srcStat.isFile()) return false;
    } else {
      return false;
    }
  }
  return true;
};

const verifyOrphanCopyDirContents = (destDir) => {
  let entries;
  try {
    entries = fs.readdirSync(destDir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.name === MARKER_FILE) continue;
    const destEntry = path.join(destDir, entry.name);
    let destStat;
    try {
      destStat = fs.lstatSync(destEntry);
    } catch {
      return false;
    }
    if (destStat.isSymbolicLink()) return false;
    if (entry.name === "SKILL.md") {
      if (!destStat.isFile()) return false;
    } else if (entry.name === "references") {
      if (!destStat.isDirectory()) return false;
      const refEntries = fs.readdirSync(destEntry, { withFileTypes: true });
      for (const ref of refEntries) {
        const refPath = path.join(destEntry, ref.name);
        const refStat = fs.lstatSync(refPath);
        if (refStat.isSymbolicLink() || !refStat.isFile() || !ref.name.endsWith(".md")) {
          return false;
        }
      }
    } else {
      return false;
    }
  }
  return true;
};

export const isOwnedCopyDir = (destPath, skillName, canonDestPath, expectedSourceDir, skillsRoot = expectedSourceDir ? path.dirname(expectedSourceDir) : null) => {
  let stat;
  try {
    stat = fs.lstatSync(destPath);
  } catch {
    return false;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
  if (!pathsEqual(canonicalizePath(destPath), canonDestPath)) return false;

  const markerPath = path.join(destPath, MARKER_FILE);
  let markerStat;
  try {
    markerStat = fs.lstatSync(markerPath);
  } catch {
    return false;
  }
  if (!markerStat.isFile() || markerStat.isSymbolicLink()) return false;

  const skillMdPath = path.join(destPath, "SKILL.md");
  let skillMdStat;
  try {
    skillMdStat = fs.lstatSync(skillMdPath);
  } catch {
    return false;
  }
  if (!skillMdStat.isFile() || skillMdStat.isSymbolicLink()) return false;
  const skillMdContent = fs.readFileSync(skillMdPath, "utf8");
  if (!new RegExp(`^name:\\s*${skillName}\\s*$`, "m").test(skillMdContent)) {
    return false;
  }

  const canonExpectedSource = expectedSourceDir ? canonicalizePath(expectedSourceDir) : null;
  if (canonExpectedSource && skillsRoot) {
    const canonSkillsRoot = canonicalizePath(skillsRoot);
    if (!isPathWithinDir(canonExpectedSource, canonSkillsRoot)) return false;
  }

  const sourceExists = Boolean(canonExpectedSource && fs.existsSync(canonExpectedSource));
  const checkContents = () => {
    if (sourceExists) {
      return verifyCopyDirContents(destPath, canonExpectedSource);
    }
    return verifyOrphanCopyDirContents(destPath);
  };

  const lines = fs.readFileSync(markerPath, "utf8").split(/\r?\n/).filter(Boolean);
  const pluginLines = lines.filter((l) => l.startsWith("plugin="));

  if (pluginLines.length === 1 && pluginLines[0] === `plugin=${PLUGIN_ID}`) {
    const skillLines = lines.filter((l) => l.startsWith("skill="));
    if (skillLines.some((l) => l !== `skill=${skillName}`)) return false;

    const pathLines = lines.filter((l) => l.startsWith("install-path="));
    for (const pathLine of pathLines) {
      const markerInstallPath = pathLine.slice("install-path=".length);
      if (!markerInstallPath || !pathsEqual(canonicalizePath(markerInstallPath), canonDestPath)) {
        return false;
      }
    }

    const sourceLines = lines.filter((l) => l.startsWith("source="));
    if (canonExpectedSource) {
      for (const sourceLine of sourceLines) {
        const markerSourcePath = sourceLine.slice("source=".length);
        if (!markerSourcePath || !pathsEqual(canonicalizePath(markerSourcePath), canonExpectedSource)) {
          return false;
        }
      }
    }

    return checkContents();
  }

  if (lines.includes("managed-by=install.sh") && pluginLines.length === 0) {
    return checkContents();
  }

  return false;
};

export const isOwnedManifest = (manifestPath) => {
  try {
    const stat = fs.lstatSync(manifestPath);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    const lines = fs.readFileSync(manifestPath, "utf8").split(/\r?\n/).filter(Boolean);
    const pluginLines = lines.filter((l) => l.startsWith("plugin="));
    return pluginLines.length === 1 && pluginLines[0] === `plugin=${PLUGIN_ID}`;
  } catch {
    return false;
  }
};

const collectRetiredManifestCandidates = ({ manifestPath, activeSkillNames, canonTarget, canonRoot, skillsRoot }) => {
  const conflicts = [];
  const retiredPlan = [];
  if (!isOwnedManifest(manifestPath)) {
    return { conflicts, retiredPlan };
  }
  const lines = fs.readFileSync(manifestPath, "utf8").split(/\r?\n/).filter(Boolean);
  const seenSkills = new Set();

  for (const line of lines) {
    if (!line.startsWith("entry|")) continue;
    const parts = line.split("|");
    const recSkill = parts[1] ?? "";
    if (!isSafeSkillName(recSkill)) {
      conflicts.push(`Conflict: unsafe skill name '${recSkill}' in manifest ${manifestPath}.`);
      continue;
    }
    if (activeSkillNames.has(recSkill) || seenSkills.has(recSkill)) {
      continue;
    }
    seenSkills.add(recSkill);

    const orphanDest = path.join(canonTarget, recSkill);
    const orphanExpectedSrc = canonicalizePath(path.join(skillsRoot, recSkill));
    let stat;
    try {
      stat = fs.lstatSync(orphanDest);
    } catch {
      continue;
    }

    if (!verifyDestWithinTarget(orphanDest, canonTarget, canonRoot, recSkill)) {
      conflicts.push(`Conflict: retired manifest entry escapes target directory (${orphanDest}).`);
      continue;
    }

    if (stat.isSymbolicLink()) {
      if (!isOwnedSymlink(orphanDest, orphanExpectedSrc, skillsRoot)) {
        let targetStr = "<unreadable>";
        try {
          targetStr = fs.readlinkSync(orphanDest);
        } catch {
          // ignore
        }
        conflicts.push(
          `Conflict: refusing to remove unmanaged retired symlink at ${orphanDest} (points to: ${targetStr}).`,
        );
        continue;
      }
      retiredPlan.push({
        type: "symlink",
        skill: { name: recSkill, dir: orphanExpectedSrc },
        dest: orphanDest,
        retired: true,
      });
    } else if (stat.isDirectory()) {
      if (!isOwnedCopyDir(orphanDest, recSkill, orphanDest, orphanExpectedSrc, skillsRoot)) {
        conflicts.push(
          `Conflict: refusing to remove unmanaged retired directory at ${orphanDest}.`,
        );
        continue;
      }
      retiredPlan.push({
        type: "copy",
        skill: { name: recSkill, dir: orphanExpectedSrc },
        dest: orphanDest,
        retired: true,
      });
    } else {
      conflicts.push(`Conflict: refusing to remove unmanaged non-directory file at ${orphanDest}.`);
    }
  }

  return { conflicts, retiredPlan };
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
  beforeRemoveHook,
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
    if (!verifyDestWithinTarget(dest, canonTarget, canonRoot, skill.name)) {
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
      if (!isOwnedSymlink(dest, skill.dir, skillsRoot)) {
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
      if (!isOwnedCopyDir(dest, skill.name, dest, skill.dir, skillsRoot)) {
        conflicts.push(
          `Conflict: refusing to overwrite unmanaged directory at ${dest} (missing valid ${MARKER_FILE} for ${PLUGIN_ID} or contains unexpected files).`,
        );
      }
    } else {
      conflicts.push(`Conflict: refusing to overwrite existing non-directory file at ${dest}.`);
    }
  }

  const activeSkillNames = new Set(skills.map((s) => s.name));
  const { conflicts: retiredConflicts, retiredPlan } = collectRetiredManifestCandidates({
    manifestPath,
    activeSkillNames,
    canonTarget,
    canonRoot,
    skillsRoot,
  });
  conflicts.push(...retiredConflicts);

  if (conflicts.length > 0) {
    throw new Error(`${conflicts.join("\n")}\nAborted installation: ${conflicts.length} conflict(s) detected. No files were modified.`);
  }

  const actions = [];
  if (dryRun) {
    for (const item of retiredPlan) {
      actions.push(
        item.type === "symlink"
          ? `[dry-run] Would prune retired owned symlink: ${item.dest}`
          : `[dry-run] Would prune retired owned directory: ${item.dest}`,
      );
    }
    for (const skill of skills) {
      const dest = path.join(canonTarget, skill.name);
      let existing = null;
      try {
        existing = fs.lstatSync(dest);
      } catch {
        existing = null;
      }
      if (existing?.isSymbolicLink()) {
        actions.push(`[dry-run] Would replace owned symlink: ${dest} -> ${skill.dir} (${mode})`);
      } else if (existing?.isDirectory()) {
        actions.push(`[dry-run] Would replace owned directory: ${dest} (${mode})`);
      } else {
        actions.push(`[dry-run] Would install (${mode}): ${skill.dir} -> ${dest}`);
      }
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

  for (const item of retiredPlan) {
    const { type, skill, dest } = item;
    if (typeof beforeRemoveHook === "function") {
      beforeRemoveHook({ dest, skill, canonTarget, type, retired: true });
    }
    if (!verifyDestWithinTarget(dest, canonTarget, canonRoot, skill.name)) {
      throw new Error(`Destination path verification failed for ${dest}. Aborting.`);
    }
    let currentStat;
    try {
      currentStat = fs.lstatSync(dest);
    } catch {
      continue;
    }
    if (type === "symlink") {
      if (!currentStat.isSymbolicLink() || !isOwnedSymlink(dest, skill.dir, skillsRoot)) {
        throw new Error(`Symlink ownership verification failed for ${dest}. Aborting.`);
      }
      removeOwnedSymlink(dest);
      actions.push(`Pruned retired symlink: ${dest}`);
    } else if (type === "copy") {
      if (!currentStat.isDirectory() || currentStat.isSymbolicLink() || !isOwnedCopyDir(dest, skill.name, dest, skill.dir, skillsRoot)) {
        throw new Error(`Directory ownership verification failed for ${dest}. Aborting.`);
      }
      fs.rmSync(dest, { recursive: true, force: false });
      actions.push(`Pruned retired directory: ${dest}`);
    }
  }

  for (const skill of skills) {
    const dest = path.join(canonTarget, skill.name);
    let existing = null;
    try {
      existing = fs.lstatSync(dest);
    } catch {
      existing = null;
    }

    if (existing) {
      if (typeof beforeRemoveHook === "function") {
        beforeRemoveHook({ dest, skill, canonTarget });
      }
      if (!verifyDestWithinTarget(dest, canonTarget, canonRoot, skill.name)) {
        throw new Error(`Destination path verification failed for ${dest}. Aborting.`);
      }
      let currentStat;
      try {
        currentStat = fs.lstatSync(dest);
      } catch {
        throw new Error(`Destination disappeared before verification for ${dest}. Aborting.`);
      }
      if (currentStat.isSymbolicLink()) {
        if (!isOwnedSymlink(dest, skill.dir, skillsRoot)) {
          throw new Error(`Symlink ownership verification failed for ${dest}. Aborting.`);
        }
        removeOwnedSymlink(dest);
      } else if (currentStat.isDirectory()) {
        if (!isOwnedCopyDir(dest, skill.name, dest, skill.dir, skillsRoot)) {
          throw new Error(`Directory ownership verification failed for ${dest}. Aborting.`);
        }
        fs.rmSync(dest, { recursive: true, force: false });
      } else {
        throw new Error(`Unexpected non-directory file at ${dest}. Aborting.`);
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

  let existingManifest = false;
  try {
    fs.lstatSync(manifestPath);
    existingManifest = true;
  } catch {
    existingManifest = false;
  }
  if (existingManifest && !isOwnedManifest(manifestPath)) {
    throw new Error(`Manifest ownership verification failed for ${manifestPath}. Aborting.`);
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
  beforeRemoveHook,
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
  const plan = [];

  try {
    fs.lstatSync(manifestPath);
    if (!isOwnedManifest(manifestPath)) {
      conflicts.push(`Conflict: refusing to remove unmanaged manifest file at ${manifestPath}.`);
    }
  } catch {
    // Manifest does not exist
  }

  // Pass 1: Pre-flight candidate collection, install-type classification, ownership & path verification (zero deletions)
  for (const skill of skills) {
    validateSkillName(skill.name);
    const dest = path.join(canonTarget, skill.name);
    let stat;
    try {
      stat = fs.lstatSync(dest);
    } catch {
      continue;
    }

    if (!verifyDestWithinTarget(dest, canonTarget, canonRoot, skill.name)) {
      conflicts.push(`Conflict: destination path escapes target directory (${dest}).`);
      continue;
    }

    if (stat.isSymbolicLink()) {
      if (!isOwnedSymlink(dest, skill.dir, skillsRoot)) {
        let targetStr = "<unreadable>";
        try {
          targetStr = fs.readlinkSync(dest);
        } catch {
          // ignore
        }
        conflicts.push(
          `Conflict: refusing to remove unmanaged symlink at ${dest} (points to: ${targetStr}).`,
        );
        continue;
      }
      plan.push({ type: "symlink", skill, dest });
    } else if (stat.isDirectory()) {
      if (!isOwnedCopyDir(dest, skill.name, dest, skill.dir, skillsRoot)) {
        conflicts.push(
          `Conflict: refusing to remove unmanaged path at ${dest} (missing valid ${MARKER_FILE} for ${PLUGIN_ID} or unexpected user files present).`,
        );
        continue;
      }
      plan.push({ type: "copy", skill, dest });
    } else {
      conflicts.push(`Conflict: refusing to remove unmanaged non-directory file at ${dest}.`);
    }
  }

  const activeSkillNames = new Set(skills.map((s) => s.name));
  const { conflicts: retiredConflicts, retiredPlan } = collectRetiredManifestCandidates({
    manifestPath,
    activeSkillNames,
    canonTarget,
    canonRoot,
    skillsRoot,
  });
  conflicts.push(...retiredConflicts);
  plan.push(...retiredPlan);

  if (conflicts.length > 0) {
    throw new Error(`${conflicts.join("\n")}\nAborted uninstall: ${conflicts.length} conflict(s) detected. No files were removed.`);
  }

  const actions = [];
  for (const item of plan) {
    const { type, skill, dest } = item;
    if (dryRun) {
      actions.push(
        type === "symlink"
          ? `[dry-run] Would remove owned symlink: ${dest}`
          : `[dry-run] Would remove owned directory: ${dest}`,
      );
      continue;
    }

    if (typeof beforeRemoveHook === "function") {
      beforeRemoveHook({ dest, skill, canonTarget, type });
    }

    if (!verifyDestWithinTarget(dest, canonTarget, canonRoot, skill.name)) {
      throw new Error(`Destination path verification failed for ${dest}. Aborting.`);
    }

    let currentStat;
    try {
      currentStat = fs.lstatSync(dest);
    } catch {
      continue;
    }

    if (type === "symlink") {
      if (!currentStat.isSymbolicLink() || !isOwnedSymlink(dest, skill.dir, skillsRoot)) {
        throw new Error(`Symlink ownership verification failed for ${dest}. Aborting.`);
      }
      removeOwnedSymlink(dest);
      actions.push(`Removed symlink: ${dest}`);
    } else if (type === "copy") {
      if (!currentStat.isDirectory() || currentStat.isSymbolicLink() || !isOwnedCopyDir(dest, skill.name, dest, skill.dir, skillsRoot)) {
        throw new Error(`Copy directory ownership verification failed for ${dest}. Aborting.`);
      }
      fs.rmSync(dest, { recursive: true, force: false });
      actions.push(`Removed managed directory: ${dest}`);
    }
  }

  let hasManifest = false;
  try {
    fs.lstatSync(manifestPath);
    hasManifest = true;
  } catch {
    hasManifest = false;
  }

  if (hasManifest) {
    if (dryRun) {
      if (isOwnedManifest(manifestPath)) {
        actions.push(`[dry-run] Would remove ownership manifest: ${manifestPath}`);
      }
    } else {
      if (!verifyDestWithinTarget(manifestPath, canonTarget, canonRoot, MANIFEST_FILE)) {
        throw new Error(`Manifest path verification failed for ${manifestPath}. Aborting.`);
      }
      if (!isOwnedManifest(manifestPath)) {
        throw new Error(`Manifest ownership verification failed for ${manifestPath}. Aborting.`);
      }
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
