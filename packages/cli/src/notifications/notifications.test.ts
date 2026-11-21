import assert from "node:assert/strict";
import test from "node:test";
import {
  NotificationDispatcher,
  type LifecycleNotificationEvent,
} from "@dobbymin/github-convention-core";
import { createCliSessionNotifier, formatSessionNotification } from "./index.js";

const sampleEvent: LifecycleNotificationEvent = {
  idempotencyKey: "run-99:pr_ready_for_merge",
  type: "pr_ready_for_merge",
  severity: "info",
  runId: "run-99",
  title: "PR #42 ready",
  summary: "All CI checks passed",
  timestamp: "2026-11-21T12:10:00Z",
};

test("formatSessionNotification formats text and json lines", () => {
  const textLine = formatSessionNotification(sampleEvent, "text");
  assert.equal(textLine, "[INFO] pr_ready_for_merge (run-99): PR #42 ready — All CI checks passed");

  const jsonLine = formatSessionNotification(sampleEvent, "json");
  const parsed = JSON.parse(jsonLine) as { kind: string; event: LifecycleNotificationEvent };
  assert.equal(parsed.kind, "notification");
  assert.equal(parsed.event.type, "pr_ready_for_merge");
});

test("createCliSessionNotifier never pollutes stdout in json mode", async () => {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  const notifier = createCliSessionNotifier({
    format: "json",
    writeStdout: (chunk) => stdoutChunks.push(chunk),
    writeStderr: (chunk) => stderrChunks.push(chunk),
  });

  const dispatcher = new NotificationDispatcher();
  const result = await dispatcher.dispatch(sampleEvent, {
    activeExecution: true,
    sessionSink: notifier.sink,
  });

  assert.equal(result.session.status, "delivered");
  assert.equal(stdoutChunks.length, 0);
  assert.equal(stderrChunks.length, 1);
  assert.equal(notifier.events.length, 1);

  const parsed = JSON.parse(stderrChunks[0] ?? "") as { kind: string; event: { runId: string } };
  assert.equal(parsed.kind, "notification");
  assert.equal(parsed.event.runId, "run-99");
});

test("createCliSessionNotifier writes text notifications to stderr or fallback stdout", async () => {
  const stdoutChunks: string[] = [];
  const notifier = createCliSessionNotifier({
    format: "text",
    writeStdout: (chunk) => stdoutChunks.push(chunk),
  });

  const dispatcher = new NotificationDispatcher();
  await dispatcher.dispatch(
    {
      ...sampleEvent,
      idempotencyKey: "run-99:deployment_failure",
      type: "deployment_failure",
      severity: "error",
      title: "Deploy failed",
      summary: "Health check returned 503",
    },
    {
      activeExecution: true,
      sessionSink: notifier.sink,
    },
  );

  assert.equal(stdoutChunks.length, 1);
  assert.match(stdoutChunks[0] ?? "", /^\[ERROR\] deployment_failure \(run-99\): Deploy failed/);
});
