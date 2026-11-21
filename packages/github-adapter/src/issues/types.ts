export type IssueApplyAction = "create" | "reuse" | "skip_unapproved" | "blocked_by_unapproved";

export type AppliedIssueItem = Readonly<{
  taskId: string;
  role: "parent" | "sub_issue";
  action: IssueApplyAction;
  issueNumber?: number;
  issueUrl?: string;
  marker: string;
  reason: string;
}>;

export type DependencyLinkResult = Readonly<{
  sourceTaskId: string;
  targetTaskId: string;
  kind: "sub_issue" | "blocked_by";
  action: "linked" | "already_linked" | "skipped_dry_run" | "skipped_missing_issue";
}>;

export type ApplyIssuesOptions = Readonly<{
  repo?: string;
  dryRun?: boolean;
  linkDependencies?: boolean;
}>;

export type ApplyIssuesResult = Readonly<{
  planId: string;
  dryRun: boolean;
  items: readonly AppliedIssueItem[];
  dependencies: readonly DependencyLinkResult[];
  createdCount: number;
  reusedCount: number;
  skippedCount: number;
}>;
