import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  diffCacheSources,
  getAnalysisCachePath,
  loadAnalysisCache,
  saveAnalysisCache,
  toPosixRelativePath,
} from "../cache/analysis-cache.js";
import {
  ANALYSIS_CACHE_SCHEMA_VERSION,
  type CachedSourceRecord,
  type CurrentSourceFile,
} from "../cache/types.js";
import { parseYaml } from "../config/yaml.js";
import { computeFileHash } from "../manifest/hasher.js";
import { atomicWriteJson } from "../state/atomic-write.js";
import type {
  AnalyzeRepositoryOptions,
  CommitStyleName,
  ConflictResolutionRecord,
  ConflictResolutionStore,
  ConventionConflict,
  ConventionConflictSource,
  GitSamplingResult,
  MergeStrategyName,
  PackageManagerName,
  PackageScriptsSummary,
  RepositoryAnalysis,
  RepositoryAnalysisResult,
  SourceCategory,
  SourceConventionSignals,
} from "./types.js";

const INSTRUCTION_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  "CONTRIBUTING.md",
  "README.md",
] as const;

const PR_TEMPLATE_CANDIDATES = [
  ".github/pull_request_template.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
] as const;

const CONVENTIONAL_COMMIT_REGEX =
  /^(feat|fix|chore|docs|refactor|test|ci|build|perf|style|revert)(\([^)]+\))?!?:\s+/;

export const getResolutionsPath = (projectRoot: string): string => {
  return path.join(
    path.resolve(projectRoot),
    ".github-convention",
    "conventions",
    "resolutions.json",
  );
};

export const loadConflictResolutions = (projectRoot: string): ConflictResolutionStore => {
  const resolutionsPath = getResolutionsPath(projectRoot);
  if (!fs.existsSync(resolutionsPath)) {
    return {
      schemaVersion: 1,
      updatedAt: new Date(0).toISOString(),
      resolutions: {},
    };
  }

  try {
    const raw = fs.readFileSync(resolutionsPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<ConflictResolutionStore>;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      parsed.schemaVersion !== 1 ||
      typeof parsed.resolutions !== "object" ||
      parsed.resolutions === null ||
      Array.isArray(parsed.resolutions)
    ) {
      return {
        schemaVersion: 1,
        updatedAt: new Date(0).toISOString(),
        resolutions: {},
      };
    }

    return {
      schemaVersion: 1,
      updatedAt:
        typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
      resolutions: parsed.resolutions,
    };
  } catch {
    return {
      schemaVersion: 1,
      updatedAt: new Date(0).toISOString(),
      resolutions: {},
    };
  }
};

export const saveConflictResolutions = (
  projectRoot: string,
  store: ConflictResolutionStore,
): string => {
  const resolutionsPath = getResolutionsPath(projectRoot);
  const payload: ConflictResolutionStore = {
    schemaVersion: 1,
    updatedAt: store.updatedAt || new Date().toISOString(),
    resolutions: store.resolutions,
  };
  atomicWriteJson(resolutionsPath, payload);
  return resolutionsPath;
};

export const resolveConventionConflict = (
  projectRoot: string,
  conflict: ConventionConflict,
  selection: { selectedValue: string; selectedSource: string; note?: string },
): ConflictResolutionRecord => {
  const store = loadConflictResolutions(projectRoot);
  const sourceHashes: Record<string, string> = {};
  for (const src of conflict.sources) {
    sourceHashes[toPosixRelativePath(src.relativePath)] = src.sha256;
  }

  const record: ConflictResolutionRecord = {
    conflictId: conflict.id,
    topic: conflict.topic,
    selectedValue: selection.selectedValue,
    selectedSource: toPosixRelativePath(selection.selectedSource),
    sourceHashes,
    resolvedAt: new Date().toISOString(),
    ...(selection.note !== undefined ? { note: selection.note } : {}),
  };

  store.resolutions[conflict.id] = record;
  store.updatedAt = record.resolvedAt;
  saveConflictResolutions(projectRoot, store);
  return record;
};

