import { execFileSync } from "node:child_process";
import {
  computeEffectiveReadiness,
  formatIdempotencyMarker,
  redactSecrets,
  renderIssueBody,
  type IssuePlan,
  type ParentIssueDraft,
  type PlanApprovalRecord,
  type SubIssueDraft,
} from "@dobbymin/github-convention-core";
import type { GhCommandRunner } from "../auth/types.js";
import {
  addBlockedByDependency,
  linkSubIssue,
  resolveIssueDatabaseId,
} from "../dependencies/dependency-links.js";
import type { GitHubReadAdapter } from "../read/read-adapter.js";
import type { GitHubIssue } from "../read/types.js";
import type {
  AppliedIssueItem,
  ApplyIssuesOptions,
  ApplyIssuesResult,
  DependencyLinkResult,
} from "./types.js";

const defaultGhRunner: GhCommandRunner = (file, args) =>
  execFileSync(file, args, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });

const collectLabels = (draft: ParentIssueDraft | SubIssueDraft): string[] => {
  const raw = [
    draft.type,
    ...(draft.priority ? [draft.priority] : []),
    ...(draft.scopes ?? []),
    ...(draft.labels ?? []),
  ];
  return [...new Set(raw)].filter((label) => label !== "blocked");
};

const parseCreatedIssueNumber = (output: string): { number?: number; url?: string } => {
  const trimmed = output.trim();
  const match = /\/issues\/(\d+)/.exec(trimmed);
  if (match) {
    return { number: Number(match[1]), url: trimmed };
  }
  const num = Number(trimmed);
  return Number.isInteger(num) && num > 0 ? { number: num } : {};
};

const createRemoteIssue = async (
  runner: GhCommandRunner,
  repo: string | undefined,
  title: string,
  body: string,
  labels: readonly string[],
): Promise<{ number: number; url?: string }> => {
  const args = ["issue", "create"];
  if (repo) args.push("--repo", repo);
  args.push("--title", title, "--body", body);
  for (const label of labels) {
    args.push("--label", label);
  }
  const stdout = await runner("gh", args);
  const parsed = parseCreatedIssueNumber(stdout);
  if (parsed.number === undefined) {
    throw new Error(
      `Unable to parse created issue number from gh output: ${redactSecrets(stdout)}`,
    );
  }
  return { number: parsed.number, ...(parsed.url !== undefined ? { url: parsed.url } : {}) };
};

const findByMarker = (issues: readonly GitHubIssue[], marker: string): GitHubIssue | undefined =>
  issues.find((issue) => issue.body.includes(marker));

