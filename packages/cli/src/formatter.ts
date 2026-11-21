import type { OutputEnvelope } from "@dobbymin/github-convention-core";
import type { OutputFormat } from "./options.js";

export function formatOutput(envelope: OutputEnvelope, format: OutputFormat): string {
  if (format === "json") {
    return JSON.stringify(envelope, null, 2);
  }

  const lines: string[] = [];

  if (envelope.status === "completed") {
    lines.push(`[github-convention] Command '${envelope.command}' completed successfully.`);
    if (envelope.data && Object.keys(envelope.data).length > 0) {
      for (const [key, val] of Object.entries(envelope.data)) {
        lines.push(`  ${key}: ${typeof val === "object" ? JSON.stringify(val) : String(val)}`);
      }
    }
  } else if (envelope.status === "approval_required") {
    lines.push(`[github-convention] Command '${envelope.command}' requires explicit approval.`);
    for (const err of envelope.errors) {
      lines.push(`  [${err.code}] ${err.message}`);
    }
  } else {
    lines.push(`[github-convention] Command '${envelope.command}' failed.`);
    for (const err of envelope.errors) {
      lines.push(`  Error [${err.code}]: ${err.message}`);
    }
  }

  for (const warn of envelope.warnings) {
    lines.push(`  Warning: ${warn}`);
  }

  return lines.join("\n");
}