const collectFilesRecursively = (
  projectRoot: string,
  relDir: string,
  filter?: (fileName: string) => boolean,
): Array<{ relativePath: string; category?: SourceCategory }> => {
  const absDir = path.join(projectRoot, relDir);
  if (!fs.existsSync(absDir)) {
    return [];
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(absDir);
  } catch {
    return [];
  }
  if (!stat.isDirectory()) {
    return [];
  }

  const entries = fs.readdirSync(absDir, { withFileTypes: true });
  const results: Array<{ relativePath: string }> = [];

  for (const entry of entries) {
    const relPath = toPosixRelativePath(path.posix.join(toPosixRelativePath(relDir), entry.name));
    const absPath = path.join(projectRoot, relPath);
    if (entry.isDirectory()) {
      results.push(...collectFilesRecursively(projectRoot, relPath, filter));
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      try {
        if (!fs.statSync(absPath).isFile()) continue;
      } catch {
        continue;
      }
      if (!filter || filter(entry.name)) {
        results.push({ relativePath: relPath });
      }
    }
  }

  return results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
};

export const discoverTargetedSources = (
  projectRoot: string,
): Array<CurrentSourceFile & { category: SourceCategory }> => {
  const resolvedRoot = path.resolve(projectRoot);
  const candidates: Array<{ relativePath: string; category: SourceCategory }> = [];

  for (const name of INSTRUCTION_FILES) {
    candidates.push({ relativePath: name, category: "instruction" });
  }

  candidates.push({ relativePath: "package.json", category: "package_manifest" });

  for (const issueFile of collectFilesRecursively(resolvedRoot, ".github/ISSUE_TEMPLATE")) {
    candidates.push({ relativePath: issueFile.relativePath, category: "issue_template" });
  }

  for (const prTemplate of PR_TEMPLATE_CANDIDATES) {
    candidates.push({ relativePath: prTemplate, category: "pr_template" });
  }

  for (const wfFile of collectFilesRecursively(resolvedRoot, ".github/workflows")) {
    candidates.push({ relativePath: wfFile.relativePath, category: "workflow" });
  }

  candidates.push({ relativePath: "templates/labels.yaml", category: "labels" });
  candidates.push({ relativePath: ".github-convention/config.yaml", category: "project_config" });

  for (const convFile of collectFilesRecursively(
    resolvedRoot,
    ".github-convention/conventions",
    (name) => name.endsWith(".md"),
  )) {
    candidates.push({ relativePath: convFile.relativePath, category: "project_convention" });
  }

  const discovered: Array<CurrentSourceFile & { category: SourceCategory }> = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const normRel = toPosixRelativePath(candidate.relativePath);
    if (seen.has(normRel)) continue;

    const absPath = path.join(resolvedRoot, normRel);
    if (!fs.existsSync(absPath)) continue;

    let stat: fs.Stats;
    try {
      stat = fs.statSync(absPath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;

    seen.add(normRel);
    const { sha256, size } = computeFileHash(absPath);
    discovered.push({
      relativePath: normRel,
      sha256,
      size,
      mtimeMs: stat.mtimeMs,
      category: candidate.category,
    });
  }

  return discovered.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
};

const detectPackageManagerInText = (text: string): PackageManagerName | undefined => {
  const counts: Record<PackageManagerName, number> = {
    pnpm: (text.match(/\bpnpm\s+(install|run|test|build|lint|exec|dlx)\b/gi) ?? []).length,
    yarn: (text.match(/\byarn\s+(install|run|test|build|lint|add)\b/gi) ?? []).length,
    bun: (text.match(/\bbun\s+(install|run|test|build|x)\b/gi) ?? []).length,
    npm: (text.match(/\bnpm\s+(install|ci|run|test)\b/gi) ?? []).length,
  };

  const detected = (Object.entries(counts) as Array<[PackageManagerName, number]>).filter(
    ([, count]) => count > 0,
  );
  if (detected.length === 0) return undefined;
  detected.sort((a, b) => b[1] - a[1]);
  return detected[0]?.[0];
};

const detectBranchInText = (text: string): string | undefined => {
  const match =
    /(?:default\s+branch|base\s+branch|target\s+branch|main\s+branch|against\s+branch)\s*[:=]\s*`?([A-Za-z0-9._/-]+)`?/i.exec(
      text,
    ) ??
    /(?:PRs?\s+(?:target|against|into)|merge\s+into|branch\s+from)\s+`?(main|master|develop|trunk)`?/i.exec(
      text,
    );
  return match?.[1]?.toLowerCase();
};

const detectCommitStyleInText = (text: string): CommitStyleName | undefined => {
  if (/conventional\s+commits?/i.test(text)) return "conventional";
  if (/gitmoji/i.test(text)) return "gitmoji";
  if (/freeform\s+commits?/i.test(text)) return "freeform";
  return undefined;
};

const detectMergeStrategyInText = (text: string): MergeStrategyName | undefined => {
  if (/squash\s*(?:and\s*)?merge|squash-merge/i.test(text)) return "squash";
  if (/rebase\s*(?:and\s*)?merge|rebase-merge/i.test(text)) return "rebase";
  if (/merge\s+commit/i.test(text)) return "merge";
  return undefined;
};

const extractPackageScripts = (
  scriptsObj: Record<string, unknown>,
): PackageScriptsSummary | undefined => {
  const summary: PackageScriptsSummary = {};
  const pick = (keys: string[]): string | undefined => {
    for (const key of keys) {
      const val = scriptsObj[key];
      if (typeof val === "string" && val.trim().length > 0) {
        return key;
      }
    }
    return undefined;
  };

  const format = pick(["format:check", "format"]);
  const lint = pick(["lint", "lint:check"]);
  const typecheck = pick(["typecheck", "type-check", "check:types"]);
  const test = pick(["test", "test:unit"]);
  const build = pick(["build"]);
  const secretScan = pick(["secret-scan", "secret:scan", "scan:secrets", "gitleaks"]);

  if (format) summary.format = format;
  if (lint) summary.lint = lint;
  if (typecheck) summary.typecheck = typecheck;
  if (test) summary.test = test;
  if (build) summary.build = build;
  if (secretScan) summary.secretScan = secretScan;

  return Object.keys(summary).length > 0 ? summary : undefined;
};

const analyzeSingleSource = (
  projectRoot: string,
  file: CurrentSourceFile & { category: SourceCategory },
): SourceConventionSignals => {
  const absPath = path.join(projectRoot, file.relativePath);
  const content = fs.readFileSync(absPath, "utf-8");
  const signals: SourceConventionSignals = { category: file.category };

  if (file.category === "package_manifest") {
    try {
      const pkg = JSON.parse(content) as Record<string, unknown>;
      if (typeof pkg.packageManager === "string") {
        const pmMatch = /^(npm|pnpm|yarn|bun)@/i.exec(pkg.packageManager.trim());
        if (pmMatch) {
          signals.packageManager = pmMatch[1].toLowerCase() as PackageManagerName;
        }
      }
      if (typeof pkg.scripts === "object" && pkg.scripts !== null && !Array.isArray(pkg.scripts)) {
        signals.scripts = extractPackageScripts(pkg.scripts as Record<string, unknown>);
      }
    } catch {
      // Ignore malformed package.json during analysis
    }
    return signals;
  }

  if (file.category === "project_config") {
    try {
      const parsed = parseYaml(content);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        const cfg = parsed as Record<string, unknown>;
        if (typeof cfg.github === "object" && cfg.github !== null && !Array.isArray(cfg.github)) {
          const gh = cfg.github as Record<string, unknown>;
          if (typeof gh.default_branch === "string" && gh.default_branch !== "detect") {
            signals.defaultBranch = gh.default_branch;
          }
        }
      }
    } catch {
      // Ignore malformed config yaml
    }
    return signals;
  }

  if (file.category === "workflow") {
    const pm = detectPackageManagerInText(content);
    if (pm) signals.packageManager = pm;

    const checks: string[] = [];
    for (const check of ["test", "lint", "typecheck", "build", "format"]) {
      if (new RegExp(`\\b${check}\\b`, "i").test(content)) {
        checks.push(check);
      }
    }
    if (checks.length > 0) {
      signals.workflowChecks = checks;
    }
    return signals;
  }

  if (file.category === "labels") {
    try {
      const parsed = parseYaml(content);
      if (Array.isArray(parsed)) {
        signals.labels = parsed
          .map((item) =>
            typeof item === "object" && item !== null && "name" in item
              ? String((item as Record<string, unknown>).name)
              : typeof item === "string"
                ? item
                : null,
          )
          .filter((x): x is string => x !== null);
      }
    } catch {
      // Ignore malformed labels yaml
    }
    return signals;
  }

  if (file.category === "instruction" || file.category === "project_convention") {
    const pm = detectPackageManagerInText(content);
    if (pm) signals.packageManager = pm;

    const branch = detectBranchInText(content);
    if (branch) signals.defaultBranch = branch;

    const commitStyle = detectCommitStyleInText(content);
    if (commitStyle) signals.commitStyle = commitStyle;

    const mergeStrategy = detectMergeStrategyInText(content);
    if (mergeStrategy) signals.mergeStrategy = mergeStrategy;
  }

  return signals;
};

