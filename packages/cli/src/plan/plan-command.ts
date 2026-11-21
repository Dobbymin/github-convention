import * as fs from "node:fs";
import * as path from "node:path";
import {
  approveGroup,
  createInitialApprovalRecord,
  loadApprovalRecord,
  validateIssuePlan,
  type IssuePlan,
} from "@github-convention/core";
import { applyApprovedIssues, GitHubReadAdapter } from "@github-convention/github-adapter";
import type {
  PlanApplyCommandResult,
  PlanApplyOptions,
  PlanValidateOptions,
  PlanValidateResult,
} from "./types.js";

const DEFAULT_PLAN_REL = [".github-convention", "state", "active", "plan.json"] as const;

export const runPlanValidate = (options: PlanValidateOptions = {}): PlanValidateResult => {
  const projectRoot = options.projectRoot ?? process.cwd();
  const planPath = options.planPath ?? path.join(projectRoot, ...DEFAULT_PLAN_REL);

  if (!fs.existsSync(planPath)) {
    return {
      subcommand: "validate",
      valid: true,
    };
  }

  const raw = fs.readFileSync(planPath, "utf-8");
  const plan = JSON.parse(raw) as IssuePlan;
  const validation = validateIssuePlan(plan);

  return {
    subcommand: "validate",
    valid: validation.valid,
    planId: plan.planId,
    validation,
  };
};

export const runPlanApply = async (
  options: PlanApplyOptions = {},
): Promise<PlanApplyCommandResult> => {
  const dryRun = options.dryRun ?? false;
  const projectRoot = options.projectRoot ?? process.cwd();

  if (dryRun) {
    if (options.plan) {
      const approvals =
        options.approvals ??
        loadApprovalRecord(projectRoot, options.plan.planId) ??
        createInitialApprovalRecord(options.plan);
      const readAdapter = options.readAdapter ?? new GitHubReadAdapter({ repo: options.repo });
      const result = await applyApprovedIssues(options.plan, approvals, readAdapter, undefined, {
        ...(options.repo !== undefined ? { repo: options.repo } : {}),
        dryRun: true,
      });
      return {
        status: "completed",
        dryRun: true,
        result,
      };
    }

    return {
      status: "completed",
      dryRun: true,
    };
  }

  if (options.nonInteractive && !options.explicitApproval) {
    return {
      status: "approval_required",
      dryRun: false,
      approvalRequired: true,
    };
  }

  if (!options.plan) {
    return {
      status: "approval_required",
      dryRun: false,
      approvalRequired: true,
    };
  }

  const validation = validateIssuePlan(options.plan);
  if (!validation.valid) {
    return {
      status: "failed",
      dryRun: false,
      error: `Issue plan '${options.plan.planId}' failed validation (${validation.errors.length} error(s)).`,
    };
  }

  const stored = options.approvals ?? loadApprovalRecord(projectRoot, options.plan.planId);
  if (!stored) {
    if (!options.explicitApproval) {
      return {
        status: "approval_required",
        dryRun: false,
        approvalRequired: true,
      };
    }
  }

  const approvals = stored ?? approveGroup(createInitialApprovalRecord(options.plan));
  const readAdapter = options.readAdapter ?? new GitHubReadAdapter({ repo: options.repo });
  const result = await applyApprovedIssues(options.plan, approvals, readAdapter, undefined, {
    ...(options.repo !== undefined ? { repo: options.repo } : {}),
    dryRun: false,
  });

  return {
    status: "completed",
    dryRun: false,
    result,
  };
};
