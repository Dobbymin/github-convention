import type { ExecutionState } from "../state/types.js";

export type ArchivedRunSummary = Readonly<{
  runId: string;
  status: string;
  archivedAt: string;
  updatedAt: string;
  filePath: string;
}>;

export type ArchiveMoveResult = Readonly<{
  runId: string;
  dryRun: boolean;
  fromPath: string;
  toPath: string;
  moved: boolean;
}>;

export type CleanupArchiveOptions = Readonly<{
  retentionDays?: number;
  dryRun?: boolean;
  now?: Date;
}>;

export type CleanupArchiveResult = Readonly<{
  dryRun: boolean;
  retentionDays: number;
  deletedRunIds: readonly string[];
  retainedRunIds: readonly string[];
}>;

export type StateShowResult = Readonly<{
  runId: string;
  location: "active" | "archive" | "missing";
  state: ExecutionState | null;
}>;
