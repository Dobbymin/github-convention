export type RunStatus =
  | "planned"
  | "awaiting_approval"
  | "approved"
  | "in_progress"
  | "blocked"
  | "failed"
  | "completed"
  | "archived"
  | "cancelled";

export type TaskStatus =
  | "draft"
  | "awaiting_approval"
  | "approved"
  | "ready"
  | "blocked"
  | "assigned"
  | "in_progress"
  | "review"
  | "failed"
  | "completed"
  | "cancelled";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "unknown";

export interface RepositoryMetadata {
  root: string;
  owner?: string | null;
  name: string;
  defaultBranch: string;
  [key: string]: unknown;
}

export interface ParentIssueReference {
  number: number;
  url: string;
  status?: "open" | "closed" | "unknown";
  [key: string]: unknown;
}

export interface ApprovalRecord {
  approvalId: string;
  action: string;
  status: ApprovalStatus;
  approvedAt?: string | null;
  source?: string | null;
  [key: string]: unknown;
}

export interface TaskRecord {
  stableId: string;
  issueNumber?: number | null;
  title: string;
  status: TaskStatus;
  dependsOn: string[];
  worker?: Record<string, unknown> | null;
  workspace?: Record<string, unknown> | null;
  changedFiles?: string[];
  tests?: Record<string, unknown>;
  lastCheckpoint?: string | null;
  [key: string]: unknown;
}

export interface ExecutionState {
  schemaVersion: number;
  runId: string;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  repository: RepositoryMetadata;
  parentIssue?: ParentIssueReference | null;
  approvals: ApprovalRecord[];
  tasks: TaskRecord[];
  remoteSync?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}
