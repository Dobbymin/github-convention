import type { NotificationsConfig } from "../config/types.js";

export type LifecycleNotificationEventType =
  | "run_started"
  | "run_completed"
  | "approval_required"
  | "repeated_worker_failure"
  | "unrecoverable_ci_failure"
  | "pr_ready_for_merge"
  | "deployment_failure";

export type NotificationSeverity = "info" | "warning" | "error";

export interface LifecycleNotificationEvent {
  idempotencyKey: string;
  type: LifecycleNotificationEventType;
  severity: NotificationSeverity;
  runId: string;
  title: string;
  summary: string;
  timestamp: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface NotificationDeliveryRecord {
  channel: "session" | "external";
  provider?: string;
  status: "delivered" | "skipped" | "failed";
  reason?: string;
  attempts: number;
}

export interface ExternalNotificationAdapter {
  provider: string;
  send(
    event: LifecycleNotificationEvent,
    options: { activeExecution: boolean; configuredWorkflow?: boolean },
  ): Promise<void> | void;
}

export type SessionNotificationSink = (event: LifecycleNotificationEvent) => Promise<void> | void;

export interface NotificationDispatchOptions {
  config?: NotificationsConfig;
  activeExecution: boolean;
  configuredWorkflow?: boolean;
  sessionSink?: SessionNotificationSink;
  externalAdapters?: readonly ExternalNotificationAdapter[];
  maxLocalRetries?: number;
}

export interface NotificationDispatchResult {
  event: LifecycleNotificationEvent;
  sanitizedEvent: LifecycleNotificationEvent;
  session: NotificationDeliveryRecord;
  external: NotificationDeliveryRecord;
}
