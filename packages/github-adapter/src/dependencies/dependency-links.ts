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

export const resolveIssueDatabaseId = async (
  runner: GhCommandRunner,
  repo: string,
  issueNumber: number,
  knownId?: number,
): Promise<number> => {
  if (knownId !== undefined && Number.isInteger(knownId) && knownId > 0) {
    return knownId;
  }

  const raw = await runner("gh", ["api", `repos/${repo}/issues/${issueNumber}`, "--jq", ".id"]);
  const trimmed = raw.trim();

  if (/^\d+$/.test(trimmed)) {
    const parsed = Number(trimmed);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  try {
    const json = JSON.parse(trimmed) as unknown;
    if (typeof json === "number" && Number.isInteger(json) && json > 0) {
      return json;
    }
    if (typeof json === "object" && json !== null && "id" in json) {
      const id = Number((json as { id: unknown }).id);
      if (Number.isInteger(id) && id > 0) {
        return id;
      }
    }
  } catch {
    // Fall through to descriptive error.
  }

  throw new Error(`Unable to resolve numeric databaseId for ${repo}#${issueNumber}`);
};

export const linkSubIssue = async (
  runner: GhCommandRunner,
  repo: string,
  parentTaskId: string,
  parentNumber: number,
  childTaskId: string,
  childNumber: number,
  dryRun = false,
  childDatabaseId?: number,
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

  const childDbId = await resolveIssueDatabaseId(runner, repo, childNumber, childDatabaseId);

  await runner("gh", [
    "api",
    `repos/${repo}/issues/${parentNumber}/sub_issues`,
    "--method",
    "POST",
    "-F",
    `sub_issue_id=${childDbId}`,
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
  blockingDatabaseId?: number,
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

  const blockingDbId = await resolveIssueDatabaseId(
    runner,
    repo,
    blockingNumber,
    blockingDatabaseId,
  );

  await runner("gh", [
    "api",
    `repos/${repo}/issues/${blockedNumber}/dependencies/blocked_by`,
    "--method",
    "POST",
    "-F",
    `issue_id=${blockingDbId}`,
  ]);

  return {
    sourceTaskId: blockedTaskId,
    targetTaskId: blockingTaskId,
    kind: "blocked_by",
    action: "linked",
  };
};