export const applyApprovedIssues = async (
  plan: IssuePlan,
  approvals: PlanApprovalRecord,
  readAdapter: GitHubReadAdapter,
  writeRunner: GhCommandRunner = defaultGhRunner,
  options: ApplyIssuesOptions = {},
): Promise<ApplyIssuesResult> => {
  const dryRun = options.dryRun ?? false;
  const readiness = computeEffectiveReadiness(approvals);
  const existingIssues = await readAdapter.listIssues({ state: "all", limit: 200 });

  const items: AppliedIssueItem[] = [];
  const taskToIssueNumber = new Map<string, number>();

  const parentMarker = formatIdempotencyMarker(plan.planId, plan.parent.id);
  const existingParent = findByMarker(existingIssues, parentMarker);

  if (!readiness.parentEligibleToCreate) {
    items.push({
      taskId: plan.parent.id,
      role: "parent",
      action: "skip_unapproved",
      marker: parentMarker,
      reason: `Parent status is '${readiness.parentStatus}'`,
    });
  } else if (existingParent) {
    taskToIssueNumber.set(plan.parent.id, existingParent.number);
    items.push({
      taskId: plan.parent.id,
      role: "parent",
      action: "reuse",
      issueNumber: existingParent.number,
      issueUrl: existingParent.url,
      marker: parentMarker,
      reason: "Matched existing remote issue via idempotency marker",
    });
  } else if (dryRun) {
    items.push({
      taskId: plan.parent.id,
      role: "parent",
      action: "create",
      marker: parentMarker,
      reason: "Dry-run: approved parent issue would be created",
    });
  } else {
    const body = renderIssueBody(plan.parent, plan.planId, {
      subIssues: plan.subIssues.map((sub) => ({ id: sub.id, title: sub.title })),
    });
    const created = await createRemoteIssue(
      writeRunner,
      options.repo,
      plan.parent.title,
      body,
      collectLabels(plan.parent),
    );
    taskToIssueNumber.set(plan.parent.id, created.number);
    items.push({
      taskId: plan.parent.id,
      role: "parent",
      action: "create",
      issueNumber: created.number,
      ...(created.url !== undefined ? { issueUrl: created.url } : {}),
      marker: parentMarker,
      reason: "Created approved parent issue",
    });
  }

  for (const sub of plan.subIssues) {
    const taskReadiness = readiness.tasks.find((t) => t.taskId === sub.id);
    const marker = formatIdempotencyMarker(plan.planId, sub.id);
    const existingSub = findByMarker(existingIssues, marker);

    if (
      !taskReadiness ||
      taskReadiness.status !== "approved" ||
      !readiness.parentEligibleToCreate
    ) {
      items.push({
        taskId: sub.id,
        role: "sub_issue",
        action: "skip_unapproved",
        marker,
        reason: `Task status is '${taskReadiness?.status ?? "pending"}'`,
      });
      continue;
    }

    if (existingSub) {
      taskToIssueNumber.set(sub.id, existingSub.number);
      items.push({
        taskId: sub.id,
        role: "sub_issue",
        action: "reuse",
        issueNumber: existingSub.number,
        issueUrl: existingSub.url,
        marker,
        reason: "Matched existing remote issue via idempotency marker",
      });
      continue;
    }

    if (taskReadiness.blockedByUnapproved) {
      items.push({
        taskId: sub.id,
        role: "sub_issue",
        action: "blocked_by_unapproved",
        marker,
        reason: `Blocked by unapproved/excluded prerequisite(s): ${taskReadiness.blockingTaskIds.join(", ")}`,
      });
      continue;
    }

    if (dryRun) {
      items.push({
        taskId: sub.id,
        role: "sub_issue",
        action: "create",
        marker,
        reason: "Dry-run: approved sub-issue would be created",
      });
      continue;
    }

    const body = renderIssueBody(sub, plan.planId);
    const created = await createRemoteIssue(
      writeRunner,
      options.repo,
      sub.title,
      body,
      collectLabels(sub),
    );
    taskToIssueNumber.set(sub.id, created.number);
    items.push({
      taskId: sub.id,
      role: "sub_issue",
      action: "create",
      issueNumber: created.number,
      ...(created.url !== undefined ? { issueUrl: created.url } : {}),
      marker,
      reason: "Created approved sub-issue",
    });
  }

  const dependencies: DependencyLinkResult[] = [];
  if (options.linkDependencies !== false && options.repo) {
    const repo = options.repo;
    const issueNumberToDatabaseId = new Map<number, number>();
    const getDatabaseId = async (issueNumber: number): Promise<number> => {
      const cached = issueNumberToDatabaseId.get(issueNumber);
      if (cached !== undefined) return cached;
      const resolved = await resolveIssueDatabaseId(writeRunner, repo, issueNumber);
      issueNumberToDatabaseId.set(issueNumber, resolved);
      return resolved;
    };

    const parentNumber = taskToIssueNumber.get(plan.parent.id);
    for (const sub of plan.subIssues) {
      const subNumber = taskToIssueNumber.get(sub.id);
      if (parentNumber !== undefined && subNumber !== undefined) {
        const subDbId = dryRun ? undefined : await getDatabaseId(subNumber);
        dependencies.push(
          await linkSubIssue(
            writeRunner,
            repo,
            plan.parent.id,
            parentNumber,
            sub.id,
            subNumber,
            dryRun,
            subDbId,
          ),
        );
      }

      for (const depId of sub.hardDependencies) {
        const depNumber = taskToIssueNumber.get(depId);
        if (subNumber !== undefined && depNumber !== undefined) {
          const depDbId = dryRun ? undefined : await getDatabaseId(depNumber);
          dependencies.push(
            await addBlockedByDependency(
              writeRunner,
              repo,
              sub.id,
              subNumber,
              depId,
              depNumber,
              dryRun,
              depDbId,
            ),
          );
        } else if (dryRun) {
          dependencies.push({
            sourceTaskId: sub.id,
            targetTaskId: depId,
            kind: "blocked_by",
            action: "skipped_dry_run",
          });
        }
      }
    }
  }

  return {
    planId: plan.planId,
    dryRun,
    items,
    dependencies,
    createdCount: items.filter((item) => item.action === "create").length,
    reusedCount: items.filter((item) => item.action === "reuse").length,
    skippedCount: items.filter(
      (item) => item.action === "skip_unapproved" || item.action === "blocked_by_unapproved",
    ).length,
  };
};
