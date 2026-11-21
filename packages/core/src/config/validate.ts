import { IMMUTABLE_SAFETY_INVARIANTS } from "./constants.js";
import type { ValidationIssue, ValidationResult } from "./types.js";

const KNOWN_ROOT_KEYS = new Set([
  "schema_version",
  "execution",
  "archive",
  "github",
  "quality",
  "notifications",
  "privacy",
]);

const KNOWN_EXECUTION_KEYS = new Set(["sub_agents", "max_parallel_agents", "retry"]);
const KNOWN_RETRY_KEYS = new Set([
  "worker_max_retries",
  "code_ci_max_retries",
  "transient_ci_max_retries",
]);
const KNOWN_ARCHIVE_KEYS = new Set(["retention_days", "auto_cleanup_on_cli_start"]);
const KNOWN_GITHUB_KEYS = new Set([
  "auth_preference",
  "default_branch",
  "create_draft_pr",
  "require_issue_approval",
  "require_release_approval",
]);
const KNOWN_QUALITY_KEYS = new Set([
  "reuse_existing_tools",
  "require_secret_scan",
  "secret_scanner_install_requires_approval",
  "self_review_required_before_pr",
  "extra_checks",
]);
const KNOWN_NOTIFICATIONS_KEYS = new Set(["session", "external"]);
const KNOWN_EXTERNAL_KEYS = new Set(["enabled", "provider"]);
const KNOWN_PRIVACY_KEYS = new Set(["telemetry"]);

const getNestedValue = (obj: Record<string, unknown>, path: string): unknown => {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
};

