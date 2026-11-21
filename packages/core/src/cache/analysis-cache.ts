import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteJson } from "../state/atomic-write.js";
import {
  ANALYSIS_CACHE_SCHEMA_VERSION,
  type AnalysisCache,
  type CacheSourceDiff,
  type CachedSourceRecord,
  type CurrentSourceFile,
} from "./types.js";

export const toPosixRelativePath = (relativePath: string): string => {
  return relativePath.split(path.sep).join("/").replace(/\\/g, "/");
};

export const getAnalysisCachePath = (projectRoot: string): string => {
  return path.join(path.resolve(projectRoot), ".github-convention", "cache", "analysis.json");
};

export const loadAnalysisCache = <TAnalysis = Record<string, unknown>>(
  projectRoot: string,
): AnalysisCache<TAnalysis> | null => {
  const cachePath = getAnalysisCachePath(projectRoot);
  if (!fs.existsSync(cachePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(cachePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<AnalysisCache<TAnalysis>>;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      parsed.schemaVersion !== ANALYSIS_CACHE_SCHEMA_VERSION ||
      typeof parsed.sources !== "object" ||
      parsed.sources === null ||
      Array.isArray(parsed.sources) ||
      typeof parsed.analysis !== "object" ||
      parsed.analysis === null
    ) {
      return null;
    }

    const normalizedSources: Record<string, CachedSourceRecord> = {};
    for (const [key, record] of Object.entries(parsed.sources)) {
      if (!record || typeof record !== "object") continue;
      const normKey = toPosixRelativePath(record.relativePath || key);
      normalizedSources[normKey] = {
        ...record,
        relativePath: normKey,
      };
    }

    return {
      schemaVersion: ANALYSIS_CACHE_SCHEMA_VERSION,
      updatedAt:
        typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
      sources: normalizedSources,
      analysis: parsed.analysis,
    };
  } catch {
    return null;
  }
};

export const saveAnalysisCache = <TAnalysis = Record<string, unknown>>(
  projectRoot: string,
  cache: AnalysisCache<TAnalysis>,
): string => {
  const cachePath = getAnalysisCachePath(projectRoot);
  const normalizedSources: Record<string, CachedSourceRecord> = {};

  for (const key of Object.keys(cache.sources).sort()) {
    const record = cache.sources[key];
    if (!record) continue;
    const normKey = toPosixRelativePath(record.relativePath || key);
    normalizedSources[normKey] = {
      ...record,
      relativePath: normKey,
    };
  }

  const payload: AnalysisCache<TAnalysis> = {
    schemaVersion: ANALYSIS_CACHE_SCHEMA_VERSION,
    updatedAt: cache.updatedAt || new Date().toISOString(),
    sources: normalizedSources,
    analysis: cache.analysis,
  };

  atomicWriteJson(cachePath, payload);
  return cachePath;
};

export const diffCacheSources = (
  previousSources: Record<string, CachedSourceRecord>,
  currentFiles: CurrentSourceFile[],
): CacheSourceDiff => {
  const prevByPath = new Map<string, CachedSourceRecord>();
  for (const [key, record] of Object.entries(previousSources)) {
    const normKey = toPosixRelativePath(record?.relativePath || key);
    prevByPath.set(normKey, record);
  }

  const added: CurrentSourceFile[] = [];
  const changed: CurrentSourceFile[] = [];
  const unchanged: CurrentSourceFile[] = [];
  const seenPaths = new Set<string>();

  const sortedCurrent = [...currentFiles]
    .map((file) => ({
      ...file,
      relativePath: toPosixRelativePath(file.relativePath),
    }))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  for (const file of sortedCurrent) {
    seenPaths.add(file.relativePath);
    const prev = prevByPath.get(file.relativePath);
    if (!prev) {
      added.push(file);
    } else if (prev.sha256 !== file.sha256) {
      changed.push(file);
    } else {
      unchanged.push(file);
    }
  }

  const deleted: string[] = [];
  for (const prevPath of prevByPath.keys()) {
    if (!seenPaths.has(prevPath)) {
      deleted.push(prevPath);
    }
  }
  deleted.sort();

  return {
    added,
    changed,
    unchanged,
    deleted,
  };
};
