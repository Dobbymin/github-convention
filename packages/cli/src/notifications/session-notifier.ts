import type { LifecycleNotificationEvent, SessionNotificationSink } from "@github-convention/core";
import type { OutputFormat } from "../options.js";

const LEVEL_LABELS: Record<LifecycleNotificationEvent["severity"], string> = {
  info: "INFO",
  warning: "WARN",
  error: "ERROR",
};

export const formatSessionNotification = (
  event: LifecycleNotificationEvent,
  format: OutputFormat,
): string => {
  if (format === "json") {
    return JSON.stringify({
      kind: "notification",
      event,
    });
  }

  const level = LEVEL_LABELS[event.severity];
  return `[${level}] ${event.type} (${event.runId}): ${event.title} — ${event.summary}`;
};

export interface CliSessionNotifierOptions {
  format: OutputFormat;
  writeStdout?: (chunk: string) => void;
  writeStderr?: (chunk: string) => void;
}

export interface CliSessionNotifier {
  sink: SessionNotificationSink;
  events: LifecycleNotificationEvent[];
}

export const createCliSessionNotifier = (
  options: CliSessionNotifierOptions,
): CliSessionNotifier => {
  const events: LifecycleNotificationEvent[] = [];

  const sink: SessionNotificationSink = (event) => {
    events.push(event);
    const formatted = formatSessionNotification(event, options.format);

    if (options.format === "json") {
      // Never write notifications to stdout in JSON mode so the single stdout envelope remains valid JSON.
      options.writeStderr?.(`${formatted}\n`);
      return;
    }

    const writer = options.writeStderr ?? options.writeStdout;
    writer?.(`${formatted}\n`);
  };

  return {
    sink,
    events,
  };
};
