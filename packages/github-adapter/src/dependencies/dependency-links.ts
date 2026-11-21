import type { GhCommandRunner } from "../auth/types.js";
import type { DependencyLinkResult } from "../issues/types.js";

const parseIssueNumbers = (raw: string): number[] => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) =>
        typeof entry === "object" && entry !== null && "number" in entry
          ? Number((entry as { number: unknown }).number)
          : NaN,
      )
      .filter((num) => Number.isInteger(num) && num > 0);
  } catch {
    return [];
  }
};

export const linkSubIssue = async (
  runner: GhCommandRunner,
  repo: string,
  parentTaskId: string,
  parentNumber: number,
  childTaskId: string,
  childNumber: number,
  dryRun = false,
): Promise<DependencyLinkResult> => {
  if (dryRun) {
    return {
      sourceTaskId: parentTaskId,
      targetTaskId: childTaskId,
      kind: "sub_issue",
      action: "skipped_dry_run",
    };
  }

  try {
    const existingRaw = await runner("gh", [
      "api",
      `repos/${repo}/issues/${parentNumber}/sub_issues`,
      "--method",
      "GET",
    ]);
    if (parseIssueNumbers(existingRaw).includes(childNumber)) {
      return {
        sourceTaskId: parentTaskId,
        targetTaskId: childTaskId,
        kind: "sub_issue",
        action: "already_linked",
      };
    }
  } catch {
    // Proceed to link attempt if read endpoint returns empty/unsupported in mock.
  }

  await runner("gh", [
    "api",
    `repos/${repo}/issues/${parentNumber}/sub_issues`,
    "--method",
    "POST",
    "-F",
    `sub_issue_id=${childNumber}`,
  ]);

  return {
    sourceTaskId: parentTaskId,
    targetTaskId: childTaskId,
    kind: "sub_issue",
    action: "linked",
  };
};

export const addBlockedByDependency = async (
  runner: GhCommandRunner,
  repo: string,
  blockedTaskId: string,
  blockedNumber: number,
  blockingTaskId: string,
  blockingNumber: number,
  dryRun = false,
): Promise<DependencyLinkResult> => {
  if (dryRun) {
    return {
      sourceTaskId: blockedTaskId,
      targetTaskId: blockingTaskId,
      kind: "blocked_by",
      action: "skipped_dry_run",
    };
  }

  try {
    const existingRaw = await runner("gh", [
      "api",
      `repos/${repo}/issues/${blockedNumber}/dependencies/blocked_by`,
      "--method",
      "GET",
    ]);
    if (parseIssueNumbers(existingRaw).includes(blockingNumber)) {
      return {
        sourceTaskId: blockedTaskId,
        targetTaskId: blockingTaskId,
        kind: "blocked_by",
        action: "already_linked",
      };
    }
  } catch {
    // Proceed to link attempt if read endpoint returns empty/unsupported in mock.
  }

  await runner("gh", [
    "api",
    `repos/${repo}/issues/${blockedNumber}/dependencies/blocked_by`,
    "--method",
    "POST",
    "-F",
    `issue_id=${blockingNumber}`,
  ]);

  return {
    sourceTaskId: blockedTaskId,
    targetTaskId: blockingTaskId,
    kind: "blocked_by",
    action: "linked",
  };
};
