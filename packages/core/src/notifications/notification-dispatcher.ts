import { redactSecrets } from "../logging/redactor.js";
import type {
  ExternalNotificationAdapter,
  LifecycleNotificationEvent,
  LifecycleNotificationEventType,
  NotificationDeliveryRecord,
  NotificationDispatchOptions,
  NotificationDispatchResult,
} from "./types.js";

export const REQUIRED_LIFECYCLE_EVENTS: readonly LifecycleNotificationEventType[] = [
  "run_started",
  "run_completed",
  "approval_required",
  "repeated_worker_failure",
  "unrecoverable_ci_failure",
  "pr_ready_for_merge",
  "deployment_failure",
] as const;

const DEFAULT_MAX_LOCAL_RETRIES = 2;

export const sanitizeNotificationEvent = (
  event: LifecycleNotificationEvent,
): LifecycleNotificationEvent => {
  const sanitizedMetadata = event.metadata
    ? Object.fromEntries(
        Object.entries(event.metadata).map(([key, value]) => [
          key,
          typeof value === "string" ? redactSecrets(value) : value,
        ]),
      )
    : undefined;

  return {
    ...event,
    title: redactSecrets(event.title),
    summary: redactSecrets(event.summary),
    ...(sanitizedMetadata !== undefined ? { metadata: sanitizedMetadata } : {}),
  };
};

export class NotificationDispatcher {
  private readonly externalAttemptedKeys = new Set<string>();

  async dispatch(
    event: LifecycleNotificationEvent,
    options: NotificationDispatchOptions,
  ): Promise<NotificationDispatchResult> {
    const sanitizedEvent = sanitizeNotificationEvent(event);
    const session = await this.deliverSession(sanitizedEvent, options);
    const external = await this.deliverExternal(sanitizedEvent, options);

    return {
      event,
      sanitizedEvent,
      session,
      external,
    };
  }

  private async deliverSession(
    event: LifecycleNotificationEvent,
    options: NotificationDispatchOptions,
  ): Promise<NotificationDeliveryRecord> {
    if (options.config?.session === false) {
      return {
        channel: "session",
        status: "skipped",
        reason: "session_disabled",
        attempts: 0,
      };
    }

    if (!options.sessionSink) {
      return {
        channel: "session",
        status: "skipped",
        reason: "session_sink_missing",
        attempts: 0,
      };
    }

    const maxRetries = Math.max(
      0,
      Math.min(DEFAULT_MAX_LOCAL_RETRIES, options.maxLocalRetries ?? DEFAULT_MAX_LOCAL_RETRIES),
    );
    const maxAttempts = 1 + maxRetries;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await options.sessionSink(event);
        return {
          channel: "session",
          status: "delivered",
          attempts: attempt,
        };
      } catch (err) {
        lastError = err;
      }
    }

    return {
      channel: "session",
      status: "failed",
      reason: redactSecrets(lastError instanceof Error ? lastError.message : String(lastError)),
      attempts: maxAttempts,
    };
  }

  private async deliverExternal(
    event: LifecycleNotificationEvent,
    options: NotificationDispatchOptions,
  ): Promise<NotificationDeliveryRecord> {
    const externalConfig = options.config?.external;
    if (externalConfig?.enabled !== true) {
      return {
        channel: "external",
        status: "skipped",
        reason: "external_not_opted_in",
        attempts: 0,
      };
    }

    const provider =
      typeof externalConfig.provider === "string" ? externalConfig.provider.trim() : "";
    if (!provider) {
      return {
        channel: "external",
        status: "skipped",
        reason: "external_provider_missing",
        attempts: 0,
      };
    }

    if (!options.activeExecution && options.configuredWorkflow !== true) {
      return {
        channel: "external",
        provider,
        status: "skipped",
        reason: "not_active_execution",
        attempts: 0,
      };
    }

    const adapter = this.findAdapter(options.externalAdapters, provider);
    if (!adapter) {
      return {
        channel: "external",
        provider,
        status: "skipped",
        reason: "external_adapter_not_registered",
        attempts: 0,
      };
    }

    if (this.externalAttemptedKeys.has(event.idempotencyKey)) {
      return {
        channel: "external",
        provider,
        status: "skipped",
        reason: "duplicate_idempotency_key",
        attempts: 0,
      };
    }

    this.externalAttemptedKeys.add(event.idempotencyKey);

    try {
      await adapter.send(event, {
        activeExecution: options.activeExecution,
        configuredWorkflow: options.configuredWorkflow,
      });
      return {
        channel: "external",
        provider,
        status: "delivered",
        attempts: 1,
      };
    } catch (err) {
      return {
        channel: "external",
        provider,
        status: "failed",
        reason: redactSecrets(err instanceof Error ? err.message : String(err)),
        attempts: 1,
      };
    }
  }

  private findAdapter(
    adapters: readonly ExternalNotificationAdapter[] | undefined,
    provider: string,
  ): ExternalNotificationAdapter | undefined {
    return adapters?.find((adapter) => adapter.provider === provider);
  }
}
