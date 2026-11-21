import assert from "node:assert/strict";
import test from "node:test";
import {
  computeEffectiveConcurrency,
  scheduleReadyTasks,
  selectExecutionMode,
  type SchedulableTask,
} from "./index.js";

test("computeEffectiveConcurrency: takes minimum across all limits with floor 1", () => {
  assert.equal(
    computeEffectiveConcurrency({
      userOrProjectCap: 5,
      agentRuntimeCapacity: 4,
      safeConflictCapacity: 2,
      resourceBudgetCapacity: 3,
    }),
    2,
  );
  assert.equal(
    computeEffectiveConcurrency({
      userOrProjectCap: 0,
      agentRuntimeCapacity: 4,
      safeConflictCapacity: 2,
      resourceBudgetCapacity: 3,
    }),
    1,
  );
});

test("scheduleReadyTasks: blocks failed dependents, continues independent tasks, and defers file overlaps", () => {
  const tasks: SchedulableTask[] = [
    { id: "A", hardDependencies: [], allowedFiles: ["src/a.ts"] },
    { id: "B", hardDependencies: ["A"], allowedFiles: ["src/b.ts"] },
    { id: "C", hardDependencies: [], allowedFiles: ["src/c.ts"] },
    { id: "D", hardDependencies: [], allowedFiles: ["src/c.ts"] },
  ];

  const wave = scheduleReadyTasks(tasks, new Set(), new Set(["A"]), 4);
  assert.deepEqual(wave.readyTaskIds, ["C"]);
  assert.deepEqual(wave.deferredConflictTaskIds, ["D"]);
  assert.deepEqual(wave.blockedTaskIds, ["B"]);
});

test("selectExecutionMode: picks simplest safe mode", () => {
  const single: SchedulableTask[] = [{ id: "A", hardDependencies: [], allowedFiles: ["a.ts"] }];
  assert.equal(
    selectExecutionMode(single, {
      subAgentsEnabled: true,
      supportsDelegation: true,
      maxParallel: 3,
    }),
    "main_only",
  );

  const independent: SchedulableTask[] = [
    { id: "A", hardDependencies: [], allowedFiles: ["a.ts"] },
    { id: "B", hardDependencies: [], allowedFiles: ["b.ts"] },
  ];
  assert.equal(
    selectExecutionMode(independent, {
      subAgentsEnabled: true,
      supportsDelegation: true,
      maxParallel: 2,
    }),
    "parallel",
  );
  assert.equal(
    selectExecutionMode(independent, {
      subAgentsEnabled: false,
      supportsDelegation: true,
      maxParallel: 2,
    }),
    "sequential",
  );
});
