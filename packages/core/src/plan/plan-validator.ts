import path from "node:path";
import type {
  IssuePlan,
  ParentIssueDraft,
  PlanValidationIssue,
  PlanValidationResult,
  SubIssueDraft,
} from "./types.js";

const VALID_SUB_ISSUE_TYPES = new Set([
  "type:feature",
  "type:bug",
  "type:task",
  "type:docs",
  "type:refactor",
  "type:test",
  "type:chore",
]);

const VALID_PRIORITIES = new Set(["priority:high", "priority:medium", "priority:low"]);

const normalizePosixPath = (input: string): string => {
  const withForwardSlashes = input.replace(/\\/g, "/").trim();
  const normalized = path.posix.normalize(withForwardSlashes);
  return normalized.replace(/^\.\//, "").replace(/\/+$/, "");
};

const stripGlobSuffix = (pattern: string): string => {
  return pattern
    .replace(/\/\*\*$/, "")
    .replace(/\/\*$/, "")
    .replace(/\*+$/, "")
    .replace(/\/+$/, "");
};

const pathsOverlap = (rawA: string, rawB: string): boolean => {
  const a = normalizePosixPath(rawA);
  const b = normalizePosixPath(rawB);
  if (!a || !b) {
    return false;
  }
  if (a === b) {
    return true;
  }

  const baseA = stripGlobSuffix(a);
  const baseB = stripGlobSuffix(b);
  if (!baseA || !baseB) {
    return true;
  }
  if (baseA === baseB) {
    return true;
  }

  const aIsWildcard = a.includes("*");
  const bIsWildcard = b.includes("*");

  if (aIsWildcard && (baseB === baseA || baseB.startsWith(`${baseA}/`))) {
    return true;
  }
  if (bIsWildcard && (baseA === baseB || baseA.startsWith(`${baseB}/`))) {
    return true;
  }
  if (!aIsWildcard && !bIsWildcard) {
    return baseA.startsWith(`${baseB}/`) || baseB.startsWith(`${baseA}/`);
  }

  return false;
};

const collectLabels = (draft: ParentIssueDraft | SubIssueDraft): string[] => {
  const combined: string[] = [];
  if (draft.type) {
    combined.push(draft.type);
  }
  if (draft.priority) {
    combined.push(draft.priority);
  }
  if (draft.scopes) {
    combined.push(...draft.scopes);
  }
  if (draft.labels) {
    combined.push(...draft.labels);
  }
  return combined.map((label) => label.trim()).filter(Boolean);
};

const validateLabels = (
  draft: ParentIssueDraft | SubIssueDraft,
  isParent: boolean,
  errors: PlanValidationIssue[],
): void => {
  const labels = collectLabels(draft);
  const typeLabels = labels.filter((l) => l.toLowerCase().startsWith("type:"));
  const priorityLabels = labels.filter((l) => l.toLowerCase().startsWith("priority:"));

  if (labels.some((l) => l.toLowerCase() === "blocked")) {
    errors.push({
      code: "DISALLOWED_BLOCKED_LABEL",
      message: `Task "${draft.id}" must not use the "blocked" label; use native dependencies instead.`,
      taskId: draft.id,
    });
  }

  if (typeLabels.length !== 1) {
    errors.push({
      code: "INVALID_TYPE_LABEL_COUNT",
      message: `Task "${draft.id}" must have exactly 1 type:* label (found ${typeLabels.length}).`,
      taskId: draft.id,
    });
  } else {
    const typeLabel = typeLabels[0];
    if (isParent && typeLabel !== "type:epic") {
      errors.push({
        code: "INVALID_PARENT_TYPE_LABEL",
        message: `Parent issue "${draft.id}" must use "type:epic" (found "${typeLabel}").`,
        taskId: draft.id,
      });
    } else if (!isParent && !VALID_SUB_ISSUE_TYPES.has(typeLabel)) {
      errors.push({
        code: "INVALID_SUB_ISSUE_TYPE_LABEL",
        message: `Sub-issue "${draft.id}" has invalid type label "${typeLabel}".`,
        taskId: draft.id,
      });
    }
  }

  if (priorityLabels.length > 1) {
    errors.push({
      code: "INVALID_PRIORITY_LABEL_COUNT",
      message: `Task "${draft.id}" may have at most 1 priority:* label (found ${priorityLabels.length}).`,
      taskId: draft.id,
    });
  } else if (priorityLabels.length === 1 && !VALID_PRIORITIES.has(priorityLabels[0])) {
    errors.push({
      code: "INVALID_PRIORITY_LABEL",
      message: `Task "${draft.id}" has invalid priority label "${priorityLabels[0]}".`,
      taskId: draft.id,
    });
  }
};

const buildReachability = (subIssues: readonly SubIssueDraft[]): Map<string, Set<string>> => {
  const depsById = new Map<string, readonly string[]>();
  for (const issue of subIssues) {
    depsById.set(issue.id, issue.hardDependencies);
  }

  const reachable = new Map<string, Set<string>>();
  for (const issue of subIssues) {
    const visited = new Set<string>();
    const stack = [...issue.hardDependencies];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || visited.has(current)) {
        continue;
      }
      visited.add(current);
      const nextDeps = depsById.get(current);
      if (nextDeps) {
        for (const dep of nextDeps) {
          if (!visited.has(dep)) {
            stack.push(dep);
          }
        }
      }
    }
    reachable.set(issue.id, visited);
  }
  return reachable;
};

