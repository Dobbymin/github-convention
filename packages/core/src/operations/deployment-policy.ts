import { redactSecrets } from "../logging/index.js";
import type {
  DeploymentEvaluation,
  DeploymentHealthCheck,
  DeploymentObservationInput,
  RollbackPlan,
} from "./types.js";

export const DEFAULT_MAX_TRANSIENT_RETRIES = 2;

const buildRollbackPlan = (input: DeploymentObservationInput, reason: string): RollbackPlan => {
  const safeReason = redactSecrets(reason);
  const target = input.previousSuccessfulDeploymentId ?? input.previousSuccessfulCommitSha;
  const steps: string[] = [
    `Inspect failure evidence for environment '${input.environment}' (${safeReason}).`,
    target
      ? `Request explicit operator approval to roll back '${input.environment}' to '${target}'.`
      : `Request explicit operator approval before initiating rollback or hotfix on '${input.environment}'.`,
    "Re-run post-rollback health checks after operator-approved execution.",
  ];

  return {
    requiresApproval: true,
    autoExecute: false,
    environment: input.environment,
    ...(input.previousSuccessfulDeploymentId
      ? { targetDeploymentId: input.previousSuccessfulDeploymentId }
      : {}),
    ...(input.previousSuccessfulCommitSha
      ? { targetCommitSha: input.previousSuccessfulCommitSha }
      : {}),
    reason: safeReason,
    steps,
  };
};

const evaluateHalted = (
  input: DeploymentObservationInput,
  outcome:
    "halted_health_check" | "halted_missing_config" | "halted_retry_exhausted" | "halted_failed",
  retriesUsed: number,
  maxTransientRetries: number,
  failedHealthChecks: readonly DeploymentHealthCheck[],
  missingConfigKeys: readonly string[],
  reason: string,
): DeploymentEvaluation => ({
  environment: input.environment,
  outcome,
  shouldRetry: false,
  haltFurtherActions: true,
  nextAction: "halt",
  retriesUsed,
  maxTransientRetries,
  remainingTransientRetries: Math.max(0, maxTransientRetries - retriesUsed),
  failedHealthChecks,
  missingConfigKeys,
  rollbackPlan: buildRollbackPlan(input, reason),
  summary: redactSecrets(reason),
});

export const evaluateDeploymentStatus = (
  input: DeploymentObservationInput,
): DeploymentEvaluation => {
  const maxTransientRetries = Math.max(
    0,
    input.maxTransientRetries ?? DEFAULT_MAX_TRANSIENT_RETRIES,
  );
  const retriesUsed = Math.max(0, input.transientRetriesUsed ?? 0);
  const missingConfigKeys = [...(input.missingConfigKeys ?? [])];
  const healthChecks = input.healthChecks ?? [];
  const failedHealthChecks = healthChecks.filter((check) => !check.passed);

  if (missingConfigKeys.length > 0 || input.status === "missing_config") {
    const keysLabel = missingConfigKeys.length > 0 ? missingConfigKeys.join(", ") : "unspecified";
    return evaluateHalted(
      input,
      "halted_missing_config",
      retriesUsed,
      maxTransientRetries,
      failedHealthChecks,
      missingConfigKeys,
      `Deployment halted for '${input.environment}': missing configuration or secrets (${keysLabel}).`,
    );
  }

  if (failedHealthChecks.length > 0 || input.status === "health_check_failed") {
    const failedNames = failedHealthChecks.map((check) => check.name).join(", ") || "health check";
    return evaluateHalted(
      input,
      "halted_health_check",
      retriesUsed,
      maxTransientRetries,
      failedHealthChecks,
      missingConfigKeys,
      `Deployment halted for '${input.environment}': health check failed (${failedNames}).`,
    );
  }

  if (input.status === "transient_error") {
    if (retriesUsed < maxTransientRetries) {
      const remainingAfterAttempt = Math.max(0, maxTransientRetries - (retriesUsed + 1));
      const detail = input.errorMessage ? ` (${redactSecrets(input.errorMessage)})` : "";
      return {
        environment: input.environment,
        outcome: "retry_transient",
        shouldRetry: true,
        haltFurtherActions: false,
        nextAction: "retry",
        retriesUsed,
        maxTransientRetries,
        remainingTransientRetries: remainingAfterAttempt,
        failedHealthChecks: [],
        missingConfigKeys: [],
        summary: `Transient deployment error for '${input.environment}'${detail}; retry ${retriesUsed + 1}/${maxTransientRetries} permitted.`,
      };
    }

    return evaluateHalted(
      input,
      "halted_retry_exhausted",
      retriesUsed,
      maxTransientRetries,
      [],
      [],
      `Deployment halted for '${input.environment}': transient retries exhausted (${retriesUsed}/${maxTransientRetries}).`,
    );
  }

  if (input.status === "failed") {
    const detail = input.errorMessage ? `: ${input.errorMessage}` : "";
    return evaluateHalted(
      input,
      "halted_failed",
      retriesUsed,
      maxTransientRetries,
      [],
      [],
      `Deployment failed for '${input.environment}'${detail}.`,
    );
  }

  if (input.status === "pending") {
    return {
      environment: input.environment,
      outcome: "pending",
      shouldRetry: false,
      haltFurtherActions: false,
      nextAction: "wait",
      retriesUsed,
      maxTransientRetries,
      remainingTransientRetries: Math.max(0, maxTransientRetries - retriesUsed),
      failedHealthChecks: [],
      missingConfigKeys: [],
      summary: `Deployment for '${input.environment}' is still pending.`,
    };
  }

  return {
    environment: input.environment,
    outcome: "healthy",
    shouldRetry: false,
    haltFurtherActions: false,
    nextAction: "none",
    retriesUsed,
    maxTransientRetries,
    remainingTransientRetries: Math.max(0, maxTransientRetries - retriesUsed),
    failedHealthChecks: [],
    missingConfigKeys: [],
    summary: `Deployment for '${input.environment}' succeeded and all health checks passed.`,
  };
};
