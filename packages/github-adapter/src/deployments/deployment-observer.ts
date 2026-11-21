import { redactSecrets } from "@dobbymin/github-convention-core";
import type { GhCommandRunner } from "../auth/types.js";

export type ObservedDeploymentStatus =
  "succeeded" | "pending" | "transient_error" | "health_check_failed" | "missing_config" | "failed";

export type ObservedHealthCheck = Readonly<{
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
  status: ObservedDeploymentStatus;
  transientRetriesUsed?: number;
  maxTransientRetries?: number;
  errorMessage?: string;
  missingConfigKeys?: readonly string[];
  healthChecks?: readonly ObservedHealthCheck[];
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

export type DeploymentEvaluation = Readonly<{
  environment: string;
  outcome:
    | "healthy"
    | "pending"
    | "retry_transient"
    | "halted_health_check"
    | "halted_missing_config"
    | "halted_retry_exhausted"
    | "halted_failed";
  shouldRetry: boolean;
  haltFurtherActions: boolean;
  nextAction: "none" | "wait" | "retry" | "halt";
  retriesUsed: number;
  maxTransientRetries: number;
  remainingTransientRetries: number;
  failedHealthChecks: readonly ObservedHealthCheck[];
  missingConfigKeys: readonly string[];
  rollbackPlan?: RollbackPlan;
  summary: string;
}>;

export type ObserveDeploymentOptions = Readonly<{
  owner: string;
  repo: string;
  environment: string;
  runner: GhCommandRunner;
  transientRetriesUsed?: number;
  maxTransientRetries?: number;
  missingConfigKeys?: readonly string[];
  healthChecks?: readonly ObservedHealthCheck[];
  healthChecker?: (targetUrl?: string) => Promise<readonly ObservedHealthCheck[]>;
  evaluator?: (input: DeploymentObservationInput) => DeploymentEvaluation;
}>;

type GhDeployment = {
  id?: number | string;
  sha?: string;
  environment?: string;
};

type GhDeploymentStatus = {
  state?: string;
  description?: string;
  environment_url?: string;
  target_url?: string;
};

const DEFAULT_MAX_TRANSIENT_RETRIES = 2;

const TRANSIENT_ERROR_PATTERN =
  /etimedout|econnreset|eai_again|timeout|timed out|502|503|504|service unavailable|bad gateway|network/i;

const isTransientMessage = (message: string): boolean => TRANSIENT_ERROR_PATTERN.test(message);

const buildRollbackPlan = (input: DeploymentObservationInput, reason: string): RollbackPlan => {
  const safeReason = redactSecrets(reason);
  const target = input.previousSuccessfulDeploymentId ?? input.previousSuccessfulCommitSha;
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
    steps: [
      `Inspect failure evidence for environment '${input.environment}' (${safeReason}).`,
      target
        ? `Request explicit operator approval to roll back '${input.environment}' to '${target}'.`
        : `Request explicit operator approval before initiating rollback or hotfix on '${input.environment}'.`,
      "Re-run post-rollback health checks after operator-approved execution.",
    ],
  };
};

