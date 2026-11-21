export type StraightforwardReviewCategory = "naming" | "style" | "exception" | "test";

export type ApprovalRequiredReviewCategory =
  "architecture" | "business_logic" | "requirements" | "ambiguous";

export type ReviewCommentCategory = StraightforwardReviewCategory | ApprovalRequiredReviewCategory;

export type ReviewCommentKind = "straightforward" | "approval_required";

export type ReviewCommentInput = Readonly<{
  body: string;
  path?: string;
  line?: number;
}>;

export type ReviewCommentClassification = Readonly<{
  category: ReviewCommentCategory;
  kind: ReviewCommentKind;
  requiresApproval: boolean;
  reason: string;
  matchedSignals: readonly string[];
}>;

export type ThreadResolutionInput = Readonly<{
  threadId: string;
  classification: ReviewCommentClassification;
  addressed: boolean;
  verified: boolean;
  alreadyResolved?: boolean;
}>;

export type ThreadResolutionDecision = Readonly<{
  threadId: string;
  resolve: boolean;
  reason: string;
}>;

export type CiFailureCategory =
  | "permission"
  | "credentials"
  | "missing_secret"
  | "external_config"
  | "infra_outage"
  | "transient_network"
  | "code_error"
  | "lint_error"
  | "type_error"
  | "test_failure"
  | "unknown";

export type CiFailureInput = Readonly<{
  checkName?: string;
  conclusion?: string;
  summary?: string;
  logExcerpt?: string;
}>;

export type CiFailureClassification = Readonly<{
  category: CiFailureCategory;
  retryable: boolean;
  maxRetries: number;
  requiresUserInput: boolean;
  reason: string;
  signature: string;
  matchedSignals: readonly string[];
}>;

export type CiRetryAction =
  "retry" | "pause_for_user" | "stop_max_retries" | "stop_repeated_failure";

export type CiRetryEvaluationInput = Readonly<{
  classification: CiFailureClassification;
  retriesUsed: number;
  previousSignatures?: readonly string[];
}>;

export type CiRetryDecision = Readonly<{
  shouldRetry: boolean;
  action: CiRetryAction;
  requiresUserInput: boolean;
  nextAttempt?: number;
  remainingRetries: number;
  reason: string;
}>;
