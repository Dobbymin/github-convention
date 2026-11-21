import assert from "node:assert/strict";
import test from "node:test";
import {
  NotificationDispatcher,
  REQUIRED_LIFECYCLE_EVENTS,
  sanitizeNotificationEvent,
  type ExternalNotificationAdapter,
  type LifecycleNotificationEvent,
} from "./index.js";

const makeEvent = (
  overrides: Partial<LifecycleNotificationEvent> = {},
): LifecycleNotificationEvent => ({
  idempotencyKey: "run-1:run_started:1",
  type: "run_started",
  severity: "info",
  runId: "run-1",
  title: "Run started",
  summary: "Initialized graph run",
  timestamp: "2026-11-21T12:00:00Z",
  ...overrides,
});

test("REQUIRED_LIFECYCLE_EVENTS covers all required lifecycle event types", async () => {
  const dispatcher = new NotificationDispatcher();
  const seen: string[] = [];

  for (const eventType of REQUIRED_LIFECYCLE_EVENTS) {
    const result = await dispatcher.dispatch(
      makeEvent({
        idempotencyKey: `run-1:${eventType}`,
        type: eventType,
        severity:
          eventType === "deployment_failure" || eventType === "unrecoverable_ci_failure"
            ? "error"
            : "info",
      }),
      {
        activeExecution: true,
        sessionSink: (event) => {
          seen.push(event.type);
        },
      },
    );

    assert.equal(result.session.status, "delivered");
    assert.equal(result.external.status, "skipped");
    assert.equal(result.external.reason, "external_not_opted_in");
  }

  assert.deepEqual(seen, [
    "run_started",
    "run_completed",
    "approval_required",
    "repeated_worker_failure",
    "unrecoverable_ci_failure",
    "pr_ready_for_merge",
    "deployment_failure",
  ]);
});

test("sanitizeNotificationEvent redacts secrets in title, summary, and metadata", () => {
  const sanitized = sanitizeNotificationEvent(
    makeEvent({
      title: "Token ghp_abcdefghijklmnopqrstuvwxyz1234567890 leaked",
      summary: "Authorization: Bearer secret_token_value_1234567890",
      metadata: {
        url: "https://user:pass@example.com/hook",
        attempt: 1,
      },
    }),
  );

  assert.equal(sanitized.title.includes("ghp_"), false);
  assert.equal(sanitized.summary.includes("secret_token_value"), false);
  assert.equal(sanitized.metadata?.url, "https://[REDACTED]:[REDACTED]@example.com/hook");
  assert.equal(sanitized.metadata?.attempt, 1);
});

test("session delivery retries at most twice on transient local failures", async () => {
  const dispatcher = new NotificationDispatcher();
  let calls = 0;

  const recovered = await dispatcher.dispatch(makeEvent(), {
    activeExecution: true,
    sessionSink: () => {
      calls += 1;
      if (calls < 3) {
        throw new Error("transient sink error");
      }
    },
  });

  assert.equal(recovered.session.status, "delivered");
  assert.equal(recovered.session.attempts, 3);

  let alwaysFailCalls = 0;
  const failed = await dispatcher.dispatch(makeEvent({ idempotencyKey: "run-1:fail" }), {
    activeExecution: true,
    sessionSink: () => {
      alwaysFailCalls += 1;
      throw new Error("TOKEN=supersecretvalue12345");
    },
  });

  assert.equal(alwaysFailCalls, 3);
  assert.equal(failed.session.status, "failed");
  assert.equal(failed.session.attempts, 3);
  assert.equal(failed.session.reason?.includes("supersecretvalue12345"), false);
});

