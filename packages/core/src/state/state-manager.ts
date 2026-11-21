import * as fs from "node:fs";
import * as path from "node:path";
import { FileLock } from "../lock/file-lock.js";
import { atomicWriteJson } from "./atomic-write.js";
import type { ExecutionState } from "./types.js";
import { assertValidExecutionState } from "./validate-state.js";

export type AgentRole = "orchestrator" | "worker";

export interface StateManagerOptions {
  stateDir: string;
  role: AgentRole;
  staleLockTimeoutMs?: number;
}

export interface RemoteTaskUpdate {
  stableId: string;
  issueNumber?: number;
  issueStatus?: "open" | "closed";
  prStatus?: "open" | "merged" | "closed";
}

export class StateManager {
  readonly stateDir: string;
  readonly role: AgentRole;
  private readonly staleLockTimeoutMs?: number;

  constructor(options: StateManagerOptions) {
    this.stateDir = options.stateDir;
    this.role = options.role;
    this.staleLockTimeoutMs = options.staleLockTimeoutMs;
  }

  private getStatePath(runId: string): string {
    return path.join(this.stateDir, `${runId}.json`);
  }

  private assertOrchestrator(actionDescription: string): void {
    if (this.role !== "orchestrator") {
      throw new Error(
        `Permission denied: Only the Orchestrator may write or mutate shared run State (${actionDescription}). Worker writes are rejected by workflow contract.`,
      );
    }
  }

  load(runId: string): ExecutionState {
    const filePath = this.getStatePath(runId);
    if (!fs.existsSync(filePath)) {
      throw new Error(`State file for runId '${runId}' not found at: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, "utf-8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      throw new Error(`Corrupted state file at '${filePath}': ${String(err)}`);
    }

    assertValidExecutionState(parsed);
    return parsed;
  }

  save(state: ExecutionState): void {
    this.assertOrchestrator("save");
    assertValidExecutionState(state);

    const filePath = this.getStatePath(state.runId);
    const lock = new FileLock(filePath);

    lock.acquire({ staleTimeoutMs: this.staleLockTimeoutMs });
    try {
      state.updatedAt = new Date().toISOString();
      atomicWriteJson(filePath, state);
    } finally {
      lock.release();
    }
  }

  async transition(
    runId: string,
    updater: (current: ExecutionState) => ExecutionState | void,
  ): Promise<ExecutionState> {
    this.assertOrchestrator("transition");

    const filePath = this.getStatePath(runId);
    const lock = new FileLock(filePath);

    return lock.withLock(
      async () => {
        const current = this.load(runId);
        const updated = updater(current) ?? current;
        updated.updatedAt = new Date().toISOString();
        assertValidExecutionState(updated);
        atomicWriteJson(filePath, updated);
        return updated;
      },
      { staleTimeoutMs: this.staleLockTimeoutMs },
    );
  }

  /**
   * FR-STATE-04: Reconcile local State with authoritative remote GitHub status
   * before taking dependent actions.
   */
  async reconcileWithRemote(
    runId: string,
    remoteUpdates: {
      parentIssueStatus?: "open" | "closed";
      tasks?: RemoteTaskUpdate[];
    },
  ): Promise<ExecutionState> {
    return this.transition(runId, (state) => {
      if (remoteUpdates.parentIssueStatus && state.parentIssue) {
        state.parentIssue.status = remoteUpdates.parentIssueStatus;
      }

      if (remoteUpdates.tasks) {
        for (const remoteTask of remoteUpdates.tasks) {
          const task = state.tasks.find((t) => t.stableId === remoteTask.stableId);
          if (task) {
            if (remoteTask.issueNumber !== undefined) {
              task.issueNumber = remoteTask.issueNumber;
            }
            if (remoteTask.issueStatus === "closed" || remoteTask.prStatus === "merged") {
              task.status = "completed";
            }
          }
        }
      }

      state.remoteSync = {
        lastSyncedAt: new Date().toISOString(),
        authoritativeSource: "github",
      };

      // Deriving overall status
      const allCompleted =
        state.tasks.length > 0 && state.tasks.every((t) => t.status === "completed");
      if (allCompleted) {
        state.status = "completed";
      }
    });
  }
}