export const sampleGitRepository = (projectRoot: string): GitSamplingResult => {
  const execOpts = {
    cwd: path.resolve(projectRoot),
    encoding: "utf-8" as const,
    stdio: ["pipe", "pipe", "pipe"] as ["pipe", "pipe", "pipe"],
    timeout: 3000,
  };

  try {
    const inside = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], execOpts).trim();
    if (inside !== "true") {
      return {
        isGitRepo: false,
        currentBranch: null,
        recentCommitSubjects: [],
        inferredCommitStyle: null,
      };
    }
  } catch {
    return {
      isGitRepo: false,
      currentBranch: null,
      recentCommitSubjects: [],
      inferredCommitStyle: null,
    };
  }

  let currentBranch: string | null = null;
  try {
    const branch = execFileSync("git", ["branch", "--show-current"], execOpts).trim();
    currentBranch = branch.length > 0 ? branch : null;
  } catch {
    currentBranch = null;
  }

  let recentCommitSubjects: string[] = [];
  try {
    const logOut = execFileSync("git", ["log", "-n", "10", "--pretty=format:%s"], execOpts).trim();
    if (logOut.length > 0) {
      recentCommitSubjects = logOut
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .slice(0, 10);
    }
  } catch {
    recentCommitSubjects = [];
  }

  let inferredCommitStyle: CommitStyleName | null = null;
  if (recentCommitSubjects.length > 0) {
    const conventionalCount = recentCommitSubjects.filter((s) =>
      CONVENTIONAL_COMMIT_REGEX.test(s),
    ).length;
    if (conventionalCount / recentCommitSubjects.length >= 0.5) {
      inferredCommitStyle = "conventional";
    }
  }

  return {
    isGitRepo: true,
    currentBranch,
    recentCommitSubjects,
    inferredCommitStyle,
  };
};

