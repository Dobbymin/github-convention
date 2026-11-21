export type OutputFormat = "text" | "json";
export type InstallScope = "global" | "project" | "both";

export interface ParsedCliArgs {
  command?: string;
  subcommand?: string;
  positionals: string[];
  options: {
    agent?: string[];
    scope?: InstallScope;
    nonInteractive: boolean;
    output: OutputFormat;
    dryRun: boolean;
    yes: boolean;
    project?: string;
    config?: string;
    verbose: boolean;
    help: boolean;
    version: boolean;
  };
}

export interface ParseOptionsResult {
  args?: ParsedCliArgs;
  error?: {
    code: string;
    message: string;
  };
}

export function parseCliArgs(argv: string[]): ParseOptionsResult {
  const positionals: string[] = [];
  const agentList: string[] = [];
  let scope: InstallScope | undefined;
  let nonInteractive = false;
  let output: OutputFormat = "text";
  let dryRun = false;
  let yes = false;
  let project: string | undefined;
  let config: string | undefined;
  let verbose = false;
  let help = false;
  let version = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--version" || arg === "-v") {
      version = true;
    } else if (arg === "--non-interactive") {
      nonInteractive = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--yes") {
      yes = true;
    } else if (arg === "--verbose") {
      verbose = true;
    } else if (arg === "--agent") {
      const val = argv[++i];
      if (!val || val.startsWith("-")) {
        return {
          error: {
            code: "INVALID_ARGUMENTS",
            message: "Option '--agent' requires an argument.",
          },
        };
      }
      for (const item of val.split(",")) {
        const trimmed = item.trim();
        if (trimmed) agentList.push(trimmed);
      }
    } else if (arg.startsWith("--agent=")) {
      const val = arg.slice("--agent=".length);
      for (const item of val.split(",")) {
        const trimmed = item.trim();
        if (trimmed) agentList.push(trimmed);
      }
    } else if (arg === "--scope") {
      const val = argv[++i];
      if (val !== "global" && val !== "project" && val !== "both") {
        return {
          error: {
            code: "INVALID_ARGUMENTS",
            message: `Invalid scope: '${val}'. Must be one of: global, project, both.`,
          },
        };
      }
      scope = val;
    } else if (arg.startsWith("--scope=")) {
      const val = arg.slice("--scope=".length);
      if (val !== "global" && val !== "project" && val !== "both") {
        return {
          error: {
            code: "INVALID_ARGUMENTS",
            message: `Invalid scope: '${val}'. Must be one of: global, project, both.`,
          },
        };
      }
      scope = val;
    } else if (arg === "--output") {
      const val = argv[++i];
      if (val !== "text" && val !== "json") {
        return {
          error: {
            code: "INVALID_ARGUMENTS",
            message: `Invalid output format: '${val}'. Must be one of: text, json.`,
          },
        };
      }
      output = val;
    } else if (arg.startsWith("--output=")) {
      const val = arg.slice("--output=".length);
      if (val !== "text" && val !== "json") {
        return {
          error: {
            code: "INVALID_ARGUMENTS",
            message: `Invalid output format: '${val}'. Must be one of: text, json.`,
          },
        };
      }
      output = val;
    } else if (arg === "--project") {
      const val = argv[++i];
      if (!val || val.startsWith("-")) {
        return {
          error: {
            code: "INVALID_ARGUMENTS",
            message: "Option '--project' requires a directory path.",
          },
        };
      }
      project = val;
    } else if (arg.startsWith("--project=")) {
      project = arg.slice("--project=".length);
    } else if (arg === "--config") {
      const val = argv[++i];
      if (!val || val.startsWith("-")) {
        return {
          error: {
            code: "INVALID_ARGUMENTS",
            message: "Option '--config' requires a file path.",
          },
        };
      }
      config = val;
    } else if (arg.startsWith("--config=")) {
      config = arg.slice("--config=".length);
    } else if (arg.startsWith("-")) {
      return {
        error: {
          code: "INVALID_ARGUMENTS",
          message: `Unknown option: '${arg}'.`,
        },
      };
    } else {
      positionals.push(arg);
    }
  }

  const [command, subcommand, ...remaining] = positionals;

  return {
    args: {
      command,
      subcommand,
      positionals: remaining,
      options: {
        agent: agentList.length > 0 ? agentList : undefined,
        scope,
        nonInteractive,
        output,
        dryRun,
        yes,
        project,
        config,
        verbose,
        help,
        version,
      },
    },
  };
}
