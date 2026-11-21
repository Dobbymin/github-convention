import type { ExecutionState } from "./types.js";

const VALID_RUN_STATUSES = new Set([
  "planned",
  "awaiting_approval",
  "approved",
  "in_progress",
  "blocked",
  "failed",
  "completed",
  "archived",
  "cancelled",
]);

const VALID_TASK_STATUSES = new Set([
  "draft",
  "awaiting_approval",
  "approved",
  "ready",
  "blocked",
  "assigned",
  "in_progress",
  "review",
  "failed",
  "completed",
  "cancelled",
]);

const VALID_APPROVAL_STATUSES = new Set(["pending", "approved", "rejected", "expired", "unknown"]);

export interface StateValidationResult {
  valid: boolean;
  errors: string[];
}

export const validateExecutionState = (state: unknown): StateValidationResult => {
  const errors: string[] = [];

  if (typeof state !== "object" || state === null || Array.isArray(state)) {
    return { valid: false, errors: ["Execution state must be a non-null object."] };
  }

  const raw = state as Record<string, unknown>;

  // schemaVersion
  if (
    typeof raw.schemaVersion !== "number" ||
    !Number.isInteger(raw.schemaVersion) ||
    raw.schemaVersion < 1
  ) {
    errors.push("'schemaVersion' must be an integer greater than or equal to 1.");
  }

  // runId
  if (typeof raw.runId !== "string" || raw.runId.trim().length === 0) {
    errors.push("'runId' must be a non-empty string.");
  }

  // status
  if (typeof raw.status !== "string" || !VALID_RUN_STATUSES.has(raw.status)) {
    errors.push(`'status' must be one of: ${Array.from(VALID_RUN_STATUSES).join(", ")}.`);
  }

  // createdAt & updatedAt
  if (typeof raw.createdAt !== "string" || isNaN(Date.parse(raw.createdAt))) {
    errors.push("'createdAt' must be a valid ISO date-time string.");
  }
  if (typeof raw.updatedAt !== "string" || isNaN(Date.parse(raw.updatedAt))) {
    errors.push("'updatedAt' must be a valid ISO date-time string.");
  }

  // repository
  if (
    typeof raw.repository !== "object" ||
    raw.repository === null ||
    Array.isArray(raw.repository)
  ) {
    errors.push("'repository' must be an object with root, name, and defaultBranch.");
  } else {
    const repo = raw.repository as Record<string, unknown>;
    if (typeof repo.root !== "string") errors.push("'repository.root' must be a string.");
    if (typeof repo.name !== "string") errors.push("'repository.name' must be a string.");
    if (typeof repo.defaultBranch !== "string")
      errors.push("'repository.defaultBranch' must be a string.");
  }

  // approvals
  if (!Array.isArray(raw.approvals)) {
    errors.push("'approvals' must be an array.");
  } else {
    for (let i = 0; i < raw.approvals.length; i++) {
      const app = raw.approvals[i];
      if (typeof app !== "object" || app === null || Array.isArray(app)) {
        errors.push(`'approvals[${i}]' must be an object.`);
      } else {
        const appObj = app as Record<string, unknown>;
        if (typeof appObj.approvalId !== "string") {
          errors.push(`'approvals[${i}].approvalId' must be a string.`);
        }
        if (typeof appObj.action !== "string") {
          errors.push(`'approvals[${i}].action' must be a string.`);
        }
        if (typeof appObj.status !== "string" || !VALID_APPROVAL_STATUSES.has(appObj.status)) {
          errors.push(`'approvals[${i}].status' has invalid value.`);
        }
      }
    }
  }

  // tasks
  if (!Array.isArray(raw.tasks)) {
    errors.push("'tasks' must be an array.");
  } else {
    for (let i = 0; i < raw.tasks.length; i++) {
      const t = raw.tasks[i];
      if (typeof t !== "object" || t === null || Array.isArray(t)) {
        errors.push(`'tasks[${i}]' must be an object.`);
      } else {
        const tObj = t as Record<string, unknown>;
        if (typeof tObj.stableId !== "string") {
          errors.push(`'tasks[${i}].stableId' must be a string.`);
        }
        if (typeof tObj.title !== "string") {
          errors.push(`'tasks[${i}].title' must be a string.`);
        }
        if (typeof tObj.status !== "string" || !VALID_TASK_STATUSES.has(tObj.status)) {
          errors.push(`'tasks[${i}].status' has invalid value.`);
        }
        if (!Array.isArray(tObj.dependsOn)) {
          errors.push(`'tasks[${i}].dependsOn' must be an array of task IDs.`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

export function assertValidExecutionState(state: unknown): asserts state is ExecutionState {
  const result = validateExecutionState(state);
  if (!result.valid) {
    throw new Error(`Invalid execution state:\n${result.errors.map((e) => ` - ${e}`).join("\n")}`);
  }
}
