export type ExecutionMode = "main_only" | "sequential" | "parallel" | "mixed";

export type SchedulableTask = Readonly<{
  id: string;
  hardDependencies: readonly string[];
  allowedFiles: readonly string[];
}>;

export type ConcurrencyInputs = Readonly<{
  userOrProjectCap: number;
  agentRuntimeCapacity: number;
  safeConflictCapacity: number;
  resourceBudgetCapacity: number;
}>;

export type ExecutionModeInputs = Readonly<{
  subAgentsEnabled: boolean;
  supportsDelegation: boolean;
  maxParallel: number;
}>;

export type ScheduleWaveResult = Readonly<{
  readyTaskIds: readonly string[];
  deferredConflictTaskIds: readonly string[];
  blockedTaskIds: readonly string[];
}>;
