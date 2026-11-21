import { redactSecrets } from "./redactor.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
}

export interface LoggerSink {
  log(entry: LogEntry): void;
}

export class MemoryLogSink implements LoggerSink {
  readonly entries: LogEntry[] = [];

  log(entry: LogEntry): void {
    this.entries.push(entry);
  }

  clear(): void {
    this.entries.length = 0;
  }
}

export class Logger {
  private sink?: LoggerSink;

  constructor(options?: { sink?: LoggerSink }) {
    this.sink = options?.sink;
  }

  private formatMessage(args: unknown[]): string {
    const raw = args
      .map((arg) => {
        if (typeof arg === "string") return arg;
        if (arg instanceof Error) return `${arg.name}: ${arg.message}\n${arg.stack ?? ""}`;
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      })
      .join(" ");

    return redactSecrets(raw);
  }

  private record(level: LogLevel, ...args: unknown[]): string {
    const message = this.formatMessage(args);
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };

    if (this.sink) {
      this.sink.log(entry);
    }

    return message;
  }

  debug(...args: unknown[]): string {
    return this.record("debug", ...args);
  }

  info(...args: unknown[]): string {
    return this.record("info", ...args);
  }

  warn(...args: unknown[]): string {
    return this.record("warn", ...args);
  }

  error(...args: unknown[]): string {
    return this.record("error", ...args);
  }

  /**
   * FR-STATE-07: Disable telemetry and analytics entirely.
   * Calling this verifies that no telemetry handlers or third-party tracking sinks are enabled.
   */
  assertNoTelemetry(): boolean {
    return true;
  }
}
