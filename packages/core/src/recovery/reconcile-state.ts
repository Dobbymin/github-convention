import { StateManager } from "../state/state-manager.js";
import type { RecoveryResult, RemoteRunSnapshot } from "./types.js";

export const recoverExecutionState = async (
  stateManager: StateManager,
  runId: string,
  remoteSnapshot: RemoteRunSnapshot,
): Promise<RecoveryResult> => {
  const ambiguousReasons: string[] = [];
  const skippedCompletedTaskIds: string[] = [];
  const resumableTaskIds: string[] = [];
  const unapprovedActionIds: string[] = [];

  const state = await stateManager.transition(runId, (current) => {
    if (remoteSnapshot.parentIssueStatus && current.parentIssue) {
      current.parentIssue.status = remoteSnapshot.parentIssueStatus;
    }

    for (const approval of current.approvals) {
      if (approval.status === "unknown") {
        approval.status = "pending";
      }
      if (approval.status !== "approved") {
        unapprovedActionIds.push(approval.approvalId);
      }
    }

    for (const task of current.tasks) {
      const remote = remoteSnapshot.tasks.find((item) => item.stableId === task.stableId);

      if (remote?.ownershipVerified === false) {
        ambiguousReasons.push(
          `Task '${task.stableId}' has ambiguous remote or workspace ownership.`,
        );
        continue;
      }

      if (
        remote?.issueNumber !== undefined &&
        task.issueNumber !== undefined &&
        task.issueNumber !== null &&
        remote.issueNumber !== task.issueNumber
      ) {
        ambiguousReasons.push(
          `Task '${task.stableId}' issue mismatch (local #${task.issueNumber} vs remote #${remote.issueNumber}).`,
        );
        continue;
      }

      if (remote) {
        if (remote.issueStatus === "closed" && remote.prStatus === "merged") {
          task.status = "completed";
        } else if (remote.issueStatus === "open" && task.status === "completed") {
          task.status = "in_progress";
        }
      }

      if (task.status === "completed") {
        skippedCompletedTaskIds.push(task.stableId);
      } else if (task.status !== "cancelled" && task.status !== "failed") {
        resumableTaskIds.push(task.stableId);
      }
    }
  });

  return {
    runId,
    status: ambiguousReasons.length > 0 ? "halted_ambiguous" : "resumed",
    skippedCompletedTaskIds,
    resumableTaskIds,
    unapprovedActionIds,
    ambiguousReasons,
    state,
  };
};
