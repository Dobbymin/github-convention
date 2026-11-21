import { execFileSync } from "node:child_process";
import { redactSecrets } from "@dobbymin/github-convention-core";
import type { CheckGhAuthOptions, GhAuthStatus, GhCommandRunner } from "./types.js";

export const defaultGhCommandRunner: GhCommandRunner = (
  file: string,
  args: readonly string[],
): string => {
  return execFileSync(file, [...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
};

const extractAccountFromOutput = (output: string): string | undefined => {
  const match =
    /Logged in to [^\s]+ account ([^\s(]+)/i.exec(output) ??
    /Logged in to [^\s]+ as ([^\s(]+)/i.exec(output);
  return match?.[1];
};

const extractErrorDetails = (error: unknown): string => {
  if (error instanceof Error) {
    const withOutput = error as Error & { stderr?: unknown; stdout?: unknown };
    const parts = [error.message];
    if (typeof withOutput.stderr === "string" && withOutput.stderr.trim().length > 0) {
      parts.push(withOutput.stderr.trim());
    }
    if (typeof withOutput.stdout === "string" && withOutput.stdout.trim().length > 0) {
      parts.push(withOutput.stdout.trim());
    }
    return redactSecrets(parts.join("\n"));
  }
  return redactSecrets(String(error));
};

export const checkGhAuth = async (options: CheckGhAuthOptions = {}): Promise<GhAuthStatus> => {
  const runner = options.runner ?? defaultGhCommandRunner;
  const args = options.hostname
    ? ["auth", "status", "--hostname", options.hostname]
    : ["auth", "status"];

  try {
    const raw = await runner("gh", args);
    const redactedOutput = redactSecrets(raw);
    const account = extractAccountFromOutput(redactedOutput);

    return {
      authenticated: true,
      source: "gh_cli",
      account: account ? redactSecrets(account) : undefined,
      hostname: options.hostname,
      rawOutput: redactedOutput,
    };
  } catch (error) {
    const redactedError = extractErrorDetails(error);

    if (options.agentToolStatus?.connected) {
      return {
        authenticated: true,
        source: "agent_tool",
        account: options.agentToolStatus.account
          ? redactSecrets(options.agentToolStatus.account)
          : undefined,
        hostname: options.hostname,
        rawOutput: options.agentToolStatus.detail
          ? redactSecrets(options.agentToolStatus.detail)
          : undefined,
        error: redactedError,
      };
    }

    return {
      authenticated: false,
      source: "none",
      hostname: options.hostname,
      error: redactedError,
    };
  }
};
