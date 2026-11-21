export type GhCommandRunner = (file: string, args: readonly string[]) => string | Promise<string>;

export type AgentGitHubToolStatus = Readonly<{
  connected: boolean;
  account?: string;
  source?: string;
  detail?: string;
}>;

export type CheckGhAuthOptions = Readonly<{
  runner?: GhCommandRunner;
  hostname?: string;
  agentToolStatus?: AgentGitHubToolStatus;
}>;

export type GhAuthSource = "gh_cli" | "agent_tool" | "none";

export type GhAuthStatus = Readonly<{
  authenticated: boolean;
  source: GhAuthSource;
  account?: string;
  hostname?: string;
  rawOutput?: string;
  error?: string;
}>;
