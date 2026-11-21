import type { IssuePlan, ParentIssueDraft, SubIssueDraft } from "../plan/types.js";

export type ApprovalDecisionStatus = "pending" | "approved" | "rejected" | "excluded";

export type ItemApprovalRecord = Readonly<{
  taskId: string;
  status: ApprovalDecisionStatus;
  updatedAt: string;
  editedFields?: Partial<Pick<ParentIssueDraft, "title" | "summary" | "priority" | "labels">> &
    Partial<
      Pick<SubIssueDraft, "title" | "summary" | "priority" | "labels" | "acceptanceCriteria">
    >;
  reason?: string;
}>;

export type PlanApprovalRecord = Readonly<{
  schemaVersion: 1;
  planId: string;
  groupStatus: ApprovalDecisionStatus;
  plan: IssuePlan;
  items: Readonly<Record<string, ItemApprovalRecord>>;
  updatedAt: string;
}>;

export type TaskReadiness = Readonly<{
  taskId: string;
  status: ApprovalDecisionStatus;
  eligibleToCreate: boolean;
  blockedByUnapproved: boolean;
  blockingTaskIds: readonly string[];
}>;

export type PlanApprovalReadiness = Readonly<{
  planId: string;
  parentStatus: ApprovalDecisionStatus;
  parentEligibleToCreate: boolean;
  tasks: readonly TaskReadiness[];
}>;
