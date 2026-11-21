export type OutputStatus = "completed" | "approval_required" | "failed";

export interface OutputError {
  code: string;
  message: string;
}

export interface OutputEnvelope<T = Record<string, unknown> | null> {
  schemaVersion: 1;
  success: boolean;
  status: OutputStatus;
  command: string;
  data: T;
  warnings: string[];
  errors: OutputError[];
}

export interface CreateEnvelopeOptions<T = Record<string, unknown> | null> {
  command: string;
  status?: OutputStatus;
  success?: boolean;
  data?: T;
  warnings?: string[];
  errors?: OutputError[];
}

export function createOutputEnvelope<T = Record<string, unknown> | null>(
  options: CreateEnvelopeOptions<T>,
): OutputEnvelope<T> {
  const status =
    options.status ?? (options.errors && options.errors.length > 0 ? "failed" : "completed");
  const success = options.success ?? status === "completed";

  return {
    schemaVersion: 1,
    success,
    status,
    command: options.command,
    data: (options.data ?? null) as T,
    warnings: options.warnings ? [...options.warnings] : [],
    errors: options.errors ? [...options.errors] : [],
  };
}
