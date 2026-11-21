import {
  cleanupExpiredArchives,
  listArchives,
  restoreArchive,
  showRunState,
  type ArchivedRunSummary,
  type ArchiveMoveResult,
  type CleanupArchiveResult,
  type StateShowResult,
} from "@github-convention/core";

export type StateCommandOptions = Readonly<{
  projectRoot?: string;
  runId?: string;
  dryRun?: boolean;
  retentionDays?: number;
}>;

export const runStateList = (options: StateCommandOptions = {}): ArchivedRunSummary[] =>
  listArchives(options.projectRoot ?? process.cwd());

export const runStateShow = (options: StateCommandOptions = {}): StateShowResult | null => {
  if (!options.runId) return null;
  return showRunState(options.projectRoot ?? process.cwd(), options.runId);
};

export const runStateRestore = (options: StateCommandOptions = {}): ArchiveMoveResult | null => {
  if (!options.runId) return null;
  return restoreArchive(options.projectRoot ?? process.cwd(), options.runId, options.dryRun);
};

export const runCleanupArchives = (options: StateCommandOptions = {}): CleanupArchiveResult =>
  cleanupExpiredArchives(options.projectRoot ?? process.cwd(), {
    ...(options.retentionDays !== undefined ? { retentionDays: options.retentionDays } : {}),
    dryRun: options.dryRun ?? false,
  });