const isResolutionValidForConflict = (
  resolution: ConflictResolutionRecord | undefined,
  sources: ConventionConflictSource[],
): boolean => {
  if (!resolution) return false;
  const storedKeys = Object.keys(resolution.sourceHashes);
  if (storedKeys.length !== sources.length) return false;

  for (const src of sources) {
    const normPath = toPosixRelativePath(src.relativePath);
    if (resolution.sourceHashes[normPath] !== src.sha256) {
      return false;
    }
  }
  return true;
};

const detectConflicts = (
  sources: Record<string, CachedSourceRecord>,
  resolutionStore: ConflictResolutionStore,
): ConventionConflict[] => {
  const topics: Array<{
    id: string;
    topic: string;
    description: string;
    extract: (signals: SourceConventionSignals) => string | undefined;
  }> = [
    {
      id: "convention:package_manager",
      topic: "package_manager",
      description: "Conflicting package manager conventions across repository sources.",
      extract: (s) => s.packageManager,
    },
    {
      id: "convention:default_branch",
      topic: "default_branch",
      description: "Conflicting default/base branch conventions across repository sources.",
      extract: (s) => s.defaultBranch,
    },
    {
      id: "convention:commit_style",
      topic: "commit_style",
      description: "Conflicting commit message style conventions across repository sources.",
      extract: (s) => s.commitStyle,
    },
    {
      id: "convention:merge_strategy",
      topic: "merge_strategy",
      description: "Conflicting PR merge strategy conventions across repository sources.",
      extract: (s) => s.mergeStrategy,
    },
  ];

  const conflicts: ConventionConflict[] = [];

  for (const spec of topics) {
    const foundSources: ConventionConflictSource[] = [];
    for (const relPath of Object.keys(sources).sort()) {
      const record = sources[relPath];
      if (!record?.summary) continue;
      const val = spec.extract(record.summary as unknown as SourceConventionSignals);
      if (val) {
        foundSources.push({
          relativePath: record.relativePath,
          sha256: record.sha256,
          value: val,
        });
      }
    }

    const distinctValues = new Set(foundSources.map((s) => s.value));
    if (distinctValues.size > 1) {
      const existingResolution = resolutionStore.resolutions[spec.id];
      const valid = isResolutionValidForConflict(existingResolution, foundSources);
      conflicts.push({
        id: spec.id,
        topic: spec.topic,
        description: spec.description,
        sources: foundSources,
        status: valid ? "resolved" : "unresolved",
        ...(valid && existingResolution ? { resolution: existingResolution } : {}),
      });
    }
  }

  return conflicts;
};

