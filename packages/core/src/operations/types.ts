export type DeploymentObservationStatus =
  "succeeded" | "pending" | "transient_error" | "health_check_failed" | "missing_config" | "failed";

export type DeploymentHealthCheck = Readonly<{
  name: string;
  passed: boolean;
  statusCode?: number;
  detail?: string;
  url?: string;
}>;

export type DeploymentObservationInput = Readonly<{
  environment: string;
  deploymentId?: string;
  commitSha?: string;
  status: DeploymentObservationStatus;
  transientRetriesUsed?: number;
  maxTransientRetries?: number;
  errorMessage?: string;
  missingConfigKeys?: readonly string[];
  healthChecks?: readonly DeploymentHealthCheck[];
  previousSuccessfulDeploymentId?: string;
  previousSuccessfulCommitSha?: string;
}>;

export type RollbackPlan = Readonly<{
  requiresApproval: true;
  autoExecute: false;
  environment: string;
  targetDeploymentId?: string;
  targetCommitSha?: string;
  reason: string;
  steps: readonly string[];
}>;

export type DeploymentAction = "none" | "wait" | "retry" | "halt";

export type DeploymentOutcome =
  | "healthy"
  | "pending"
  | "retry_transient"
  | "halted_health_check"
  | "halted_missing_config"
  | "halted_retry_exhausted"
  | "halted_failed";

export type DeploymentEvaluation = Readonly<{
  environment: string;
  outcome: DeploymentOutcome;
  shouldRetry: boolean;
  haltFurtherActions: boolean;
  nextAction: DeploymentAction;
  retriesUsed: number;
  maxTransientRetries: number;
  remainingTransientRetries: number;
  failedHealthChecks: readonly DeploymentHealthCheck[];
  missingConfigKeys: readonly string[];
  rollbackPlan?: RollbackPlan;
  summary: string;
}>;
