import type {
  FailureCategory,
  FailurePropagationResult,
  InterruptedWorkspaceState,
  OrchestratedTaskNode,
  PreservedInterruptedWorkspace,
  RetryDecision,
  WorkerErrorRecord,
} from "./types.js";

const NON_RETRYABLE_CATEGORIES = new Set<FailureCategory>([
  "auth",
  "permission",
  "environment_broken",
  "destructive_uncertainty",
  "missing_prerequisite",
]);

export const evaluateRetryDecision = (
  history: readonly WorkerErrorRecord[],
  nextError: Omit<WorkerErrorRecord, "attempt">,
  maxRetries = 2,
): RetryDecision => {
  const attemptNumber = history.length + 1;
  const maxAttempts = 1 + Math.max(0, maxRetries);

  if (NON_RETRYABLE_CATEGORIES.has(nextError.category)) {
    return {
      action: "escalate_followup",
      attemptNumber,
      retriesRemaining: 0,
      reason: `Non-retryable failure category '${nextError.category}'; stopping immediately.`,
    };
  }

  const lastError = history[history.length - 1];
  if (lastError && lastError.signature === nextError.signature) {
    return {
      action: "escalate_followup",
      attemptNumber,
      retriesRemaining: 0,
      reason: `Repeated identical error signature '${nextError.signature}'; stopping early.`,
    };
  }

  if (attemptNumber >= maxAttempts) {
    return {
      action: "escalate_followup",
      attemptNumber,
      retriesRemaining: 0,
      reason: `Retry budget exhausted (${attemptNumber}/${maxAttempts} attempts).`,
    };
  }

  return {
    action: "retry",
    attemptNumber,
    retriesRemaining: maxAttempts - attemptNumber,
    reason: "Bounded retry permitted.",
  };
};

export const propagateTaskFailure = (
  tasks: readonly OrchestratedTaskNode[],
  failedTaskId: string,
): FailurePropagationResult => {
  const blocked = new Set<string>([failedTaskId]);
  let changed = true;

  while (changed) {
    changed = false;
    for (const task of tasks) {
      if (blocked.has(task.id) || task.status === "completed") continue;
      if (task.hardDependencies.some((depId) => blocked.has(depId))) {
        blocked.add(task.id);
        changed = true;
      }
    }
  }

  const blockedTaskIds = [...blocked].filter((id) => id !== failedTaskId);
  const schedulableTaskIds = tasks
    .filter(
      (task) => !blocked.has(task.id) && task.status !== "completed" && task.status !== "failed",
    )
    .map((task) => task.id);

  return {
    failedTaskId,
    blockedTaskIds,
    schedulableTaskIds,
  };
};

export const preserveInterruptedWorkspace = (
  state: InterruptedWorkspaceState,
): PreservedInterruptedWorkspace => {
  const hasChanges = state.changedFiles.length > 0;
  return {
    taskId: state.taskId,
    workspacePath: state.workspacePath,
    preservedFiles: state.changedFiles,
    logPaths: state.logPaths,
    requiresReview: hasChanges,
    reason: hasChanges
      ? "Interrupted workspace preserved with partial changes; manual review required before reuse or cleanup."
      : "Interrupted workspace preserved cleanly with no partial file edits.",
  };
};