test("external adapter never sends without explicit opt-in, provider, adapter, and active execution", async () => {
  const dispatcher = new NotificationDispatcher();
  let sentCount = 0;
  const adapter: ExternalNotificationAdapter = {
    provider: "slack",
    send: () => {
      sentCount += 1;
    },
  };

  const disabled = await dispatcher.dispatch(makeEvent({ idempotencyKey: "k1" }), {
    activeExecution: true,
    config: { session: true, external: { enabled: false, provider: "slack" } },
    externalAdapters: [adapter],
  });
  assert.equal(disabled.external.status, "skipped");
  assert.equal(disabled.external.reason, "external_not_opted_in");

  const missingProvider = await dispatcher.dispatch(makeEvent({ idempotencyKey: "k2" }), {
    activeExecution: true,
    config: { session: true, external: { enabled: true, provider: null } },
    externalAdapters: [adapter],
  });
  assert.equal(missingProvider.external.status, "skipped");
  assert.equal(missingProvider.external.reason, "external_provider_missing");

  const inactive = await dispatcher.dispatch(makeEvent({ idempotencyKey: "k3" }), {
    activeExecution: false,
    configuredWorkflow: false,
    config: { session: true, external: { enabled: true, provider: "slack" } },
    externalAdapters: [adapter],
  });
  assert.equal(inactive.external.status, "skipped");
  assert.equal(inactive.external.reason, "not_active_execution");

  const unregistered = await dispatcher.dispatch(makeEvent({ idempotencyKey: "k4" }), {
    activeExecution: true,
    config: { session: true, external: { enabled: true, provider: "webhook" } },
    externalAdapters: [adapter],
  });
  assert.equal(unregistered.external.status, "skipped");
  assert.equal(unregistered.external.reason, "external_adapter_not_registered");

  assert.equal(sentCount, 0);
});

test("external adapter sends once when opted in and prevents duplicate sends on failure or replay", async () => {
  const dispatcher = new NotificationDispatcher();
  const sent: LifecycleNotificationEvent[] = [];
  const okAdapter: ExternalNotificationAdapter = {
    provider: "slack",
    send: (event) => {
      sent.push(event);
    },
  };

  const first = await dispatcher.dispatch(
    makeEvent({
      idempotencyKey: "run-2:approval_required",
      type: "approval_required",
      severity: "warning",
      title: "Approval needed with ghp_abcdefghijklmnopqrstuvwxyz1234567890",
    }),
    {
      activeExecution: true,
      config: { session: true, external: { enabled: true, provider: "slack" } },
      externalAdapters: [okAdapter],
    },
  );
  assert.equal(first.external.status, "delivered");
  assert.equal(first.external.attempts, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.title.includes("ghp_"), false);

  const duplicate = await dispatcher.dispatch(
    makeEvent({
      idempotencyKey: "run-2:approval_required",
      type: "approval_required",
    }),
    {
      activeExecution: true,
      config: { session: true, external: { enabled: true, provider: "slack" } },
      externalAdapters: [okAdapter],
    },
  );
  assert.equal(duplicate.external.status, "skipped");
  assert.equal(duplicate.external.reason, "duplicate_idempotency_key");
  assert.equal(sent.length, 1);

  let failAttempts = 0;
  const failingAdapter: ExternalNotificationAdapter = {
    provider: "slack",
    send: () => {
      failAttempts += 1;
      throw new Error("webhook timeout");
    },
  };

  const failedSend = await dispatcher.dispatch(makeEvent({ idempotencyKey: "run-2:ci_fail" }), {
    activeExecution: false,
    configuredWorkflow: true,
    config: { session: true, external: { enabled: true, provider: "slack" } },
    externalAdapters: [failingAdapter],
  });
  assert.equal(failedSend.external.status, "failed");
  assert.equal(failedSend.external.attempts, 1);
  assert.equal(failAttempts, 1);

  const replayAfterFailure = await dispatcher.dispatch(
    makeEvent({ idempotencyKey: "run-2:ci_fail" }),
    {
      activeExecution: false,
      configuredWorkflow: true,
      config: { session: true, external: { enabled: true, provider: "slack" } },
      externalAdapters: [failingAdapter],
    },
  );
  assert.equal(replayAfterFailure.external.status, "skipped");
  assert.equal(replayAfterFailure.external.reason, "duplicate_idempotency_key");
  assert.equal(failAttempts, 1);
});
