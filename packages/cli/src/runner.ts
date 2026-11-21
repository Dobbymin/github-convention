import * as os from "node:os";
import {
  cleanupExpiredArchives,
  createOutputEnvelope,
  DEFAULT_CONFIG,
  ExitCodes,
  ErrorCodes,
  resolveConfig,
  type OutputEnvelope,
} from "@dobbymin/github-convention-core";
import { parseCliArgs, type OutputFormat } from "./options.js";
import { COMMANDS } from "./commands.js";
import { findGlobalConfigFile, findProjectConfigFile } from "./doctor/probes.js";
import { formatOutput } from "./formatter.js";
import type { InstallPrompter } from "./install/index.js";
import cliPackage from "../package.json" with { type: "json" };

export interface CliIo {
  stdout: (msg: string) => void;
  stderr: (msg: string) => void;
  prompter?: InstallPrompter;
}

export interface RunCliOptions {
  prompter?: InstallPrompter;
}

export interface CliRunResult {
  exitCode: number;
  envelope: OutputEnvelope;
  stdoutText: string;
  stderrText: string;
}

export function getHelpText(): string {
  return `github-convention CLI v${cliPackage.version}

Usage: github-convention <command> [subcommand] [options]

Commands:
  install           Detect/select Agents; install Global/Project Skill
  update            Preview and apply CLI/Skill updates with integrity check
  uninstall         Remove only unchanged CLI-owned installation files
  list              Show installed Agents, scopes, versions, and link/copy status
  doctor            Diagnose OS, Node, Git, gh auth, Agent paths, schema, integrity
  init              Initialise Project Config, canonical Skill folder, ignore rules
  validate          Validate config, skill metadata, manifests, State, conventions
  status            Show run/Issue/PR/Agent status
  cleanup           Expired archive cleanup and verified temporary artifact cleanup
  plan validate     Validate a generated workflow/Issue plan
  plan apply        Apply an approved plan to GitHub, idempotently
  state list        Inspect archived execution state
  state show        Inspect execution state detail
  state restore     Restore archived execution state

Common Options:
  --agent <id,...>          Target adapter IDs (e.g. codex, claude-code)
  --scope <scope>           Install scope: global, project, or both
  --non-interactive         Never prompt; fail or require approval when needed
  --output <text|json>      Output format (default: text)
  --dry-run                 Calculate and display intended changes without mutation
  --yes                     Confirm non-policy prompts (never bypass protected approvals)
  --project <path>          Explicit Project root path
  --config <path>           Explicit configuration file path
  --verbose                 Show detailed diagnostic messages (on stderr in JSON mode)
  -h, --help                Show this help message
  -v, --version             Show CLI version
`;
}