export const analyzeRepository = (
  options: AnalyzeRepositoryOptions = {},
): RepositoryAnalysisResult => {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const dryRun = options.dryRun ?? false;
  const cachePath = getAnalysisCachePath(projectRoot);

  const previousCache = loadAnalysisCache<RepositoryAnalysis>(projectRoot);
  const previousSources = previousCache?.sources ?? {};
  const currentFiles = discoverTargetedSources(projectRoot);
  const diff = diffCacheSources(previousSources, currentFiles);

  const changedOrAddedSet = new Set<string>([
    ...diff.added.map((f) => f.relativePath),
    ...diff.changed.map((f) => f.relativePath),
  ]);

  const updatedSources: Record<string, CachedSourceRecord> = {};

  for (const file of currentFiles) {
    if (changedOrAddedSet.has(file.relativePath)) {
      options.onAnalyzeFile?.(file.relativePath);
      const signals = analyzeSingleSource(projectRoot, file);
      updatedSources[file.relativePath] = {
        relativePath: file.relativePath,
        sha256: file.sha256,
        size: file.size,
        mtimeMs: file.mtimeMs,
        category: file.category,
        summary: signals as unknown as Record<string, unknown>,
      };
    } else {
      const prev = previousSources[file.relativePath];
      if (prev && prev.summary) {
        updatedSources[file.relativePath] = {
          ...prev,
          relativePath: file.relativePath,
          sha256: file.sha256,
          size: file.size,
          mtimeMs: file.mtimeMs,
          category: file.category,
        };
      } else {
        options.onAnalyzeFile?.(file.relativePath);
        const signals = analyzeSingleSource(projectRoot, file);
        updatedSources[file.relativePath] = {
          relativePath: file.relativePath,
          sha256: file.sha256,
          size: file.size,
          mtimeMs: file.mtimeMs,
          category: file.category,
          summary: signals as unknown as Record<string, unknown>,
        };
      }
    }
  }

  const git = sampleGitRepository(projectRoot);
  const resolutionStore = loadConflictResolutions(projectRoot);
  const conflicts = detectConflicts(updatedSources, resolutionStore);

  const scripts: PackageScriptsSummary = {};
  const pmSet = new Set<string>();
  const issueTemplates: string[] = [];
  const prTemplates: string[] = [];
  const workflows: string[] = [];
  const projectConventions: string[] = [];
  let labelsFile: string | null = null;
  let projectConfigPath: string | null = null;

  for (const relPath of Object.keys(updatedSources).sort()) {
    const rec = updatedSources[relPath];
    const sig = rec?.summary as unknown as SourceConventionSignals | undefined;
    if (!sig) continue;

    if (sig.scripts) {
      Object.assign(scripts, sig.scripts);
    }
    if (sig.packageManager) {
      pmSet.add(sig.packageManager);
    }
    if (sig.category === "issue_template") issueTemplates.push(relPath);
    if (sig.category === "pr_template") prTemplates.push(relPath);
    if (sig.category === "workflow") workflows.push(relPath);
    if (sig.category === "labels") labelsFile = relPath;
    if (sig.category === "project_config") projectConfigPath = relPath;
    if (sig.category === "project_convention") projectConventions.push(relPath);
  }

  const now = new Date().toISOString();
  const analysis: RepositoryAnalysis = {
    projectRoot,
    analyzedAt: now,
    discoveredFiles: Object.keys(updatedSources).sort(),
    scripts,
    packageManagers: Array.from(pmSet).sort(),
    templates: {
      issueTemplates,
      prTemplates,
      labelsFile,
    },
    workflows,
    projectConfigPath,
    projectConventions,
    git,
    conflicts,
    cacheDiff: {
      added: diff.added.map((f) => f.relativePath),
      changed: diff.changed.map((f) => f.relativePath),
      unchanged: diff.unchanged.map((f) => f.relativePath),
      deleted: diff.deleted,
    },
  };

  let cacheWritten = false;
  if (!dryRun) {
    saveAnalysisCache(projectRoot, {
      schemaVersion: ANALYSIS_CACHE_SCHEMA_VERSION,
      updatedAt: now,
      sources: updatedSources,
      analysis,
    });
    cacheWritten = true;
  }

  return {
    analysis,
    diff,
    cacheWritten,
    cachePath,
  };
};
