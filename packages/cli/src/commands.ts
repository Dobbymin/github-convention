import { ExitCodes, ErrorCodes, type OutputError } from "@github-convention/core";
import { runDoctor } from "./doctor/index.js";
import { executeInit } from "./init/index.js";
import type { ParsedCliArgs } from "./options.js";
import { runPlanApply, runPlanValidate } from "./plan/index.js";
import { executeUninstall } from "./uninstall/index.js";
import { executeUpdate } from "./update/index.js";
import { runValidate } from "./validate/index.js";

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
      try {
        const result = executeUpdate({
          projectRoot: ctx.args.options.project,
          dryRun: ctx.args.options.dryRun,
        });

        if (!result.success) {
          const conflict = result.plan.conflicts.length > 0;
          return {
            exitCode: conflict ? ExitCodes.INTEGRITY_CONFLICT : ExitCodes.GENERAL_FAILURE,
            status: "failed",
            data: {
              targetDir: result.targetDir,
              dryRun: result.dryRun,
              rolledBack: result.rolledBack ?? false,
              summary: result.plan.summary,
              conflicts: result.plan.conflicts,
            },
            errors: [
              {
                code: conflict ? ErrorCodes.MERGE_CONFLICT : ErrorCodes.OPERATION_FAILED,
                message: result.error ?? "Update failed.",
              },
            ],
          };
        }

        return {
          exitCode: ExitCodes.SUCCESS,
          status: "completed",
          data: {
            targetDir: result.targetDir,
            dryRun: result.dryRun,
            symlink: result.plan.isSymlink,
            summary: result.plan.summary,
            files: result.plan.files,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const incompatible = message.includes("not compatible");
        return {
          exitCode: incompatible ? ExitCodes.INTEGRITY_CONFLICT : ExitCodes.GENERAL_FAILURE,
          status: "failed",
          errors: [
            {
              code: incompatible ? ErrorCodes.VERSION_INCOMPATIBLE : ErrorCodes.OPERATION_FAILED,
              message,
            },
          ],
        };
      }
    },
  },

  uninstall: {
    name: "uninstall",
    mutates: true,
    run(ctx) {
      const result = executeUninstall({
        projectRoot: ctx.args.options.project,
        dryRun: ctx.args.options.dryRun,
      });

      if (!result.success) {
        return {
          exitCode: ExitCodes.GENERAL_FAILURE,
          status: "failed",
          data: {
            targetDir: result.targetDir,
            retainedPath: result.retainedPath,
          },
          errors: [
            {
              code: ErrorCodes.OPERATION_FAILED,
              message: result.error ?? "Uninstall failed.",
            },
          ],
        };
      }

      const preserved = result.plan.items.filter(
        (item) => item.action === "preserve_modified" || item.action === "preserve_unowned",
      );

      return {
        exitCode: ExitCodes.SUCCESS,
        status: "completed",
        data: {
          targetDir: result.targetDir,
          dryRun: result.dryRun,
          kind: result.plan.kind,
          summary: result.plan.summary,
          items: result.plan.items,
          manifestRemoved: result.manifestRemoved,
          directoryRemoved: result.directoryRemoved,
          ...(result.retainedPath !== undefined ? { retainedPath: result.retainedPath } : {}),
        },
        warnings: preserved.map((item) => `[${item.action}] ${item.relativePath}: ${item.reason}`),
      };
    },
  },

  list: {
    name: "list",
    mutates: false,
    async run(ctx) {
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
    async run(ctx) {
      const report = runDoctor({
        projectRoot: ctx.args.options.project,
        configPath: ctx.args.options.config,
      });
      return {
        exitCode: ExitCodes.SUCCESS,
        status: "completed",
        data: report as unknown as Record<string, unknown>,
        warnings: report.checks
          .filter((c) => c.status === "warn")
          .map((c) => `[${c.id}] ${c.message ?? c.name}`),
      };
    },
  },

  init: {
    name: "init",
    mutates: true,
    run(ctx) {
      try {
        const result = executeInit({
          projectRoot: ctx.args.options.project,
          dryRun: ctx.args.options.dryRun,
        });

        return {
          exitCode: ExitCodes.SUCCESS,
          status: "completed",
          data: {
            command: "init",
            project: result.projectRoot,
            dryRun: result.dryRun,
            initialized: result.initialized,
            cacheWritten: result.cacheWritten,
            writtenFiles: result.writtenFiles,
            actions: result.plan.actions,
            ignoreEntriesToAdd: result.plan.ignorePlan.entriesToAdd,
            discoveredFiles: result.plan.analysis.discoveredFiles,
            conflicts: result.plan.analysis.conflicts,
          },
          warnings: result.warnings,
        };
      } catch (err) {
        return {
          exitCode: ExitCodes.GENERAL_FAILURE,
          status: "failed",
          errors: [
            {
              code: ErrorCodes.OPERATION_FAILED,
              message: err instanceof Error ? err.message : String(err),
            },
          ],
        };
      }
    },
  },

  validate: {
    name: "validate",
    mutates: false,
    async run(ctx) {
      const res = runValidate({
        projectRoot: ctx.args.options.project,
        configPath: ctx.args.options.config,
      });

      if (!res.valid) {
        return {
          exitCode: ExitCodes.INVALID_ARGUMENTS,
          status: "failed",
          data: res as unknown as Record<string, unknown>,
          warnings: res.warnings,
          errors: res.errors.map((msg) => ({
            code: ErrorCodes.CONFIG_INVALID,
            message: msg,
          })),
        };
      }

      return {
        exitCode: ExitCodes.SUCCESS,
        status: "completed",
        data: res as unknown as Record<string, unknown>,
        warnings: res.warnings,
      };
    },
  },

  status: {
    name: "status",
    mutates: false,
    async run(ctx) {
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
    async run(ctx) {
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
        const result = runPlanValidate({
          projectRoot: ctx.args.options.project,
        });
        if (!result.valid) {
          return {
            exitCode: ExitCodes.INVALID_ARGUMENTS,
            status: "failed",
            data: {
              subcommand: "validate",
              valid: false,
              ...(result.planId !== undefined ? { planId: result.planId } : {}),
              ...(result.validation !== undefined ? { validation: result.validation } : {}),
            },
            errors: (result.validation?.errors ?? []).map((err) => ({
              code: err.code,
              message: err.message,
            })),
          };
        }
        return {
          exitCode: ExitCodes.SUCCESS,
          status: "completed",
          data: {
            subcommand: "validate",
            valid: true,
            ...(result.planId !== undefined ? { planId: result.planId } : {}),
            ...(result.validation !== undefined ? { validation: result.validation } : {}),
          },
        };
      }

      if (sub === "apply") {
        const applied = await runPlanApply({
          projectRoot: ctx.args.options.project,
          dryRun: ctx.args.options.dryRun,
          nonInteractive: ctx.args.options.nonInteractive,
        });

        if (applied.dryRun) {
          return {
            exitCode: ExitCodes.SUCCESS,
            status: "completed",
            data: {
              dryRun: true,
              command: "plan apply",
              actions: ["inspect_remote_state", "preview_plan_issues"],
              ...(applied.result !== undefined ? { result: applied.result } : {}),
            },
          };
        }

        if (applied.status === "approval_required") {
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

        if (applied.status === "failed") {
          return {
            exitCode: ExitCodes.GENERAL_FAILURE,
            status: "failed",
            errors: [
              {
                code: ErrorCodes.OPERATION_FAILED,
                message: applied.error ?? "Plan apply failed.",
              },
            ],
          };
        }

        return {
          exitCode: ExitCodes.SUCCESS,
          status: "completed",
          data: {
            applied: true,
            ...(applied.result !== undefined ? { result: applied.result } : {}),
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
    async run(ctx) {
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
