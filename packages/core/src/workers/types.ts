export type ForbiddenWorkerAction =
  | "git_commit"
  | "git_push"
  | "github_issue_mutation"
  | "github_pr_mutation"
  | "github_label_mutation"
  | "review_thread_resolve"
  | "pr_merge"
  | "shared_state_write";

export type WorkerAssignment = Readonly<{
  taskId: string;
  issueNumber: number;
  workspacePath: string;
  acceptanceCriteria: readonly string[];
  allowedFiles: readonly string[];
  testCommands: readonly string[];
  forbiddenActions: readonly ForbiddenWorkerAction[];
  reportLanguage: "en";
}>;

export type TaskReportStatus = "completed" | "blocked" | "failed";

export type ParsedTaskReport = Readonly<{
  issue: string;
  status: TaskReportStatus;
  summary: string;
  changedFiles: readonly string[];
  tests: readonly string[];
  technicalDecisions: readonly string[];
  knownIssues: readonly string[];
  blockers: readonly string[];
}>;

export type WorkerVerificationInput = Readonly<{
  report: ParsedTaskReport;
  actualChangedFiles: readonly string[];
  allowedFiles: readonly string[];
  secretFindings: readonly string[];
  verificationPassed: boolean;
  attemptedForbiddenActions?: readonly ForbiddenWorkerAction[];
}>;

export type WorkerVerificationResult = Readonly<{
  accepted: boolean;
  outOfScopeFiles: readonly string[];
  secretFindings: readonly string[];
  forbiddenActionsAttempted: readonly ForbiddenWorkerAction[];
  reasons: readonly string[];
}>;
