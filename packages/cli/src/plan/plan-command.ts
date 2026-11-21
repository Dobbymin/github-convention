import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline/promises";
import {
  approveGroup,
  computeEffectiveReadiness,
  createInitialApprovalRecord,
  ErrorCodes,
  loadApprovalRecord,
  saveApprovalRecord,
  validateIssuePlan,
  type IssuePlan,
} from "@dobbymin/github-convention-core";
import { applyApprovedIssues, GitHubReadAdapter } from "@dobbymin/github-convention-github-adapter";
import type {
  PlanApplyCommandResult,
  PlanApplyOptions,
  PlanValidateOptions,
  PlanValidateResult,
} from "./types.js";

const DEFAULT_PLAN_REL = [".github-convention", "state", "active", "plan.json"] as const;

const resolvePlanPath = (projectRoot: string, planPath?: string): string => {
  if (!planPath) {
    return path.join(projectRoot, ...DEFAULT_PLAN_REL);
  }
  return path.isAbsolute(planPath) ? planPath : path.resolve(projectRoot, planPath);
};

type LoadedPlan = { ok: true; plan: IssuePlan } | { ok: false; missing: boolean; error: string };

const loadPlanFromFile = (planPath: string): LoadedPlan => {
  if (!fs.existsSync(planPath)) {
    return {
      ok: false,
      missing: true,
      error: `Plan file not found: ${planPath}`,
    };
  }

  try {
    const raw = fs.readFileSync(planPath, "utf-8");
    const plan = JSON.parse(raw) as IssuePlan;
    return { ok: true, plan };
  } catch (err) {
    return {
      ok: false,
      missing: false,
      error: `Invalid JSON in plan file ${planPath}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
};

const promptTerminalApproval = async (plan: IssuePlan): Promise<boolean> => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    const answer = await rl.question(
      `Apply issue plan '${plan.planId}' (${plan.subIssues.length} sub-issue(s)) to GitHub? [y/N] `,
    );
    return /^(y|yes)$/i.test(answer.trim());
  } finally {
    rl.close();
  }
};

export const runPlanValidate = (options: PlanValidateOptions = {}): PlanValidateResult => {
  const projectRoot = options.projectRoot ?? process.cwd();
  const planPath = resolvePlanPath(projectRoot, options.planPath);
  const loaded = loadPlanFromFile(planPath);

  if (!loaded.ok) {
    return {
      subcommand: "validate",
      valid: false,
      errorCode: ErrorCodes.CONFIG_INVALID,
      error: loaded.error,
    };
  }

  const validation = validateIssuePlan(loaded.plan);
  return {
    subcommand: "validate",
    valid: validation.valid,
    planId: loaded.plan.planId,
    validation,
  };
};

export const runPlanApply = async (
  options: PlanApplyOptions = {},
): Promise<PlanApplyCommandResult> => {
  const dryRun = options.dryRun ?? false;
  const projectRoot = options.projectRoot ?? process.cwd();
  const planPath = resolvePlanPath(projectRoot, options.planPath);

  let plan = options.plan;
  if (!plan) {
    const loaded = loadPlanFromFile(planPath);
    if (!loaded.ok) {
      if (dryRun && loaded.missing) {
        return {
          status: "completed",
          dryRun: true,
        };
      }
      return {
        status: "failed",
        dryRun,
        errorCode: ErrorCodes.CONFIG_INVALID,
        error: loaded.error,
      };
    }
    plan = loaded.plan;
  }

  const validation = validateIssuePlan(plan);
  if (!validation.valid) {
    return {
      status: "failed",
      dryRun,
      errorCode: ErrorCodes.CONFIG_INVALID,
      error: `Issue plan '${plan.planId}' failed validation (${validation.errors.length} error(s)).`,
    };
  }

  const readAdapter = options.readAdapter ?? new GitHubReadAdapter({ repo: options.repo });

  if (dryRun) {
    const approvals =
      options.approvals ??
      loadApprovalRecord(projectRoot, plan.planId) ??
      createInitialApprovalRecord(plan);
    let repo = options.repo;
    if (!repo) {
      try {
        const meta = await readAdapter.getRepoMetadata();
        repo = meta.nameWithOwner;
      } catch {
        // Best-effort in dry-run: do not fail if getRepoMetadata is unavailable.
      }
    }
    const result = await applyApprovedIssues(plan, approvals, readAdapter, options.writeRunner, {
      ...(repo !== undefined ? { repo } : {}),
      dryRun: true,
    });
    return {
      status: "completed",
      dryRun: true,
      result,
    };
  }

  let approvals = options.approvals ?? loadApprovalRecord(projectRoot, plan.planId);
  const isParentApproved = approvals
    ? computeEffectiveReadiness(approvals).parentEligibleToCreate
    : false;

  if (!isParentApproved) {
    if (options.explicitApproval) {
      approvals = approveGroup(approvals ?? createInitialApprovalRecord(plan));
      saveApprovalRecord(projectRoot, approvals);
    } else if (options.nonInteractive) {
      return {
        status: "approval_required",
        dryRun: false,
        approvalRequired: true,
      };
    } else if (
      options.promptApproval ||
      (Boolean(process.stdin.isTTY) && (options.output ?? "text") === "text")
    ) {
      const approved = options.promptApproval
        ? await options.promptApproval(plan)
        : await promptTerminalApproval(plan);
      if (!approved) {
        return {
          status: "approval_required",
          dryRun: false,
          approvalRequired: true,
        };
      }
      approvals = approveGroup(approvals ?? createInitialApprovalRecord(plan));
      saveApprovalRecord(projectRoot, approvals);
    } else {
      return {
        status: "approval_required",
        dryRun: false,
        approvalRequired: true,
      };
    }
  }

  let repo = options.repo;
  if (!repo) {
    const meta = await readAdapter.getRepoMetadata();
    repo = meta.nameWithOwner;
  }

  const result = await applyApprovedIssues(plan, approvals!, readAdapter, options.writeRunner, {
    repo,
    dryRun: false,
  });

  return {
    status: "completed",
    dryRun: false,
    result,
  };
};
