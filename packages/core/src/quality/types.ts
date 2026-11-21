export type DetectedQualityTools = Readonly<{
  scripts: Readonly<Record<string, string>>;
  hasHooks: boolean;
  hasCiWorkflows: boolean;
  hasSecretScanner: boolean;
  installProposal?: Readonly<{
    tool: string;
    requiresApproval: true;
    reason: string;
  }>;
}>;

export type QualityGateInputs = Readonly<{
  acceptanceCriteriaPassed: boolean;
  testsPassed: boolean;
  secretScanClean: boolean;
  selfReviewPassed: boolean;
  rebasedOnLatestBase: boolean;
}>;

export type QualityGateResult = Readonly<{
  passed: boolean;
  failedGates: readonly string[];
}>;
