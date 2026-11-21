import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteJson } from "../state/atomic-write.js";
import type { ExecutionState } from "../state/types.js";
import { assertValidExecutionState } from "../state/validate-state.js";
import type {
  ArchivedRunSummary,
  ArchiveMoveResult,
  CleanupArchiveOptions,
  CleanupArchiveResult,
  StateShowResult,
} from "./types.js";

const DEFAULT_RETENTION_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const getActiveStateDir = (projectRoot: string): string =>
  path.join(projectRoot, ".github-convention", "state", "active");

export const getArchiveStateDir = (projectRoot: string): string =>
  path.join(projectRoot, ".github-convention", "state", "archive");

const safeRunFilename = (runId: string): string => `${runId.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`;

const readStateFile = (filePath: string): ExecutionState => {
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  assertValidExecutionState(parsed);
  return parsed;
};

const isPendingDraftOrActive = (state: ExecutionState): boolean => {
  if (state.status !== "completed" && state.status !== "cancelled") {
    return true;
  }
  return state.approvals.some((a) => a.status === "pending" || a.status === "unknown");
};

export const archiveCompletedRun = (
  projectRoot: string,
  runId: string,
  dryRun = false,
  now = new Date().toISOString(),
): ArchiveMoveResult => {
  const filename = safeRunFilename(runId);
  const fromPath = path.join(getActiveStateDir(projectRoot), filename);
  const toPath = path.join(getArchiveStateDir(projectRoot), filename);

  if (!fs.existsSync(fromPath)) {
    throw new Error(`Active state file not found for runId '${runId}'.`);
  }

  const state = readStateFile(fromPath);
  if (isPendingDraftOrActive(state)) {
    throw new Error(
      `Refusing to archive run '${runId}': status is '${state.status}' or pending approvals remain.`,
    );
  }

  if (dryRun) {
    return { runId, dryRun: true, fromPath, toPath, moved: false };
  }

  const archivedState: ExecutionState = {
    ...state,
    status: "archived",
    updatedAt: now,
    metadata: {
      ...(state.metadata ?? {}),
      archivedAt: now,
    },
  };
  atomicWriteJson(toPath, archivedState);
  fs.unlinkSync(fromPath);

  return { runId, dryRun: false, fromPath, toPath, moved: true };
};

export const listArchives = (projectRoot: string): ArchivedRunSummary[] => {
  const archiveDir = getArchiveStateDir(projectRoot);
  if (!fs.existsSync(archiveDir)) return [];

  const summaries: ArchivedRunSummary[] = [];
  for (const entry of fs.readdirSync(archiveDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const filePath = path.join(archiveDir, entry.name);
    try {
      const state = readStateFile(filePath);
      const archivedAt =
        typeof state.metadata?.archivedAt === "string"
          ? state.metadata.archivedAt
          : state.updatedAt;
      summaries.push({
        runId: state.runId,
        status: state.status,
        archivedAt,
        updatedAt: state.updatedAt,
        filePath,
      });
    } catch {
      // Skip malformed archive files during listing.
    }
  }
  return summaries.sort((a, b) => a.runId.localeCompare(b.runId));
};

export const showRunState = (projectRoot: string, runId: string): StateShowResult => {
  const filename = safeRunFilename(runId);
  const activePath = path.join(getActiveStateDir(projectRoot), filename);
  if (fs.existsSync(activePath)) {
    return { runId, location: "active", state: readStateFile(activePath) };
  }

  const archivePath = path.join(getArchiveStateDir(projectRoot), filename);
  if (fs.existsSync(archivePath)) {
    return { runId, location: "archive", state: readStateFile(archivePath) };
  }

  return { runId, location: "missing", state: null };
};

export const restoreArchive = (
  projectRoot: string,
  runId: string,
  dryRun = false,
  now = new Date().toISOString(),
): ArchiveMoveResult => {
  const filename = safeRunFilename(runId);
  const fromPath = path.join(getArchiveStateDir(projectRoot), filename);
  const toPath = path.join(getActiveStateDir(projectRoot), filename);

  if (!fs.existsSync(fromPath)) {
    throw new Error(`Archived state file not found for runId '${runId}'.`);
  }

  if (dryRun) {
    return { runId, dryRun: true, fromPath, toPath, moved: false };
  }

  const state = readStateFile(fromPath);
  const restoredState: ExecutionState = {
    ...state,
    status: "completed",
    updatedAt: now,
  };
  atomicWriteJson(toPath, restoredState);
  fs.unlinkSync(fromPath);

  return { runId, dryRun: false, fromPath, toPath, moved: true };
};

export const cleanupExpiredArchives = (
  projectRoot: string,
  options: CleanupArchiveOptions = {},
): CleanupArchiveResult => {
  const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const dryRun = options.dryRun ?? false;
  const nowMs = (options.now ?? new Date()).getTime();
  const cutoffMs = nowMs - retentionDays * MS_PER_DAY;

  const archives = listArchives(projectRoot);
  const deletedRunIds: string[] = [];
  const retainedRunIds: string[] = [];

  for (const item of archives) {
    const archivedMs = Date.parse(item.archivedAt);
    const expired = Number.isFinite(archivedMs) && archivedMs < cutoffMs;
    if (expired) {
      if (!dryRun && fs.existsSync(item.filePath)) {
        fs.unlinkSync(item.filePath);
      }
      deletedRunIds.push(item.runId);
    } else {
      retainedRunIds.push(item.runId);
    }
  }

  return {
    dryRun,
    retentionDays,
    deletedRunIds,
    retainedRunIds,
  };
};