const evaluateDeploymentStatusLocal = (input: DeploymentObservationInput): DeploymentEvaluation => {
  const maxTransientRetries = Math.max(
    0,
    input.maxTransientRetries ?? DEFAULT_MAX_TRANSIENT_RETRIES,
  );
  const retriesUsed = Math.max(0, input.transientRetriesUsed ?? 0);
  const missingConfigKeys = [...(input.missingConfigKeys ?? [])];
  const failedHealthChecks = (input.healthChecks ?? []).filter((check) => !check.passed);

  if (missingConfigKeys.length > 0 || input.status === "missing_config") {
    const reason = `Deployment halted for '${input.environment}': missing configuration or secrets (${missingConfigKeys.join(", ") || "unspecified"}).`;
    return {
      environment: input.environment,
      outcome: "halted_missing_config",
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
    };
  }

  if (failedHealthChecks.length > 0 || input.status === "health_check_failed") {
    const failedNames = failedHealthChecks.map((check) => check.name).join(", ") || "health check";
    const reason = `Deployment halted for '${input.environment}': health check failed (${failedNames}).`;
    return {
      environment: input.environment,
      outcome: "halted_health_check",
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
    };
  }

  if (input.status === "transient_error") {
    if (retriesUsed < maxTransientRetries) {
      const detail = input.errorMessage ? ` (${redactSecrets(input.errorMessage)})` : "";
      return {
        environment: input.environment,
        outcome: "retry_transient",
        shouldRetry: true,
        haltFurtherActions: false,
        nextAction: "retry",
        retriesUsed,
        maxTransientRetries,
        remainingTransientRetries: Math.max(0, maxTransientRetries - (retriesUsed + 1)),
        failedHealthChecks: [],
        missingConfigKeys: [],
        summary: `Transient deployment error for '${input.environment}'${detail}; retry ${retriesUsed + 1}/${maxTransientRetries} permitted.`,
      };
    }

    const reason = `Deployment halted for '${input.environment}': transient retries exhausted (${retriesUsed}/${maxTransientRetries}).`;
    return {
      environment: input.environment,
      outcome: "halted_retry_exhausted",
      shouldRetry: false,
      haltFurtherActions: true,
      nextAction: "halt",
      retriesUsed,
      maxTransientRetries,
      remainingTransientRetries: 0,
      failedHealthChecks: [],
      missingConfigKeys: [],
      rollbackPlan: buildRollbackPlan(input, reason),
      summary: redactSecrets(reason),
    };
  }

  if (input.status === "failed") {
    const detail = input.errorMessage ? `: ${input.errorMessage}` : "";
    const reason = `Deployment failed for '${input.environment}'${detail}.`;
    return {
      environment: input.environment,
      outcome: "halted_failed",
      shouldRetry: false,
      haltFurtherActions: true,
      nextAction: "halt",
      retriesUsed,
      maxTransientRetries,
      remainingTransientRetries: Math.max(0, maxTransientRetries - retriesUsed),
      failedHealthChecks: [],
      missingConfigKeys: [],
      rollbackPlan: buildRollbackPlan(input, reason),
      summary: redactSecrets(reason),
    };
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

const mapGhStateToStatus = (
  state: string | undefined,
  description: string | undefined,
): ObservedDeploymentStatus => {
  const normalized = (state ?? "").toLowerCase();
  if (normalized === "success") {
    return "succeeded";
  }
  if (
    normalized === "pending" ||
    normalized === "queued" ||
    normalized === "in_progress" ||
    normalized === ""
  ) {
    return "pending";
  }
  if (description && isTransientMessage(description)) {
    return "transient_error";
  }
  return "failed";
};

export const observeDeploymentWithRunner = async (
  options: ObserveDeploymentOptions,
): Promise<DeploymentEvaluation> => {
  const evaluate = options.evaluator ?? evaluateDeploymentStatusLocal;

  try {
    const encodedEnv = encodeURIComponent(options.environment);
    const deploymentsRaw = await options.runner("gh", [
      "api",
      `repos/${options.owner}/${options.repo}/deployments?environment=${encodedEnv}&per_page=5`,
    ]);

    const deployments = JSON.parse(deploymentsRaw || "[]") as GhDeployment[];
    const latest = deployments[0];
    if (!latest?.id) {
      return evaluate({
        environment: options.environment,
        status: "pending",
        transientRetriesUsed: options.transientRetriesUsed,
        maxTransientRetries: options.maxTransientRetries,
        missingConfigKeys: options.missingConfigKeys,
        healthChecks: options.healthChecks,
      });
    }

    const statusesRaw = await options.runner("gh", [
      "api",
      `repos/${options.owner}/${options.repo}/deployments/${String(latest.id)}/statuses?per_page=1`,
    ]);
    const statuses = JSON.parse(statusesRaw || "[]") as GhDeploymentStatus[];
    const latestStatus = statuses[0];
    const targetUrl = latestStatus?.environment_url ?? latestStatus?.target_url;
    const healthChecks =
      options.healthChecks ??
      (options.healthChecker ? await options.healthChecker(targetUrl) : undefined);

    const previous = deployments[1];
    return evaluate({
      environment: options.environment,
      deploymentId: String(latest.id),
      commitSha: latest.sha,
      status: mapGhStateToStatus(latestStatus?.state, latestStatus?.description),
      transientRetriesUsed: options.transientRetriesUsed,
      maxTransientRetries: options.maxTransientRetries,
      errorMessage: latestStatus?.description,
      missingConfigKeys: options.missingConfigKeys,
      healthChecks,
      ...(previous?.id ? { previousSuccessfulDeploymentId: String(previous.id) } : {}),
      ...(previous?.sha ? { previousSuccessfulCommitSha: previous.sha } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return evaluate({
      environment: options.environment,
      status: isTransientMessage(message) ? "transient_error" : "failed",
      transientRetriesUsed: options.transientRetriesUsed,
      maxTransientRetries: options.maxTransientRetries,
      errorMessage: message,
      missingConfigKeys: options.missingConfigKeys,
      healthChecks: options.healthChecks,
    });
  }
};