export const validateConfig = (config: unknown): ValidationResult => {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    return {
      valid: false,
      errors: [{ path: "", message: "Configuration must be a non-null object." }],
      warnings: [],
    };
  }

  const raw = config as Record<string, unknown>;

  // Check unknown root keys
  for (const key of Object.keys(raw)) {
    if (!KNOWN_ROOT_KEYS.has(key)) {
      warnings.push({
        path: key,
        message: `Unknown configuration key '${key}'. It will be ignored.`,
      });
    }
  }

  // 1. schema_version
  if (raw.schema_version !== undefined) {
    if (
      typeof raw.schema_version !== "number" ||
      !Number.isInteger(raw.schema_version) ||
      raw.schema_version < 1
    ) {
      errors.push({
        path: "schema_version",
        message: "'schema_version' must be an integer greater than or equal to 1.",
      });
    }
  }

  // 2. execution
  if (raw.execution !== undefined) {
    if (
      typeof raw.execution !== "object" ||
      raw.execution === null ||
      Array.isArray(raw.execution)
    ) {
      errors.push({
        path: "execution",
        message: "'execution' must be an object.",
      });
    } else {
      const exec = raw.execution as Record<string, unknown>;
      for (const k of Object.keys(exec)) {
        if (!KNOWN_EXECUTION_KEYS.has(k)) {
          warnings.push({
            path: `execution.${k}`,
            message: `Unknown configuration key 'execution.${k}'. It will be ignored.`,
          });
        }
      }

      if (exec.sub_agents !== undefined) {
        if (!["auto", "enabled", "disabled"].includes(exec.sub_agents as string)) {
          errors.push({
            path: "execution.sub_agents",
            message: "'execution.sub_agents' must be one of: 'auto', 'enabled', 'disabled'.",
          });
        }
      }

      if (exec.max_parallel_agents !== undefined) {
        if (
          typeof exec.max_parallel_agents !== "number" ||
          !Number.isInteger(exec.max_parallel_agents) ||
          exec.max_parallel_agents < 1 ||
          exec.max_parallel_agents > 64
        ) {
          errors.push({
            path: "execution.max_parallel_agents",
            message: "'execution.max_parallel_agents' must be an integer between 1 and 64.",
          });
        }
      }

      if (exec.retry !== undefined) {
        if (typeof exec.retry !== "object" || exec.retry === null || Array.isArray(exec.retry)) {
          errors.push({
            path: "execution.retry",
            message: "'execution.retry' must be an object.",
          });
        } else {
          const retry = exec.retry as Record<string, unknown>;
          for (const k of Object.keys(retry)) {
            if (!KNOWN_RETRY_KEYS.has(k)) {
              warnings.push({
                path: `execution.retry.${k}`,
                message: `Unknown configuration key 'execution.retry.${k}'. It will be ignored.`,
              });
            }
          }

          for (const field of [
            "worker_max_retries",
            "code_ci_max_retries",
            "transient_ci_max_retries",
          ] as const) {
            if (retry[field] !== undefined) {
              const val = retry[field];
              if (typeof val !== "number" || !Number.isInteger(val) || val < 0 || val > 10) {
                errors.push({
                  path: `execution.retry.${field}`,
                  message: `'execution.retry.${field}' must be an integer between 0 and 10.`,
                });
              }
            }
          }
        }
      }
    }
  }

  // 3. archive
  if (raw.archive !== undefined) {
    if (typeof raw.archive !== "object" || raw.archive === null || Array.isArray(raw.archive)) {
      errors.push({
        path: "archive",
        message: "'archive' must be an object.",
      });
    } else {
      const arch = raw.archive as Record<string, unknown>;
      for (const k of Object.keys(arch)) {
        if (!KNOWN_ARCHIVE_KEYS.has(k)) {
          warnings.push({
            path: `archive.${k}`,
            message: `Unknown configuration key 'archive.${k}'. It will be ignored.`,
          });
        }
      }

      if (arch.retention_days !== undefined) {
        if (
          typeof arch.retention_days !== "number" ||
          !Number.isInteger(arch.retention_days) ||
          arch.retention_days < 1 ||
          arch.retention_days > 3650
        ) {
          errors.push({
            path: "archive.retention_days",
            message: "'archive.retention_days' must be an integer between 1 and 3650.",
          });
        }
      }

      if (arch.auto_cleanup_on_cli_start !== undefined) {
        if (typeof arch.auto_cleanup_on_cli_start !== "boolean") {
          errors.push({
            path: "archive.auto_cleanup_on_cli_start",
            message: "'archive.auto_cleanup_on_cli_start' must be a boolean.",
          });
        }
      }
    }
  }

  // 4. github
  if (raw.github !== undefined) {
    if (typeof raw.github !== "object" || raw.github === null || Array.isArray(raw.github)) {
      errors.push({
        path: "github",
        message: "'github' must be an object.",
      });
    } else {
      const gh = raw.github as Record<string, unknown>;
      for (const k of Object.keys(gh)) {
        if (!KNOWN_GITHUB_KEYS.has(k)) {
          warnings.push({
            path: `github.${k}`,
            message: `Unknown configuration key 'github.${k}'. It will be ignored.`,
          });
        }
      }

      if (gh.auth_preference !== undefined) {
        if (!["gh", "connected_agent_tool"].includes(gh.auth_preference as string)) {
          errors.push({
            path: "github.auth_preference",
            message: "'github.auth_preference' must be either 'gh' or 'connected_agent_tool'.",
          });
        }
      }

      if (gh.default_branch !== undefined) {
        if (typeof gh.default_branch !== "string" || gh.default_branch.trim().length === 0) {
          errors.push({
            path: "github.default_branch",
            message: "'github.default_branch' must be a non-empty string.",
          });
        }
      }

      if (gh.create_draft_pr !== undefined && typeof gh.create_draft_pr !== "boolean") {
        errors.push({
          path: "github.create_draft_pr",
          message: "'github.create_draft_pr' must be a boolean.",
        });
      }

      if (
        gh.require_issue_approval !== undefined &&
        typeof gh.require_issue_approval !== "boolean"
      ) {
        errors.push({
          path: "github.require_issue_approval",
          message: "'github.require_issue_approval' must be a boolean.",
        });
      }

      if (
        gh.require_release_approval !== undefined &&
        typeof gh.require_release_approval !== "boolean"
      ) {
        errors.push({
          path: "github.require_release_approval",
          message: "'github.require_release_approval' must be a boolean.",
        });
      }
    }
  }

  // 5. quality
  if (raw.quality !== undefined) {
    if (typeof raw.quality !== "object" || raw.quality === null || Array.isArray(raw.quality)) {
      errors.push({
        path: "quality",
        message: "'quality' must be an object.",
      });
    } else {
      const q = raw.quality as Record<string, unknown>;
      for (const k of Object.keys(q)) {
        if (!KNOWN_QUALITY_KEYS.has(k)) {
          warnings.push({
            path: `quality.${k}`,
            message: `Unknown configuration key 'quality.${k}'. It will be ignored.`,
          });
        }
      }

      if (q.reuse_existing_tools !== undefined && typeof q.reuse_existing_tools !== "boolean") {
        errors.push({
          path: "quality.reuse_existing_tools",
          message: "'quality.reuse_existing_tools' must be a boolean.",
        });
      }

      if (q.require_secret_scan !== undefined && typeof q.require_secret_scan !== "boolean") {
        errors.push({
          path: "quality.require_secret_scan",
          message: "'quality.require_secret_scan' must be a boolean.",
        });
      }

      if (
        q.secret_scanner_install_requires_approval !== undefined &&
        typeof q.secret_scanner_install_requires_approval !== "boolean"
      ) {
        errors.push({
          path: "quality.secret_scanner_install_requires_approval",
          message: "'quality.secret_scanner_install_requires_approval' must be a boolean.",
        });
      }

      if (
        q.self_review_required_before_pr !== undefined &&
        typeof q.self_review_required_before_pr !== "boolean"
      ) {
        errors.push({
          path: "quality.self_review_required_before_pr",
          message: "'quality.self_review_required_before_pr' must be a boolean.",
        });
      }

      if (q.extra_checks !== undefined) {
        if (!Array.isArray(q.extra_checks)) {
          errors.push({
            path: "quality.extra_checks",
            message: "'quality.extra_checks' must be an array of strings.",
          });
        } else {
          for (let i = 0; i < q.extra_checks.length; i++) {
            if (typeof q.extra_checks[i] !== "string") {
              errors.push({
                path: `quality.extra_checks[${i}]`,
                message: `'quality.extra_checks[${i}]' must be a string.`,
              });
            }
          }
        }
      }
    }
  }

  // 6. notifications
  if (raw.notifications !== undefined) {
    if (
      typeof raw.notifications !== "object" ||
      raw.notifications === null ||
      Array.isArray(raw.notifications)
    ) {
      errors.push({
        path: "notifications",
        message: "'notifications' must be an object.",
      });
    } else {
      const n = raw.notifications as Record<string, unknown>;
      for (const k of Object.keys(n)) {
        if (!KNOWN_NOTIFICATIONS_KEYS.has(k)) {
          warnings.push({
            path: `notifications.${k}`,
            message: `Unknown configuration key 'notifications.${k}'. It will be ignored.`,
          });
        }
      }

      if (n.session !== undefined && typeof n.session !== "boolean") {
        errors.push({
          path: "notifications.session",
          message: "'notifications.session' must be a boolean.",
        });
      }

      if (n.external !== undefined) {
        if (typeof n.external !== "object" || n.external === null || Array.isArray(n.external)) {
          errors.push({
            path: "notifications.external",
            message: "'notifications.external' must be an object.",
          });
        } else {
          const ext = n.external as Record<string, unknown>;
          for (const k of Object.keys(ext)) {
            if (!KNOWN_EXTERNAL_KEYS.has(k)) {
              warnings.push({
                path: `notifications.external.${k}`,
                message: `Unknown configuration key 'notifications.external.${k}'. It will be ignored.`,
              });
            }
          }

          if (ext.enabled !== undefined && typeof ext.enabled !== "boolean") {
            errors.push({
              path: "notifications.external.enabled",
              message: "'notifications.external.enabled' must be a boolean.",
            });
          }

          if (
            ext.provider !== undefined &&
            ext.provider !== null &&
            typeof ext.provider !== "string"
          ) {
            errors.push({
              path: "notifications.external.provider",
              message: "'notifications.external.provider' must be a string or null.",
            });
          }
        }
      }
    }
  }

  // 7. privacy
  if (raw.privacy !== undefined) {
    if (typeof raw.privacy !== "object" || raw.privacy === null || Array.isArray(raw.privacy)) {
      errors.push({
        path: "privacy",
        message: "'privacy' must be an object.",
      });
    } else {
      const p = raw.privacy as Record<string, unknown>;
      for (const k of Object.keys(p)) {
        if (!KNOWN_PRIVACY_KEYS.has(k)) {
          warnings.push({
            path: `privacy.${k}`,
            message: `Unknown configuration key 'privacy.${k}'. It will be ignored.`,
          });
        }
      }

      if (p.telemetry !== undefined && typeof p.telemetry !== "boolean") {
        errors.push({
          path: "privacy.telemetry",
          message: "'privacy.telemetry' must be a boolean.",
        });
      }
    }
  }

  // 8. Immutable safety invariant checks (FR-CFG-03)
  for (const invariant of IMMUTABLE_SAFETY_INVARIANTS) {
    const value = getNestedValue(raw, invariant.path);
    if (value !== undefined && value !== invariant.expected) {
      errors.push({
        path: invariant.path,
        message: `Safety invariant violation: ${invariant.description} (expected ${String(
          invariant.expected,
        )}, got ${String(value)})`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
};
