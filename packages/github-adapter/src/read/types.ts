import type { GhCommandRunner } from "../auth/types.js";

export type GitHubReadAdapterOptions = Readonly<{
  repo?: string;
  runner?: GhCommandRunner;
}>;

export type RepoMetadata = Readonly<{
  name: string;
  owner: string;
  nameWithOwner: string;
  defaultBranch: string;
  isPrivate: boolean;
  url: string;
}>;

export type GitHubLabel = Readonly<{
  name: string;
  description?: string;
  color: string;
  isDefault?: boolean;
}>;

export type GitHubIssue = Readonly<{
  number: number;
  title: string;
  body: string;
  state: string;
  labels: readonly string[];
  url: string;
  createdAt?: string;
  updatedAt?: string;
}>;

export type GitHubPullRequest = Readonly<{
  number: number;
  title: string;
  state: string;
  headRefName: string;
  baseRefName: string;
  url: string;
  isDraft?: boolean;
  labels: readonly string[];
}>;

export type ListIssuesOptions = Readonly<{
  state?: "open" | "closed" | "all";
  limit?: number;
}>;

export type ListPullRequestsOptions = Readonly<{
  state?: "open" | "closed" | "merged" | "all";
  limit?: number;
}>;

export type TemplateLabel = Readonly<{
  name: string;
  description: string;
  color: string;
  category: string;
  applicability?: string;
  required?: boolean;
  migrated_from?: readonly string[];
}>;

export type CompatibleLabelMatch = Readonly<{
  existing: GitHubLabel;
  template: TemplateLabel;
  matchType: "exact" | "migrated_from";
}>;

export type ConflictingLabelMatch = Readonly<{
  existing: GitHubLabel;
  template: TemplateLabel;
  reasons: readonly string[];
}>;

export type DeprecatedLabelCandidate = Readonly<{
  label: GitHubLabel;
  reason: string;
}>;

export type DuplicateLabelCandidate = Readonly<{
  normalizedName: string;
  labels: readonly GitHubLabel[];
  reason: string;
}>;

export type LabelReconciliationResult = Readonly<{
  compatible: readonly CompatibleLabelMatch[];
  missing: readonly TemplateLabel[];
  conflicting: readonly ConflictingLabelMatch[];
  deprecatedCandidates: readonly DeprecatedLabelCandidate[];
  duplicateCandidates: readonly DuplicateLabelCandidate[];
}>;
