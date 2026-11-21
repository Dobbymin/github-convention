import { ExitCodes, ErrorCodes, type OutputError } from "@github-convention/core";
import type { ParsedCliArgs } from "./options.js";

export interface CommandContext {
  args: ParsedCliArgs;
}

export interface CommandResult {
  exitCode?: number;
  status?: "completed" | "approval_required" | "failed";
  data?: Record<string, unknown> | null;
  warnings?: string[];
  errors?: OutputError[];
}

export interface CommandDefinition {
  name: string;
  subcommands?: string[];
  mutates: boolean;
  requiresPolicyApproval?: boolean;
  run: (ctx: CommandContext) => Promise<CommandResult> | CommandResult;
}

export const COMMANDS: Record<string, CommandDefinition> = {
  install: {
    name: "install",
    mutates: true,
    run(ctx) {
      if (ctx.args.options.dryRun) {
        return {
          exitCode: ExitCodes.SUCCESS,
          status: "completed",
          data: {
            dryRun: true,
            command: "install",
            scope: ctx.args.options.scope ?? "project",
            agents: ctx.args.options.agent ?? [],
            actions: ["detect_agents", "preview_install_paths"],
          },
        };
      }
      return {
        exitCode: ExitCodes.SUCCESS,
        status: "completed",
        data: {
          installed: true,
          scope: ctx.args.options.scope ?? "project",
          agents: ctx.args.options.agent ?? [],
        },
      };
    },
  },

  update: {
    name: "update",
    mutates: true,
    run(ctx) {
      if (ctx.args.options.dryRun) {
        return {
          exitCode: ExitCodes.SUCCESS,
          status: "completed",
          data: {
            dryRun: true,
            command: "update",
            actions: ["check_updates", "verify_integrity", "preview_changes"],
          },
        };
      }
      return {
        exitCode: ExitCodes.SUCCESS,
        status: "completed",
        data: {
          updated: true,
        },
      };
    },
  },

  uninstall: {
    name: "uninstall",
    mutates: true,
    run(ctx) {
      if (ctx.args.options.dryRun) {
        return {
          exitCode: ExitCodes.SUCCESS,
          status: "completed",
          data: {
            dryRun: true,
            command: "uninstall",
            actions: ["inspect_cli_managed_files", "preview_removal"],
          },
        };
      }
      return {
        exitCode: ExitCodes.SUCCESS,
        status: "completed",
        data: {
          uninstalled: true,
        },
      };
    },
  },

  list: {
    name: "list",
    mutates: false,
    run(ctx) {
      return {
        exitCode: ExitCodes.SUCCESS,
        status: "completed",
        data: {
          agents: [],
          project: ctx.args.options.project ?? process.cwd(),
        },
      };
    },
  },

  doctor: {
    name: "doctor",
    mutates: false,
    run(ctx) {
      return {
        exitCode: ExitCodes.SUCCESS,
        status: "completed",
        data: {
          nodeVersion: process.version,
          platform: process.platform,
          project: ctx.args.options.project ?? process.cwd(),
          healthy: true,
        },
      };
    },
  },

  init: {
    name: "init",
    mutates: true,
    run(ctx) {
      if (ctx.args.options.dryRun) {
        return {
          exitCode: ExitCodes.SUCCESS,
          status: "completed",
          data: {
            dryRun: true,
            command: "init",
            project: ctx.args.options.project ?? process.cwd(),
            actions: ["preview_config_creation", "preview_skill_template"],
          },
        };
      }
      return {
        exitCode: ExitCodes.SUCCESS,
        status: "completed",
        data: {
          initialized: true,
          project: ctx.args.options.project ?? process.cwd(),
        },
      };
    },
  },

  validate: {
    name: "validate",
    mutates: false,
    run(ctx) {
      return {
        exitCode: ExitCodes.SUCCESS,
        status: "completed",
        data: {
          valid: true,
          configPath: ctx.args.options.config ?? null,
          project: ctx.args.options.project ?? process.cwd(),
        },
      };
    },
  },

  status: {
    name: "status",
    mutates: false,
    run(ctx) {
      return {
        exitCode: ExitCodes.SUCCESS,
        status: "completed",
        data: {
          state: "idle",
          project: ctx.args.options.project ?? process.cwd(),
        },
      };
    },
  },

  cleanup: {
    name: "cleanup",
    mutates: true,
    run(ctx) {
      if (ctx.args.options.dryRun) {
        return {
          exitCode: ExitCodes.SUCCESS,
          status: "completed",
          data: {
            dryRun: true,
            command: "cleanup",
            actions: ["scan_expired_archives", "scan_temp_artifacts"],
          },
        };
      }
      return {
        exitCode: ExitCodes.SUCCESS,
        status: "completed",
        data: {
          cleaned: true,
        },
      };
    },
  },

  plan: {
    name: "plan",
    subcommands: ["validate", "apply"],
    mutates: false,
    run(ctx) {
      const sub = ctx.args.subcommand;
      if (!sub) {
        return {
          exitCode: ExitCodes.INVALID_ARGUMENTS,
          status: "failed",
          errors: [
            {
              code: ErrorCodes.INVALID_ARGUMENTS,
              message: "Missing subcommand for 'plan'. Supported: validate, apply.",
            },
          ],
        };
      }

      if (sub === "validate") {
        return {
          exitCode: ExitCodes.SUCCESS,
          status: "completed",
          data: {
            subcommand: "validate",
            valid: true,
          },
        };
      }

      if (sub === "apply") {
        if (ctx.args.options.dryRun) {
          return {
            exitCode: ExitCodes.SUCCESS,
            status: "completed",
            data: {
              dryRun: true,
              command: "plan apply",
              actions: ["inspect_remote_state", "preview_plan_issues"],
            },
          };
        }

        // Policy-protected action: creating issues from plan requires human approval
        if (ctx.args.options.nonInteractive) {
          return {
            exitCode: ExitCodes.APPROVAL_REQUIRED,
            status: "approval_required",
            data: {
              command: "plan apply",
              approvalRequired: true,
              summary: "Applying plan to GitHub requires explicit approval.",
            },
            errors: [
              {
                code: ErrorCodes.APPROVAL_REQUIRED,
                message: "Explicit user approval is required.",
              },
            ],
          };
        }

        return {
          exitCode: ExitCodes.SUCCESS,
          status: "completed",
          data: {
            applied: true,
          },
        };
      }

      return {
        exitCode: ExitCodes.INVALID_ARGUMENTS,
        status: "failed",
        errors: [
          {
            code: ErrorCodes.INVALID_ARGUMENTS,
            message: `Unknown subcommand '${sub}' for 'plan'. Supported: validate, apply.`,
          },
        ],
      };
    },
  },

  state: {
    name: "state",
    subcommands: ["list", "show", "restore"],
    mutates: false,
    run(ctx) {
      const sub = ctx.args.subcommand;
      if (!sub) {
        return {
          exitCode: ExitCodes.INVALID_ARGUMENTS,
          status: "failed",
          errors: [
            {
              code: ErrorCodes.INVALID_ARGUMENTS,
              message: "Missing subcommand for 'state'. Supported: list, show, restore.",
            },
          ],
        };
      }

      if (sub === "list") {
        return {
          exitCode: ExitCodes.SUCCESS,
          status: "completed",
          data: {
            subcommand: "list",
            states: [],
          },
        };
      }

      if (sub === "show") {
        return {
          exitCode: ExitCodes.SUCCESS,
          status: "completed",
          data: {
            subcommand: "show",
            state: null,
          },
        };
      }

      if (sub === "restore") {
        if (ctx.args.options.dryRun) {
          return {
            exitCode: ExitCodes.SUCCESS,
            status: "completed",
            data: {
              dryRun: true,
              command: "state restore",
              actions: ["inspect_archive_state", "preview_restore"],
            },
          };
        }

        return {
          exitCode: ExitCodes.SUCCESS,
          status: "completed",
          data: {
            restored: true,
          },
        };
      }

      return {
        exitCode: ExitCodes.INVALID_ARGUMENTS,
        status: "failed",
        errors: [
          {
            code: ErrorCodes.INVALID_ARGUMENTS,
            message: `Unknown subcommand '${sub}' for 'state'. Supported: list, show, restore.`,
          },
        ],
      };
    },
  },
};
