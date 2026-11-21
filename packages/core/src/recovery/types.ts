import type { ExecutionState } from "../state/types.js";

export type RemoteTaskSnapshot = Readonly<{
  stableId: string;
  issueNumber?: number;
  issueStatus?: "open" | "closed";
  prStatus?: "none" | "open" | "merged" | "closed";
  ownershipVerified?: boolean;
}>;

export type RemoteRunSnapshot = Readonly<{
  parentIssueStatus?: "open" | "closed";
  tasks: readonly RemoteTaskSnapshot[];
}>;

export type RecoveryResult = Readonly<{
  runId: string;
  status: "resumed" | "halted_ambiguous";
  skippedCompletedTaskIds: readonly string[];
  resumableTaskIds: readonly string[];
  unapprovedActionIds: readonly string[];
  ambiguousReasons: readonly string[];
  state: ExecutionState;
}>;