const detectCycle = (subIssues: readonly SubIssueDraft[]): string[] | null => {
  const depsById = new Map<string, readonly string[]>();
  for (const issue of subIssues) {
    depsById.set(issue.id, issue.hardDependencies);
  }

  const state = new Map<string, "visiting" | "visited">();
  const pathStack: string[] = [];

  const dfs = (nodeId: string): string[] | null => {
    state.set(nodeId, "visiting");
    pathStack.push(nodeId);

    for (const depId of depsById.get(nodeId) ?? []) {
      if (!depsById.has(depId)) {
        continue;
      }
      const depState = state.get(depId);
      if (depState === "visiting") {
        const cycleStart = pathStack.indexOf(depId);
        return [...pathStack.slice(cycleStart), depId];
      }
      if (depState === undefined) {
        const cycle = dfs(depId);
        if (cycle) {
          return cycle;
        }
      }
    }

    pathStack.pop();
    state.set(nodeId, "visited");
    return null;
  };

  for (const issue of subIssues) {
    if (state.get(issue.id) === undefined) {
      const cycle = dfs(issue.id);
      if (cycle) {
        return cycle;
      }
    }
  }
  return null;
};

const shareContract = (a: SubIssueDraft, b: SubIssueDraft, plan: IssuePlan): boolean => {
  const bContracts = new Set(b.sharedContracts.map((c) => c.trim()).filter(Boolean));
  if (a.sharedContracts.some((c) => bContracts.has(c.trim()))) {
    return true;
  }

  for (const contract of plan.sharedContracts ?? []) {
    const participants = new Set(contract.participants);
    if (participants.has(a.id) && participants.has(b.id)) {
      return true;
    }
  }
  return false;
};

