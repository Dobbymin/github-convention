export type FailureCategory =
  | "transient"
  | "test_failure"
  | "auth"
  | "permission"
  | "environment_broken"
  | "destructive_uncertainty"
  | "missing_prerequisite";

export type WorkerErrorRecord = Readonly<{
  attempt: number;
  category: FailureCategory;
  signature: string;
  message: string;
}>;

export type RetryDecision = Readonly<{
  action: "retry" | "escalate_followup";
  attemptNumber: number;
  retriesRemaining: number;
  reason: string;
}>;

export type OrchestratedTaskNode = Readonly<{
  id: string;
  hardDependencies: readonly string[];
  status: "pending" | "ready" | "completed" | "failed" | "blocked";
}>;

export type FailurePropagationResult = Readonly<{
  failedTaskId: string;
  blockedTaskIds: readonly string[];
  schedulableTaskIds: readonly string[];
}>;

export type InterruptedWorkspaceState = Readonly<{
  taskId: string;
  workspacePath: string;
  changedFiles: readonly string[];
  partialReport?: string;
  logPaths: readonly string[];
}>;

export type PreservedInterruptedWorkspace = Readonly<{
  taskId: string;
  workspacePath: string;
  preservedFiles: readonly string[];
  logPaths: readonly string[];
  requiresReview: boolean;
  reason: string;
}>;
