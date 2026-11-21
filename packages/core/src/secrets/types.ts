export type SecretScanInputFile = Readonly<{
  path: string;
  content: string;
}>;

export type SecretAllowlistRule = Readonly<{
  path: string;
  fingerprint: string;
  reason: string;
}>;

export type SecretFinding = Readonly<{
  path: string;
  line: number;
  ruleId: string;
  fingerprint: string;
  redactedPreview: string;
  allowlisted: boolean;
}>;

export type SecretScanResult = Readonly<{
  clean: boolean;
  blocked: boolean;
  findings: readonly SecretFinding[];
  blockingFindings: readonly SecretFinding[];
}>;
