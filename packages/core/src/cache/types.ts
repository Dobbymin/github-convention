export const ANALYSIS_CACHE_SCHEMA_VERSION = 1 as const;

export interface CachedSourceRecord {
  relativePath: string;
  sha256: string;
  size: number;
  mtimeMs?: number;
  category?: string;
  summary?: Record<string, unknown>;
}

export interface AnalysisCache<TAnalysis = Record<string, unknown>> {
  schemaVersion: typeof ANALYSIS_CACHE_SCHEMA_VERSION;
  updatedAt: string;
  sources: Record<string, CachedSourceRecord>;
  analysis: TAnalysis;
}

export interface CurrentSourceFile {
  relativePath: string;
  sha256: string;
  size: number;
  mtimeMs?: number;
  category?: string;
}

export interface CacheSourceDiff {
  added: CurrentSourceFile[];
  changed: CurrentSourceFile[];
  unchanged: CurrentSourceFile[];
  deleted: string[];
}
