import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteFile, toPosixRelativePath } from "@dobbymin/github-convention-core";

export const REQUIRED_IGNORE_ENTRIES = [
  ".github-convention/cache/",
  ".github-convention/state/",
  ".github-convention/logs/",
] as const;

export const PROTECTED_TRACKED_PATHS = [
  ".agents/skills/github-convention/",
  ".github-convention/config.yaml",
  ".github-convention/conventions/",
] as const;

export interface PlanIgnoreOptions {
  projectRoot?: string;
  adapterFallbackPaths?: string[];
}

export interface IgnorePlan {
  gitignorePath: string;
  exists: boolean;
  requiredEntries: string[];
  adapterFallbackEntries: string[];
  alreadyPresent: string[];
  entriesToAdd: string[];
  proposedContent: string;
  changed: boolean;
}

const normalizeIgnorePattern = (raw: string): string => {
  const posix = toPosixRelativePath(raw.trim());
  return posix.replace(/^\.\//, "").replace(/^\/+/, "");
};

const patternCoversProtectedPath = (pattern: string, protectedPath: string): boolean => {
  const normPattern = normalizeIgnorePattern(pattern);
  const normProtected = normalizeIgnorePattern(protectedPath);

  if (!normPattern || normPattern.startsWith("#") || normPattern.startsWith("!")) {
    return false;
  }

  if (normPattern === "*" || normPattern === "**") {
    return true;
  }

  const patternBase = normPattern.replace(/\/\*+$/, "/").replace(/\*+$/, "");
  const protectedNoSlash = normProtected.replace(/\/$/, "");
  const patternNoSlash = normPattern.replace(/\/$/, "");

  if (patternNoSlash === protectedNoSlash) {
    return true;
  }

  if (normPattern.endsWith("/") && normProtected.startsWith(normPattern)) {
    return true;
  }

  if (
    (normPattern.endsWith("/*") || normPattern.endsWith("/**")) &&
    normProtected.startsWith(patternBase)
  ) {
    return true;
  }

  if (normProtected.startsWith(`${patternNoSlash}/`)) {
    return true;
  }

  return false;
};

export const assertSafeIgnoreEntry = (entry: string): string => {
  const trimmed = entry.trim();
  if (!trimmed) {
    throw new Error("Ignore entry cannot be empty.");
  }

  const normalized = normalizeIgnorePattern(trimmed);
  for (const protectedPath of PROTECTED_TRACKED_PATHS) {
    if (patternCoversProtectedPath(normalized, protectedPath)) {
      throw new Error(
        `Safety invariant violation: ignore entry '${entry}' would ignore protected tracked path '${protectedPath}'.`,
      );
    }
  }

  return normalized;
};

export const planGitignoreUpdates = (options: PlanIgnoreOptions = {}): IgnorePlan => {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const gitignorePath = path.join(projectRoot, ".gitignore");
  const exists = fs.existsSync(gitignorePath);
  const existingContent = exists ? fs.readFileSync(gitignorePath, "utf-8") : "";

  const existingLines = new Set(
    existingContent
      .split(/\r?\n/)
      .map((line) => normalizeIgnorePattern(line))
      .filter((line) => line.length > 0 && !line.startsWith("#")),
  );

  const requiredEntries = [...REQUIRED_IGNORE_ENTRIES];
  const adapterFallbackEntries: string[] = [];

  for (const rawPath of options.adapterFallbackPaths ?? []) {
    const safeEntry = assertSafeIgnoreEntry(rawPath);
    if (!requiredEntries.includes(safeEntry as (typeof REQUIRED_IGNORE_ENTRIES)[number])) {
      adapterFallbackEntries.push(safeEntry);
    }
  }

  const desiredEntries = [...requiredEntries, ...adapterFallbackEntries];
  for (const entry of desiredEntries) {
    assertSafeIgnoreEntry(entry);
  }

  const alreadyPresent: string[] = [];
  const entriesToAdd: string[] = [];

  for (const entry of desiredEntries) {
    const norm = normalizeIgnorePattern(entry);
    const normNoSlash = norm.replace(/\/$/, "");
    if (existingLines.has(norm) || existingLines.has(normNoSlash)) {
      alreadyPresent.push(entry);
    } else {
      entriesToAdd.push(entry);
    }
  }

  let proposedContent = existingContent;
  const changed = entriesToAdd.length > 0;

  if (changed) {
    const needsLeadingNewline = existingContent.length > 0 && !existingContent.endsWith("\n");
    const prefix = needsLeadingNewline ? "\n" : "";
    const block = entriesToAdd.join("\n") + "\n";
    proposedContent = `${existingContent}${prefix}${block}`;
  }

  return {
    gitignorePath,
    exists,
    requiredEntries,
    adapterFallbackEntries,
    alreadyPresent,
    entriesToAdd,
    proposedContent,
    changed,
  };
};

export const applyGitignorePlan = (plan: IgnorePlan, dryRun = false): boolean => {
  if (dryRun || !plan.changed) {
    return false;
  }
  atomicWriteFile(plan.gitignorePath, plan.proposedContent);
  return true;
};
