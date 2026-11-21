import * as fs from "node:fs";
import * as path from "node:path";
import type { IssuePlan, ParentIssueDraft, SubIssueDraft } from "../plan/types.js";
import { atomicWriteJson } from "../state/atomic-write.js";
import type {
  ApprovalDecisionStatus,
  ItemApprovalRecord,
  PlanApprovalReadiness,
  PlanApprovalRecord,
  TaskReadiness,
} from "./types.js";

const APPROVAL_DIR = [".github-convention", "state", "active"] as const;

export const getApprovalFilePath = (projectRoot: string, planId: string): string => {
  const safeId = planId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(projectRoot, ...APPROVAL_DIR, `approvals-${safeId}.json`);
};

export const createInitialApprovalRecord = (
  plan: IssuePlan,
  now = new Date().toISOString(),
): PlanApprovalRecord => {
  const items: Record<string, ItemApprovalRecord> = {
    [plan.parent.id]: {
      taskId: plan.parent.id,
      status: "pending",
      updatedAt: now,
    },
  };
  for (const sub of plan.subIssues) {
    items[sub.id] = {
      taskId: sub.id,
      status: "pending",
      updatedAt: now,
    };
  }
  return {
    schemaVersion: 1,
    planId: plan.planId,
    groupStatus: "pending",
    plan,
    items,
    updatedAt: now,
  };
};

export const loadApprovalRecord = (
  projectRoot: string,
  planId: string,
): PlanApprovalRecord | null => {
  const filePath = getApprovalFilePath(projectRoot, planId);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as PlanApprovalRecord;
};

export const saveApprovalRecord = (projectRoot: string, record: PlanApprovalRecord): string => {
  const filePath = getApprovalFilePath(projectRoot, record.planId);
  atomicWriteJson(filePath, record);
  return filePath;
};

export const discardApprovalRecord = (projectRoot: string, planId: string): boolean => {
  const filePath = getApprovalFilePath(projectRoot, planId);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
};

const updateAllItems = (
  record: PlanApprovalRecord,
  status: ApprovalDecisionStatus,
  now: string,
  reason?: string,
): PlanApprovalRecord => {
  const nextItems: Record<string, ItemApprovalRecord> = {};
  for (const [taskId, item] of Object.entries(record.items)) {
    nextItems[taskId] = {
      ...item,
      status,
      updatedAt: now,
      ...(reason !== undefined ? { reason } : {}),
    };
  }
  return {
    ...record,
    groupStatus: status,
    items: nextItems,
    updatedAt: now,
  };
};

export const approveGroup = (
  record: PlanApprovalRecord,
  now = new Date().toISOString(),
): PlanApprovalRecord => updateAllItems(record, "approved", now);

export const rejectGroup = (
  record: PlanApprovalRecord,
  reason?: string,
  now = new Date().toISOString(),
): PlanApprovalRecord => updateAllItems(record, "rejected", now, reason);

const updateSingleItem = (
  record: PlanApprovalRecord,
  taskId: string,
  status: ApprovalDecisionStatus,
  now: string,
  reason?: string,
): PlanApprovalRecord => {
  const existing = record.items[taskId];
  if (!existing) {
    throw new Error(`Unknown taskId '${taskId}' in plan '${record.planId}'.`);
  }
  return {
    ...record,
    items: {
      ...record.items,
      [taskId]: {
        ...existing,
        status,
        updatedAt: now,
        ...(reason !== undefined ? { reason } : {}),
      },
    },
    updatedAt: now,
  };
};

export const approveItem = (
  record: PlanApprovalRecord,
  taskId: string,
  now = new Date().toISOString(),
): PlanApprovalRecord => updateSingleItem(record, taskId, "approved", now);

export const rejectItem = (
  record: PlanApprovalRecord,
  taskId: string,
  reason?: string,
  now = new Date().toISOString(),
): PlanApprovalRecord => updateSingleItem(record, taskId, "rejected", now, reason);

export const excludeItem = (
  record: PlanApprovalRecord,
  taskId: string,
  reason?: string,
  now = new Date().toISOString(),
): PlanApprovalRecord => updateSingleItem(record, taskId, "excluded", now, reason);

export const editItem = (
  record: PlanApprovalRecord,
  taskId: string,
  edits: Partial<Pick<ParentIssueDraft, "title" | "summary" | "priority" | "labels">> &
    Partial<
      Pick<SubIssueDraft, "title" | "summary" | "priority" | "labels" | "acceptanceCriteria">
    >,
  now = new Date().toISOString(),
): PlanApprovalRecord => {
  const existing = record.items[taskId];
  if (!existing) {
    throw new Error(`Unknown taskId '${taskId}' in plan '${record.planId}'.`);
  }

  const nextPlan: IssuePlan =
    record.plan.parent.id === taskId
      ? {
          ...record.plan,
          parent: {
            ...record.plan.parent,
            ...(edits.title !== undefined ? { title: edits.title } : {}),
            ...(edits.summary !== undefined ? { summary: edits.summary } : {}),
            ...(edits.priority !== undefined ? { priority: edits.priority } : {}),
            ...(edits.labels !== undefined ? { labels: edits.labels } : {}),
          },
        }
      : {
          ...record.plan,
          subIssues: record.plan.subIssues.map((sub) =>
            sub.id === taskId
              ? {
                  ...sub,
                  ...(edits.title !== undefined ? { title: edits.title } : {}),
                  ...(edits.summary !== undefined ? { summary: edits.summary } : {}),
                  ...(edits.priority !== undefined ? { priority: edits.priority } : {}),
                  ...(edits.labels !== undefined ? { labels: edits.labels } : {}),
                  ...(edits.acceptanceCriteria !== undefined
                    ? { acceptanceCriteria: edits.acceptanceCriteria }
                    : {}),
                }
              : sub,
          ),
        };

  return {
    ...record,
    plan: nextPlan,
    items: {
      ...record.items,
      [taskId]: {
        ...existing,
        editedFields: { ...existing.editedFields, ...edits },
        updatedAt: now,
      },
    },
    updatedAt: now,
  };
};

export const computeEffectiveReadiness = (record: PlanApprovalRecord): PlanApprovalReadiness => {
  const parentStatus = record.items[record.plan.parent.id]?.status ?? "pending";
  const parentEligibleToCreate = parentStatus === "approved";

  const tasks: TaskReadiness[] = record.plan.subIssues.map((sub) => {
    const status = record.items[sub.id]?.status ?? "pending";
    const blockingTaskIds = sub.hardDependencies.filter((depId) => {
      const depStatus = record.items[depId]?.status ?? "pending";
      return depStatus !== "approved";
    });
    const blockedByUnapproved = status === "approved" && blockingTaskIds.length > 0;
    return {
      taskId: sub.id,
      status,
      eligibleToCreate: status === "approved" && parentEligibleToCreate,
      blockedByUnapproved,
      blockingTaskIds,
    };
  });

  return {
    planId: record.planId,
    parentStatus,
    parentEligibleToCreate,
    tasks,
  };
};
