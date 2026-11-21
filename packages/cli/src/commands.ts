import { detectAllAgents } from "@dobbymin/github-convention-agent-adapters";
import { ExitCodes, ErrorCodes, type OutputError } from "@dobbymin/github-convention-core";
import { runDoctor } from "./doctor/index.js";
import { executeInit } from "./init/index.js";
import { executeInstall } from "./install/index.js";
import { runList, validateAgentIds } from "./list/index.js";
import type { ParsedCliArgs } from "./options.js";
import { runPlanApply, runPlanValidate } from "./plan/index.js";
import { runCleanupArchives, runStateList, runStateRestore, runStateShow } from "./state/index.js";
import { runStatus } from "./status/index.js";
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
      const projectRoot = ctx.args.options.project ?? process.cwd();
      const scope = ctx.args.options.scope ?? "project";
      const explicitAgents = ctx.args.options.agent ?? [];

      let targetAgentIds;
      try {
        targetAgentIds =
          explicitAgents.length > 0
            ? validateAgentIds(explicitAgents)
            : detectAllAgents({ projectDir: projectRoot })
                .filter((det) => det.confidence === "confirmed")
                .map((det) => det.agentId);
      } catch (err) {
        return {
          exitCode: ExitCodes.INVALID_ARGUMENTS,
          status: "failed",
          errors: [
            {
              code: ErrorCodes.INVALID_ARGUMENTS,
              message: err instanceof Error ? err.message : String(err),
            },
          ],
        };
      }

      if (targetAgentIds.length === 0 && !ctx.args.options.dryRun) {
        return {
          exitCode: ExitCodes.INVALID_ARGUMENTS,
          status: "failed",
          errors: [
            {
              code: ErrorCodes.INVALID_ARGUMENTS,
              message: "No confirmed agents detected. Specify target agents with --agent <id,...>.",
            },
          ],
        };
      }

      const installResult = executeInstall({
        targets: targetAgentIds.map((agentId) => ({ agentId, scope })),
        projectRoot,
        dryRun: ctx.args.options.dryRun,
      });

      if (!installResult.success) {
        return {
          exitCode: ExitCodes.GENERAL_FAILURE,
          status: "failed",
          data: {
            dryRun: ctx.args.options.dryRun,
            command: "install",
            scope,
            agents: targetAgentIds,
            installed: false,
            canonicalSourcePath: installResult.canonicalSourcePath,
            items: installResult.items,
          },
          errors: [
            {
              code: ErrorCodes.OPERATION_FAILED,
              message: "One or more agent installations failed.",
            },
          ],
        };
      }

      return {
        exitCode: ExitCodes.SUCCESS,
        status: "completed",
        data: {
          dryRun: ctx.args.options.dryRun,
          command: "install",
          scope,
          agents: targetAgentIds,
          installed: !ctx.args.options.dryRun && installResult.success,
          canonicalSourcePath: installResult.canonicalSourcePath,
          items: installResult.items,
          ...(ctx.args.options.dryRun
            ? { actions: ["detect_agents", "preview_install_paths"] }
            : {}),
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
      try {
        const result = runList({
          projectRoot: ctx.args.options.project,
          agents: ctx.args.options.agent,
        });
        return {
          exitCode: ExitCodes.SUCCESS,
          status: "completed",
          data: {
            project: result.project,
            agents: result.agents,
            installedCount: result.installedCount,
          },
        };
      } catch (err) {
        return {
          exitCode: ExitCodes.INVALID_ARGUMENTS,
          status: "failed",
          errors: [
            {
              code: ErrorCodes.INVALID_ARGUMENTS,
              message: err instanceof Error ? err.message : String(err),
            },
          ],
        };
      }
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
      const result = runStatus({
        projectRoot: ctx.args.options.project,
      });
      return {
        exitCode: ExitCodes.SUCCESS,
        status: "completed",
        data: {
          state: result.state,
          project: result.project,
          activeRuns: result.activeRuns,
          activeCount: result.activeCount,
          archivedCount: result.archivedCount,
          latestRun: result.latestRun,
        },
        warnings: result.warnings,
      };
    },
  },

  cleanup: {
    name: "cleanup",
    mutates: true,
    run(ctx) {
      const result = runCleanupArchives({
        projectRoot: ctx.args.options.project,
        dryRun: ctx.args.options.dryRun,
      });
      if (ctx.args.options.dryRun) {
        return {
          exitCode: ExitCodes.SUCCESS,
          status: "completed",
          data: {
            dryRun: true,
            command: "cleanup",
            actions: ["scan_expired_archives", "scan_temp_artifacts"],
            deletedRunIds: result.deletedRunIds,
            retainedRunIds: result.retainedRunIds,
          },
        };
      }
      return {
        exitCode: ExitCodes.SUCCESS,
        status: "completed",
        data: {
          cleaned: true,
          deletedRunIds: result.deletedRunIds,
          retainedRunIds: result.retainedRunIds,
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
        const planPath = ctx.args.positionals[0];
        const result = runPlanValidate({
          projectRoot: ctx.args.options.project,
          ...(planPath !== undefined ? { planPath } : {}),
        });
        if (!result.valid) {
          const errors =
            result.validation && result.validation.errors.length > 0
              ? result.validation.errors.map((err) => ({
                  code: err.code,
                  message: err.message,
                }))
              : [
                  {
                    code: result.errorCode ?? ErrorCodes.CONFIG_INVALID,
                    message: result.error ?? "Plan validation failed.",
                  },
                ];
          return {
            exitCode: ExitCodes.INVALID_ARGUMENTS,
            status: "failed",
            data: {
              subcommand: "validate",
              valid: false,
              ...(result.planId !== undefined ? { planId: result.planId } : {}),
              ...(result.validation !== undefined ? { validation: result.validation } : {}),
              ...(result.error !== undefined ? { error: result.error } : {}),
            },
            errors,
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
        const planPath = ctx.args.positionals[0];
        const applied = await runPlanApply({
          projectRoot: ctx.args.options.project,
          ...(planPath !== undefined ? { planPath } : {}),
          dryRun: ctx.args.options.dryRun,
          nonInteractive: ctx.args.options.nonInteractive,
          output: ctx.args.options.output,
        });

        if (applied.status === "failed") {
          const isConfigInvalid = applied.errorCode === ErrorCodes.CONFIG_INVALID;
          return {
            exitCode: isConfigInvalid ? ExitCodes.INVALID_ARGUMENTS : ExitCodes.GENERAL_FAILURE,
            status: "failed",
            errors: [
              {
                code: applied.errorCode ?? ErrorCodes.OPERATION_FAILED,
                message: applied.error ?? "Plan apply failed.",
              },
            ],
          };
        }

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
        const states = runStateList({ projectRoot: ctx.args.options.project });
        return {
          exitCode: ExitCodes.SUCCESS,
          status: "completed",
          data: {
            subcommand: "list",
            states,
          },
        };
      }

      if (sub === "show") {
        const runId = ctx.args.positionals[0];
        const shown = runStateShow({
          projectRoot: ctx.args.options.project,
          ...(runId !== undefined ? { runId } : {}),
        });
        return {
          exitCode: ExitCodes.SUCCESS,
          status: "completed",
          data: {
            subcommand: "show",
            state: shown?.state ?? null,
          },
        };
      }

      if (sub === "restore") {
        const runId = ctx.args.positionals[0];
        if (ctx.args.options.dryRun) {
          const preview = runStateRestore({
            projectRoot: ctx.args.options.project,
            ...(runId !== undefined ? { runId } : {}),
            dryRun: true,
          });
          return {
            exitCode: ExitCodes.SUCCESS,
            status: "completed",
            data: {
              dryRun: true,
              command: "state restore",
              actions: ["inspect_archive_state", "preview_restore"],
              ...(preview !== null ? { preview } : {}),
            },
          };
        }

        const restored = runStateRestore({
          projectRoot: ctx.args.options.project,
          ...(runId !== undefined ? { runId } : {}),
          dryRun: false,
        });
        return {
          exitCode: ExitCodes.SUCCESS,
          status: "completed",
          data: {
            restored: restored?.moved ?? true,
            ...(restored !== null ? { result: restored } : {}),
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
