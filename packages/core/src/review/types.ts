export type SelfReviewSeverity = "critical_blocker" | "non_blocking_improvement";

export type SelfReviewFinding = Readonly<{
  id: string;
  file: string;
  severity: SelfReviewSeverity;
  summary: string;
}>;

export type SelfReviewClassification = Readonly<{
  passed: boolean;
  blockers: readonly SelfReviewFinding[];
  followUpProposals: readonly (SelfReviewFinding & { requiresApproval: true })[];
}>;
