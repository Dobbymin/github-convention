import type {
  IssuePlan,
  PlanApprovalRecord,
  PlanValidationResult,
} from "@dobbymin/github-convention-core";
import type {
  ApplyIssuesResult,
  GhCommandRunner,
  GitHubReadAdapter,
} from "@dobbymin/github-convention-github-adapter";
import type { OutputFormat } from "../options.js";

export type PlanValidateOptions = Readonly<{
  projectRoot?: string;
  planPath?: string;
}>;

export type PlanValidateResult = Readonly<{
  subcommand: "validate";
  valid: boolean;
  planId?: string;
  validation?: PlanValidationResult;
  errorCode?: string;
  error?: string;
}>;

export type PlanApplyOptions = Readonly<{
  projectRoot?: string;
  planPath?: string;
  plan?: IssuePlan;
  approvals?: PlanApprovalRecord;
  repo?: string;
  dryRun?: boolean;
  nonInteractive?: boolean;
  explicitApproval?: boolean;
  output?: OutputFormat;
  promptApproval?: (plan: IssuePlan) => Promise<boolean> | boolean;
  readAdapter?: GitHubReadAdapter;
  writeRunner?: GhCommandRunner;
}>;

export type PlanApplyCommandResult = Readonly<{
  status: "completed" | "approval_required" | "failed";
  dryRun: boolean;
  approvalRequired?: boolean;
  result?: ApplyIssuesResult;
  errorCode?: string;
  error?: string;
}>;
