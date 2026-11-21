import * as fs from "node:fs";
import * as path from "node:path";
import {
  cleanupExpiredArchives,
  getActiveStateDir,
  inspectWorktree,
  listArchives,
  removeOwnedWorktree,
  restoreArchive,
  showRunState,
  StateManager,
  type ArchivedRunSummary,
  type ArchiveMoveResult,
  type CleanupArchiveResult,
  type StateShowResult,
} from "@dobbymin/github-convention-core";

export type StateCommandOptions = Readonly<{
  projectRoot?: string;
  runId?: string;
  dryRun?: boolean;
  retentionDays?: number;
}>;

export type CleanupCommandResult = CleanupArchiveResult & {
  removedWorktrees: string[];
  preservedWorktrees: Array<{ path: string; reason: string }>;
  removedTempDirs: string[];
};

const collectCandidateWorktrees = (projectRoot: string): string[] => {
  const seen = new Set<string>();
  const candidates: string[] = [];

  const add = (wtPath: string): void => {
    const resolved = path.resolve(wtPath);
    if (!seen.has(resolved)) {
      seen.add(resolved);
      candidates.push(resolved);
    }
  };

  const worktreesDir = path.join(projectRoot, ".github-convention", "worktrees");
  if (fs.existsSync(worktreesDir)) {
    for (const entry of fs.readdirSync(worktreesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        add(path.join(worktreesDir, entry.name));
      }
    }
  }

  const activeDir = getActiveStateDir(projectRoot);
  if (fs.existsSync(activeDir)) {
    const manager = new StateManager({ stateDir: activeDir, role: "worker" });
    for (const filename of fs.readdirSync(activeDir)) {
      if (
        !filename.endsWith(".json") ||
        filename.endsWith(".lock.json") ||
        filename === "plan.json" ||
        filename.startsWith("approvals-")
      ) {
        continue;
      }
      try {
        const state = manager.load(filename.slice(0, -5));
        for (const task of state.tasks) {
          const wt =
            (task.workspace?.worktreePath as string | undefined) ??
            (task.worktreePath as string | undefined);
          if (typeof wt === "string" && wt.trim()) {
            add(wt);
          }
        }
      } catch {
        // Ignore corrupted state files during cleanup discovery
      }
    }
  }

  return candidates;
};

const collectTempStagingDirs = (projectRoot: string): string[] => {
  const dirs: string[] = [];

  const skillsDir = path.join(projectRoot, ".agents", "skills");
  if (fs.existsSync(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith(".github-convention-update-")) {
        dirs.push(path.join(skillsDir, entry.name));
      }
    }
  }

  const tmpDir = path.join(projectRoot, ".github-convention", "tmp");
  if (fs.existsSync(tmpDir)) {
    for (const entry of fs.readdirSync(tmpDir, { withFileTypes: true })) {
      dirs.push(path.join(tmpDir, entry.name));
    }
  }

  return dirs;
};

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

export const runCleanupArchives = (options: StateCommandOptions = {}): CleanupCommandResult => {
  const projectRoot = options.projectRoot ?? process.cwd();
  const dryRun = options.dryRun ?? false;

  const archiveResult = cleanupExpiredArchives(projectRoot, {
    ...(options.retentionDays !== undefined ? { retentionDays: options.retentionDays } : {}),
    dryRun,
  });

  const removedWorktrees: string[] = [];
  const preservedWorktrees: Array<{ path: string; reason: string }> = [];

  for (const wtPath of collectCandidateWorktrees(projectRoot)) {
    if (dryRun) {
      try {
        const inspection = inspectWorktree(wtPath);
        if (!inspection.exists) continue;
        if (inspection.ownedByNode && !inspection.dirty) {
          removedWorktrees.push(wtPath);
        } else {
          preservedWorktrees.push({
            path: wtPath,
            reason: !inspection.ownedByNode
              ? "Worktree lacks orchestrator ownership manifest."
              : "Worktree has uncommitted changes.",
          });
        }
      } catch (err) {
        preservedWorktrees.push({
          path: wtPath,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      try {
        const res = removeOwnedWorktree(projectRoot, wtPath, false);
        if (res.removed) {
          removedWorktrees.push(wtPath);
        } else if (fs.existsSync(wtPath)) {
          preservedWorktrees.push({ path: wtPath, reason: res.reason });
        }
      } catch (err) {
        if (fs.existsSync(wtPath)) {
          preservedWorktrees.push({
            path: wtPath,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  const removedTempDirs: string[] = [];
  for (const tempPath of collectTempStagingDirs(projectRoot)) {
    if (!dryRun) {
      fs.rmSync(tempPath, { recursive: true, force: true });
    }
    removedTempDirs.push(tempPath);
  }

  return {
    ...archiveResult,
    removedWorktrees,
    preservedWorktrees,
    removedTempDirs,
  };
};
