export type WorktreeOwnershipRecord = Readonly<{
  schemaVersion: 1;
  taskId: string;
  branchName: string;
  worktreePath: string;
  createdAt: string;
  owner: "orchestrator";
}>;

export type WorktreeInspection = Readonly<{
  exists: boolean;
  ownedByNode: boolean;
  dirty: boolean;
  statusLines: readonly string[];
  worktreePath: string;
}>;

export type WorktreeRemovalResult = Readonly<{
  removed: boolean;
  approvalRequired: boolean;
  worktreePath: string;
  reason: string;
}>;
