import type { SelfReviewClassification, SelfReviewFinding } from "./types.js";

export const classifySelfReviewFindings = (
  findings: readonly SelfReviewFinding[],
): SelfReviewClassification => {
  const blockers = findings.filter((item) => item.severity === "critical_blocker");
  const followUpProposals = findings
    .filter((item) => item.severity === "non_blocking_improvement")
    .map((item) => ({ ...item, requiresApproval: true as const }));

  return {
    passed: blockers.length === 0,
    blockers,
    followUpProposals,
  };
};
