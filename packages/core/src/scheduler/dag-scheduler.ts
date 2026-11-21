import type {
  ConcurrencyInputs,
  ExecutionMode,
  ExecutionModeInputs,
  SchedulableTask,
  ScheduleWaveResult,
} from "./types.js";

const normalizePathPattern = (value: string): string => value.replaceAll("\\", "/").trim();

const hasFileOverlap = (a: readonly string[], b: readonly string[]): boolean => {
  const setA = new Set(a.map(normalizePathPattern));
  for (const item of b) {
    if (setA.has(normalizePathPattern(item))) return true;
  }
  return false;
};

export const computeEffectiveConcurrency = (inputs: ConcurrencyInputs): number => {
  const raw = Math.min(
    inputs.userOrProjectCap,
    inputs.agentRuntimeCapacity,
    inputs.safeConflictCapacity,
    inputs.resourceBudgetCapacity,
  );
  if (!Number.isFinite(raw) || raw < 1) return 1;
  return Math.floor(raw);
};

export const scheduleReadyTasks = (
  tasks: readonly SchedulableTask[],
  completedIds: ReadonlySet<string>,
  failedIds: ReadonlySet<string>,
  maxParallel = Number.POSITIVE_INFINITY,
): ScheduleWaveResult => {
  const blocked = new Set<string>(failedIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of tasks) {
      if (blocked.has(task.id) || completedIds.has(task.id)) continue;
      if (task.hardDependencies.some((depId) => blocked.has(depId))) {
        blocked.add(task.id);
        changed = true;
      }
    }
  }

  const readyTaskIds: string[] = [];
  const deferredConflictTaskIds: string[] = [];
  const selectedTasks: SchedulableTask[] = [];

  for (const task of tasks) {
    if (completedIds.has(task.id) || blocked.has(task.id)) continue;
    const depsDone = task.hardDependencies.every((depId) => completedIds.has(depId));
    if (!depsDone) continue;

    if (readyTaskIds.length >= maxParallel) {
      deferredConflictTaskIds.push(task.id);
      continue;
    }

    const overlapsSelected = selectedTasks.some((chosen) =>
      hasFileOverlap(chosen.allowedFiles, task.allowedFiles),
    );
    if (overlapsSelected) {
      deferredConflictTaskIds.push(task.id);
      continue;
    }

    readyTaskIds.push(task.id);
    selectedTasks.push(task);
  }

  return {
    readyTaskIds,
    deferredConflictTaskIds,
    blockedTaskIds: [...blocked].filter((id) => !failedIds.has(id)),
  };
};

export const selectExecutionMode = (
  tasks: readonly SchedulableTask[],
  inputs: ExecutionModeInputs,
): ExecutionMode => {
  if (tasks.length <= 1 || !inputs.subAgentsEnabled || !inputs.supportsDelegation) {
    return tasks.length <= 1 ? "main_only" : "sequential";
  }

  if (inputs.maxParallel <= 1) {
    return "sequential";
  }

  const wave = scheduleReadyTasks(tasks, new Set(), new Set(), inputs.maxParallel);
  const hasDeps = tasks.some((t) => t.hardDependencies.length > 0);

  if (wave.readyTaskIds.length <= 1) {
    return "sequential";
  }

  if (!hasDeps && wave.readyTaskIds.length === tasks.length) {
    return "parallel";
  }

  return "mixed";
};
