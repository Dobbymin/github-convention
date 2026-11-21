export type ParentIssueSnapshot = Readonly<{
  issueNumber: number;
  state: "open" | "closed";
}>;

export type ChildIssueSnapshot = Readonly<{
  taskId: string;
  issueNumber: number;
  state: "open" | "closed";
}>;

export type ParentLifecycleDecision = Readonly<{
  parentIssueNumber: number;
  currentState: "open" | "closed";
  desiredState: "open" | "closed";
  action: "keep_open" | "close_parent" | "reopen_parent" | "keep_closed";
  openChildTaskIds: readonly string[];
  reason: string;
}>;

export type DependencyKind = "code" | "contract";

export type TaskDependencyRef = Readonly<{
  taskId: string;
  kind: DependencyKind;
  contractDoc?: string;
}>;

export type UpstreamTaskSnapshot = Readonly<{
  taskId: string;
  issueState: "open" | "closed";
  prState: "none" | "open" | "merged" | "closed";
}>;

export type TaskReadinessEvaluation = Readonly<{
  taskId: string;
  ready: boolean;
  waitingOnTaskIds: readonly string[];
  reason: string;
}>;

export type FollowUpImpact = "high" | "medium" | "low";

export type FailedTaskContext = Readonly<{
  taskId: string;
  title: string;
  originalIssueNumber: number;
  parentIssueNumber?: number;
  failureSummary: string;
  attemptsUsed: number;
  changedFiles?: readonly string[];
}>;

export type FollowUpIssueProposal = Readonly<{
  title: string;
  body: string;
  type: "type:bug" | "type:task";
  priority: "priority:high" | "priority:medium" | "priority:low";
  originalIssueNumber: number;
  parentIssueNumber?: number;
  requiresApproval: true;
}>;
