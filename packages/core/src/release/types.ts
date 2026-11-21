export type SemVerBump = "major" | "minor" | "patch";

export type ReleaseVersionSource = "existing_policy" | "conventional_commits";

export type ReleaseCommitInput = Readonly<{
  sha?: string;
  message: string;
  prNumber?: number;
}>;

export type ParsedConventionalCommit = Readonly<{
  sha?: string;
  prNumber?: number;
  type: string;
  scope?: string;
  breaking: boolean;
  subject: string;
  rawMessage: string;
}>;

export type ReleaseProposalInput = Readonly<{
  currentVersion: string;
  commits: readonly ReleaseCommitInput[];
  existingPolicyVersion?: string;
  existingPolicyTagFormat?: string;
  releaseDate?: string;
  repository?: string;
}>;

export type ReleaseProposal = Readonly<{
  currentVersion: string;
  proposedVersion: string;
  tagName: string;
  bump: SemVerBump;
  versionSource: ReleaseVersionSource;
  commits: readonly ParsedConventionalCommit[];
  breakingChanges: readonly ParsedConventionalCommit[];
  features: readonly ParsedConventionalCommit[];
  fixes: readonly ParsedConventionalCommit[];
  otherCommits: readonly ParsedConventionalCommit[];
  changelog: string;
  releaseNotes: string;
}>;
