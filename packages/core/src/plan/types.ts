export type IssueTypeLabel =
  | "type:epic"
  | "type:feature"
  | "type:bug"
  | "type:task"
  | "type:docs"
  | "type:refactor"
  | "type:test"
  | "type:chore";

export type PriorityLabel = "priority:high" | "priority:medium" | "priority:low";

export type ParentIssueDraft = Readonly<{
  id: string;
  title: string;
  summary: string;
  goals: readonly string[];
  inScope: readonly string[];
  outOfScope: readonly string[];
  acceptanceCriteria: readonly string[];
  references?: readonly string[];
  type: IssueTypeLabel | string;
  priority?: PriorityLabel | string;
  scopes?: readonly string[];
  labels?: readonly string[];
}>;

export type SubIssueDraft = Readonly<{
  id: string;
  title: string;
  summary: string;
  context?: string;
  requirements?: readonly string[];
  tasks?: readonly string[];
  acceptanceCriteria: readonly string[];
  hardDependencies: readonly string[];
  allowedFiles: readonly string[];
  sharedContracts: readonly string[];
  assumptions: readonly string[];
  technicalNotes?: readonly string[];
  references?: readonly string[];
  type: IssueTypeLabel | string;
  priority?: PriorityLabel | string;
  scopes?: readonly string[];
  labels?: readonly string[];
}>;

export type SharedContract = Readonly<{
  id: string;
  description: string;
  participants: readonly string[];
  files?: readonly string[];
}>;

export type IssuePlan = Readonly<{
  planId: string;
  parent: ParentIssueDraft;
  subIssues: readonly SubIssueDraft[];
  sharedContracts?: readonly SharedContract[];
}>;

export type PlanValidationIssue = Readonly<{
  code: string;
  message: string;
  taskId?: string;
}>;

export type PlanValidationResult = Readonly<{
  valid: boolean;
  errors: readonly PlanValidationIssue[];
  warnings: readonly PlanValidationIssue[];
}>;