export async function runCli(
  argv: string[],
  io: CliIo = {
    stdout: (msg) => process.stdout.write(msg + "\n"),
    stderr: (msg) => process.stderr.write(msg + "\n"),
  },
  options?: RunCliOptions,
): Promise<CliRunResult> {
  let stdoutAccum = "";
  let stderrAccum = "";

  const customIo: CliIo = {
    stdout: (msg) => {
      stdoutAccum += (stdoutAccum ? "\n" : "") + msg;
      io.stdout(msg);
    },
    stderr: (msg) => {
      stderrAccum += (stderrAccum ? "\n" : "") + msg;
      io.stderr(msg);
    },
  };

  const parsed = parseCliArgs(argv);

  if (parsed.error) {
    const envelope = createOutputEnvelope({
      command: "unknown",
      status: "failed",
      errors: [parsed.error],
    });
    const outputFormat: OutputFormat =
      argv.includes("--output=json") ||
      (argv.includes("--output") && argv[argv.indexOf("--output") + 1] === "json")
        ? "json"
        : "text";

    const formatted = formatOutput(envelope, outputFormat);
    if (outputFormat === "json") {
      customIo.stdout(formatted);
    } else {
      customIo.stderr(formatted);
    }

    return {
      exitCode: ExitCodes.INVALID_ARGUMENTS,
      envelope,
      stdoutText: stdoutAccum,
      stderrText: stderrAccum,
    };
  }

  const { args } = parsed;
  const outputFormat = args!.options.output;

  if (args!.options.version) {
    const envelope = createOutputEnvelope({
      command: "version",
      status: "completed",
      data: { version: cliPackage.version },
    });
    if (outputFormat === "json") {
      customIo.stdout(formatOutput(envelope, "json"));
    } else {
      customIo.stdout(`github-convention ${cliPackage.version}`);
    }
    return {
      exitCode: ExitCodes.SUCCESS,
      envelope,
      stdoutText: stdoutAccum,
      stderrText: stderrAccum,
    };
  }

  if (args!.options.help || !args!.command) {
    if (!args!.command && args!.options.nonInteractive && outputFormat === "json") {
      const envelope = createOutputEnvelope({
        command: "unknown",
        status: "failed",
        errors: [
          {
            code: ErrorCodes.INVALID_ARGUMENTS,
            message: "No command specified in non-interactive mode.",
          },
        ],
      });
      customIo.stdout(formatOutput(envelope, "json"));
      return {
        exitCode: ExitCodes.INVALID_ARGUMENTS,
        envelope,
        stdoutText: stdoutAccum,
        stderrText: stderrAccum,
      };
    }

    const envelope = createOutputEnvelope({
      command: "help",
      status: "completed",
      data: { help: true },
    });
    if (outputFormat === "json") {
      customIo.stdout(formatOutput(envelope, "json"));
    } else {
      customIo.stdout(getHelpText());
    }
    return {
      exitCode: ExitCodes.SUCCESS,
      envelope,
      stdoutText: stdoutAccum,
      stderrText: stderrAccum,
    };
  }

  const cmdDef = COMMANDS[args!.command];
  if (!cmdDef) {
    const envelope = createOutputEnvelope({
      command: args!.command,
      status: "failed",
      errors: [
        {
          code: ErrorCodes.INVALID_ARGUMENTS,
          message: `Unknown command '${args!.command}'. Run 'github-convention --help' for available commands.`,
        },
      ],
    });

    const formatted = formatOutput(envelope, outputFormat);
    if (outputFormat === "json") {
      customIo.stdout(formatted);
    } else {
      customIo.stderr(formatted);
    }

    return {
      exitCode: ExitCodes.INVALID_ARGUMENTS,
      envelope,
      stdoutText: stdoutAccum,
      stderrText: stderrAccum,
    };
  }

  if (!args!.options.dryRun) {
    try {
      const projectRoot = args!.options.project ?? process.cwd();
      const projectConfigPath =
        args!.options.config ?? findProjectConfigFile(projectRoot) ?? undefined;
      const globalConfigPath = findGlobalConfigFile(os.homedir()) ?? undefined;
      let archiveConfig = DEFAULT_CONFIG.archive;
      try {
        const resolved = resolveConfig({
          ...(globalConfigPath ? { globalConfigPath } : {}),
          ...(projectConfigPath ? { projectConfigPath } : {}),
        });
        archiveConfig = resolved.config.archive;
      } catch {
        archiveConfig = DEFAULT_CONFIG.archive;
      }
      if (archiveConfig.auto_cleanup_on_cli_start) {
        cleanupExpiredArchives(projectRoot, {
          retentionDays: archiveConfig.retention_days,
          dryRun: false,
        });
      }
    } catch {
      // Startup archive cleanup must never block CLI command execution
    }
  }

  const result = await cmdDef.run({
    args: args!,
    prompter: options?.prompter ?? io.prompter,
  });
  const exitCode = result.exitCode ?? ExitCodes.SUCCESS;
  const status =
    result.status ??
    (exitCode === ExitCodes.SUCCESS
      ? "completed"
      : exitCode === ExitCodes.APPROVAL_REQUIRED
        ? "approval_required"
        : "failed");

  const fullCommandName = args!.subcommand ? `${args!.command} ${args!.subcommand}` : args!.command;

  const envelope = createOutputEnvelope({
    command: fullCommandName,
    status,
    data: result.data,
    warnings: result.warnings,
    errors: result.errors,
  });

  const formatted = formatOutput(envelope, outputFormat);
  if (outputFormat === "json") {
    // Valid JSON ONLY on stdout
    customIo.stdout(formatted);
  } else {
    if (exitCode === ExitCodes.SUCCESS) {
      customIo.stdout(formatted);
    } else {
      customIo.stderr(formatted);
    }
  }

  return {
    exitCode,
    envelope,
    stdoutText: stdoutAccum,
    stderrText: stderrAccum,
  };
}
