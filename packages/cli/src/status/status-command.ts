import * as fs from "node:fs";
import {
  getActiveStateDir,
  listArchives,
  StateManager,
  type RunStatus,
} from "@github-convention/core";

export interface ActiveRunSummary {
  runId: string;
  status: RunStatus;
  repository: string;
  defaultBranch: string;
  updatedAt: string;
  taskCount: number;
  pendingApprovals: number;
}

export interface StatusCommandOptions {
  projectRoot?: string;
}

export interface StatusCommandResult {
  state: RunStatus | "idle";
  project: string;
  activeRuns: ActiveRunSummary[];
  activeCount: number;
  archivedCount: number;
  latestRun: ActiveRunSummary | null;
  warnings: string[];
}

export const runStatus = (options: StatusCommandOptions = {}): StatusCommandResult => {
  const projectRoot = options.projectRoot ?? process.cwd();
  const activeDir = getActiveStateDir(projectRoot);
  const warnings: string[] = [];
  const activeRuns: ActiveRunSummary[] = [];

  if (fs.existsSync(activeDir)) {
    const entries = fs
      .readdirSync(activeDir)
      .filter((name) => name.endsWith(".json") && !name.endsWith(".lock.json"));
    const manager = new StateManager({ stateDir: activeDir, role: "worker" });

    for (const filename of entries) {
      const runId = filename.slice(0, -5);
      try {
        const loaded = manager.load(runId);
        const repoLabel = loaded.repository.owner
          ? `${loaded.repository.owner}/${loaded.repository.name}`
          : loaded.repository.name;
        activeRuns.push({
          runId: loaded.runId,
          status: loaded.status,
          repository: repoLabel,
          defaultBranch: loaded.repository.defaultBranch,
          updatedAt: loaded.updatedAt,
          taskCount: loaded.tasks.length,
          pendingApprovals: loaded.approvals.filter((a) => a.status === "pending").length,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        warnings.push(`Failed to load active state '${filename}': ${message}`);
      }
    }
  }

  activeRuns.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  let archivedCount = 0;
  try {
    archivedCount = listArchives(projectRoot).length;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warnings.push(`Failed to list archived states: ${message}`);
  }

  const latestRun = activeRuns[0] ?? null;

  return {
    state: latestRun?.status ?? "idle",
    project: projectRoot,
    activeRuns,
    activeCount: activeRuns.length,
    archivedCount,
    latestRun,
    warnings,
  };
};
