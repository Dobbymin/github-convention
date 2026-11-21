import type {
  ChildIssueSnapshot,
  ParentIssueSnapshot,
  ParentLifecycleDecision,
  TaskDependencyRef,
  TaskReadinessEvaluation,
  UpstreamTaskSnapshot,
} from "./types.js";

export const evaluateParentLifecycle = (
  parent: ParentIssueSnapshot,
  children: readonly ChildIssueSnapshot[],
): ParentLifecycleDecision => {
  const openChildren = children.filter((child) => child.state === "open");
  const openChildTaskIds = openChildren.map((child) => child.taskId);

  if (parent.state === "open") {
    if (children.length > 0 && openChildren.length === 0) {
      return {
        parentIssueNumber: parent.issueNumber,
        currentState: "open",
        desiredState: "closed",
        action: "close_parent",
        openChildTaskIds: [],
        reason: "All child sub-issues are closed; Parent is eligible to close.",
      };
    }

    return {
      parentIssueNumber: parent.issueNumber,
      currentState: "open",
      desiredState: "open",
      action: "keep_open",
      openChildTaskIds,
      reason:
        children.length === 0
          ? "Parent has no child sub-issues yet; keeping open."
          : `${openChildren.length} child sub-issue(s) remain open.`,
    };
  }

  if (openChildren.length > 0) {
    return {
      parentIssueNumber: parent.issueNumber,
      currentState: "closed",
      desiredState: "open",
      action: "reopen_parent",
      openChildTaskIds,
      reason: `${openChildren.length} open child sub-issue(s) linked to closed Parent; reopen required.`,
    };
  }

  return {
    parentIssueNumber: parent.issueNumber,
    currentState: "closed",
    desiredState: "closed",
    action: "keep_closed",
    openChildTaskIds: [],
    reason: "Parent and all child sub-issues remain closed.",
  };
};

export const evaluateTaskReadiness = (
  taskId: string,
  dependencies: readonly TaskDependencyRef[],
  upstreamById: Readonly<Record<string, UpstreamTaskSnapshot>>,
): TaskReadinessEvaluation => {
  const waitingOnTaskIds: string[] = [];

  for (const dep of dependencies) {
    const upstream = upstreamById[dep.taskId];
    if (!upstream) {
      waitingOnTaskIds.push(dep.taskId);
      continue;
    }

    if (dep.kind === "contract") {
      // Documented stable contract dependencies allow parallel readiness without waiting for PR merge.
      continue;
    }

    const codeComplete = upstream.prState === "merged" && upstream.issueState === "closed";
    if (!codeComplete) {
      waitingOnTaskIds.push(dep.taskId);
    }
  }

  if (waitingOnTaskIds.length > 0) {
    return {
      taskId,
      ready: false,
      waitingOnTaskIds,
      reason: `Waiting for upstream PR merge and issue closure on: ${waitingOnTaskIds.join(", ")}`,
    };
  }

  return {
    taskId,
    ready: true,
    waitingOnTaskIds: [],
    reason: "All code and contract dependencies are satisfied.",
  };
};
