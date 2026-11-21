import type { IssuePlan, PlanApprovalRecord, PlanValidationResult } from "@github-convention/core";
import type { ApplyIssuesResult, GitHubReadAdapter } from "@github-convention/github-adapter";

export type PlanValidateOptions = Readonly<{
  projectRoot?: string;
  planPath?: string;
}>;

export type PlanValidateResult = Readonly<{
  subcommand: "validate";
  valid: boolean;
  planId?: string;
  validation?: PlanValidationResult;
}>;

export type PlanApplyOptions = Readonly<{
  projectRoot?: string;
  plan?: IssuePlan;
  approvals?: PlanApprovalRecord;
  repo?: string;
  dryRun?: boolean;
  nonInteractive?: boolean;
  explicitApproval?: boolean;
  readAdapter?: GitHubReadAdapter;
}>;

export type PlanApplyCommandResult = Readonly<{
  status: "completed" | "approval_required" | "failed";
  dryRun: boolean;
  approvalRequired?: boolean;
  result?: ApplyIssuesResult;
  error?: string;
}>;