export const validateIssuePlan = (plan: IssuePlan): PlanValidationResult => {
  const errors: PlanValidationIssue[] = [];
  const warnings: PlanValidationIssue[] = [];

  if (!plan || typeof plan !== "object") {
    return {
      valid: false,
      errors: [{ code: "INVALID_PLAN", message: "IssuePlan must be an object." }],
      warnings,
    };
  }

  if (typeof plan.planId !== "string" || plan.planId.trim().length === 0) {
    errors.push({ code: "MISSING_PLAN_ID", message: "planId must be a non-empty string." });
  }

  if (!plan.parent || typeof plan.parent !== "object") {
    errors.push({ code: "MISSING_PARENT", message: "IssuePlan must include a parent draft." });
    return { valid: false, errors, warnings };
  }

  if (!plan.parent.id?.trim()) {
    errors.push({ code: "MISSING_TASK_ID", message: "Parent issue must have a non-empty id." });
  }
  if (!plan.parent.title?.trim()) {
    errors.push({
      code: "MISSING_TITLE",
      message: `Parent issue "${plan.parent.id}" must have a non-empty title.`,
      taskId: plan.parent.id,
    });
  }
  if (
    !Array.isArray(plan.parent.acceptanceCriteria) ||
    plan.parent.acceptanceCriteria.length === 0
  ) {
    errors.push({
      code: "MISSING_ACCEPTANCE_CRITERIA",
      message: `Parent issue "${plan.parent.id}" must define acceptanceCriteria.`,
      taskId: plan.parent.id,
    });
  }

  validateLabels(plan.parent, true, errors);

  if (!Array.isArray(plan.subIssues)) {
    errors.push({ code: "INVALID_SUB_ISSUES", message: "subIssues must be an array." });
    return { valid: false, errors, warnings };
  }

  const seenIds = new Set<string>([plan.parent.id]);
  const subIssueIds = new Set<string>();

  for (const sub of plan.subIssues) {
    if (!sub.id?.trim()) {
      errors.push({ code: "MISSING_TASK_ID", message: "Each sub-issue must have a non-empty id." });
      continue;
    }
    if (seenIds.has(sub.id)) {
      errors.push({
        code: "DUPLICATE_TASK_ID",
        message: `Duplicate task id "${sub.id}" in plan.`,
        taskId: sub.id,
      });
    }
    seenIds.add(sub.id);
    subIssueIds.add(sub.id);

    if (!sub.title?.trim()) {
      errors.push({
        code: "MISSING_TITLE",
        message: `Sub-issue "${sub.id}" must have a non-empty title.`,
        taskId: sub.id,
      });
    }
    if (!Array.isArray(sub.acceptanceCriteria) || sub.acceptanceCriteria.length === 0) {
      errors.push({
        code: "MISSING_ACCEPTANCE_CRITERIA",
        message: `Sub-issue "${sub.id}" must define acceptanceCriteria.`,
        taskId: sub.id,
      });
    }
    if (
      !Array.isArray(sub.hardDependencies) ||
      !Array.isArray(sub.allowedFiles) ||
      !Array.isArray(sub.sharedContracts) ||
      !Array.isArray(sub.assumptions)
    ) {
      errors.push({
        code: "INVALID_SUB_ISSUE_SCHEMA",
        message: `Sub-issue "${sub.id}" must include array fields hardDependencies, allowedFiles, sharedContracts, and assumptions.`,
        taskId: sub.id,
      });
    }

    validateLabels(sub, false, errors);
  }

  // Validate dependency references
  for (const sub of plan.subIssues) {
    for (const depId of sub.hardDependencies ?? []) {
      if (depId === sub.id) {
        errors.push({
          code: "SELF_DEPENDENCY",
          message: `Sub-issue "${sub.id}" cannot depend on itself.`,
          taskId: sub.id,
        });
      } else if (!subIssueIds.has(depId)) {
        errors.push({
          code: "MISSING_DEPENDENCY_ID",
          message: `Sub-issue "${sub.id}" references unknown hardDependency "${depId}".`,
          taskId: sub.id,
        });
      }
    }
  }

  // Detect cycles
  const cycle = detectCycle(plan.subIssues);
  if (cycle) {
    errors.push({
      code: "DEPENDENCY_CYCLE",
      message: `Hard dependency cycle detected: ${cycle.join(" -> ")}.`,
    });
  }

  // Check overlapping allowedFiles without hard dependency or shared contract
  const reachability = buildReachability(plan.subIssues);
  for (let i = 0; i < plan.subIssues.length; i += 1) {
    for (let j = i + 1; j < plan.subIssues.length; j += 1) {
      const a = plan.subIssues[i];
      const b = plan.subIssues[j];
      const overlappingFiles: string[] = [];

      for (const fileA of a.allowedFiles ?? []) {
        for (const fileB of b.allowedFiles ?? []) {
          if (pathsOverlap(fileA, fileB)) {
            overlappingFiles.push(`${normalizePosixPath(fileA)} <-> ${normalizePosixPath(fileB)}`);
          }
        }
      }

      if (overlappingFiles.length > 0) {
        const aDependsOnB = reachability.get(a.id)?.has(b.id) ?? false;
        const bDependsOnA = reachability.get(b.id)?.has(a.id) ?? false;
        const hasContract = shareContract(a, b, plan);

        if (!aDependsOnB && !bDependsOnA && !hasContract) {
          errors.push({
            code: "OVERLAPPING_FILES_WITHOUT_DEPENDENCY_OR_CONTRACT",
            message: `Sub-issues "${a.id}" and "${b.id}" have overlapping allowedFiles (${overlappingFiles.join(", ")}) without a hard dependency or shared contract.`,
            taskId: a.id,
          });
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
};
