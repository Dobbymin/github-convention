import { redactSecrets } from "@dobbymin/github-convention-core";
import type { FailedTaskContext, FollowUpImpact, FollowUpIssueProposal } from "./types.js";

const IMPACT_TO_PRIORITY: Record<FollowUpImpact, FollowUpIssueProposal["priority"]> = {
  high: "priority:high",
  medium: "priority:medium",
  low: "priority:low",
};

export const buildFollowUpProposal = (
  failedTask: FailedTaskContext,
  impact: FollowUpImpact,
): FollowUpIssueProposal => {
  const safeSummary = redactSecrets(failedTask.failureSummary);
  const filesList =
    failedTask.changedFiles && failedTask.changedFiles.length > 0
      ? failedTask.changedFiles.map((file) => `- \`${file}\``).join("\n")
      : "- None";

  const body = [
    `## Follow-up for Failed Task \`${failedTask.taskId}\``,
    "",
    `- Original Issue: #${failedTask.originalIssueNumber}`,
    ...(failedTask.parentIssueNumber !== undefined
      ? [`- Parent Issue: #${failedTask.parentIssueNumber}`]
      : []),
    `- Attempts Exhausted: ${failedTask.attemptsUsed}`,
    `- Impact Classification: ${impact}`,
    "",
    "### Failure Summary",
    safeSummary,
    "",
    "### Preserved Changed Files",
    filesList,
  ].join("\n");

  return {
    title: `follow-up: ${failedTask.title} (#${failedTask.originalIssueNumber})`,
    body,
    type: "type:bug",
    priority: IMPACT_TO_PRIORITY[impact],
    originalIssueNumber: failedTask.originalIssueNumber,
    ...(failedTask.parentIssueNumber !== undefined
      ? { parentIssueNumber: failedTask.parentIssueNumber }
      : {}),
    requiresApproval: true,
  };
};
