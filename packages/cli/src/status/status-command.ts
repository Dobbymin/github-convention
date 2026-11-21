import * as fs from "node:fs";
import * as os from "node:os";
import {
  getActiveStateDir,
  listArchives,
  StateManager,
  type RunStatus,
  type TaskStatus,
} from "@dobbymin/github-convention-core";
import { runList } from "../list/index.js";

export interface ActiveTaskSummary {
  stableId: string;
  title: string;
  status: TaskStatus;
  issueNumber: number | null;
  prNumber: number | null;
  prUrl: string | null;
}

export interface ActiveRunSummary {
  runId: string;
  status: RunStatus;
  repository: string;
  defaultBranch: string;
  updatedAt: string;
  taskCount: number;
  completedTaskCount: number;
  issueCount: number;
  pendingApprovals: number;
  tasks: ActiveTaskSummary[];
}

export interface StatusAgentSummary {
  installedCount: number;
  detected: Array<{
    agentId: string;
    name: string;
    confidence: string;
    projectInstalled: boolean;
    globalInstalled: boolean;
  }>;
}

export interface StatusCommandOptions {
  projectRoot?: string;
  homeDir?: string;
}

export interface StatusCommandResult {
  state: RunStatus | "idle";
  project: string;
  activeRuns: ActiveRunSummary[];
  activeCount: number;
  archivedCount: number;
  latestRun: ActiveRunSummary | null;
  agents: StatusAgentSummary;
  warnings: string[];
}

export const runStatus = (options: StatusCommandOptions = {}): StatusCommandResult => {
  const projectRoot = options.projectRoot ?? process.cwd();
  const homeDir = options.homeDir ?? os.homedir();
  const activeDir = getActiveStateDir(projectRoot);
  const warnings: string[] = [];
  const activeRuns: ActiveRunSummary[] = [];

  if (fs.existsSync(activeDir)) {
    const entries = fs
      .readdirSync(activeDir)
      .filter(
        (name) =>
          name.endsWith(".json") &&
          !name.endsWith(".lock.json") &&
          name !== "plan.json" &&
          !name.startsWith("approvals-"),
      );
    const manager = new StateManager({ stateDir: activeDir, role: "worker" });

    for (const filename of entries) {
      const runId = filename.slice(0, -5);
      try {
        const loaded = manager.load(runId);
        const repoLabel = loaded.repository.owner
          ? `${loaded.repository.owner}/${loaded.repository.name}`
          : loaded.repository.name;
        const tasks: ActiveTaskSummary[] = loaded.tasks.map((task) => {
          const prObj =
            typeof task.pr === "object" && task.pr !== null
              ? (task.pr as Record<string, unknown>)
              : undefined;
          const prNumber =
            typeof prObj?.number === "number"
              ? prObj.number
              : typeof task.prNumber === "number"
                ? task.prNumber
                : null;
          const prUrl =
            typeof prObj?.url === "string"
              ? prObj.url
              : typeof task.prUrl === "string"
                ? task.prUrl
                : null;
          return {
            stableId: task.stableId,
            title: task.title,
            status: task.status,
            issueNumber: typeof task.issueNumber === "number" ? task.issueNumber : null,
            prNumber,
            prUrl,
          };
        });

        activeRuns.push({
          runId: loaded.runId,
          status: loaded.status,
          repository: repoLabel,
          defaultBranch: loaded.repository.defaultBranch,
          updatedAt: loaded.updatedAt,
          taskCount: loaded.tasks.length,
          completedTaskCount: loaded.tasks.filter((t) => t.status === "completed").length,
          issueCount: tasks.filter((t) => t.issueNumber !== null).length,
          pendingApprovals: loaded.approvals.filter((a) => a.status === "pending").length,
          tasks,
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

  const listResult = runList({ projectRoot, homeDir });
  const agents: StatusAgentSummary = {
    installedCount: listResult.installedCount,
    detected: listResult.agents
      .filter(
        (a) =>
          a.confidence === "confirmed" ||
          a.confidence === "probable" ||
          a.project.installed ||
          a.global.installed,
      )
      .map((a) => ({
        agentId: a.agentId,
        name: a.name,
        confidence: a.confidence,
        projectInstalled: a.project.installed,
        globalInstalled: a.global.installed,
      })),
  };

  const latestRun = activeRuns[0] ?? null;

  return {
    state: latestRun?.status ?? "idle",
    project: projectRoot,
    activeRuns,
    activeCount: activeRuns.length,
    archivedCount,
    latestRun,
    agents,
    warnings,
  };
};
