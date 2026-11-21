import * as fs from "node:fs";
import * as path from "node:path";
import { CURRENT_SCHEMA_VERSION, DEFAULT_CONFIG } from "./constants.js";
import { mergeObjects } from "./merge.js";
import type { GitHubConventionConfig, MigrationResult } from "./types.js";
import { validateConfig } from "./validate.js";
import { parseYaml, stringifyYaml } from "./yaml.js";

export interface MigrationEngineOptions {
  requireApprovalForConflict?: boolean;
}

export type MigrationFunction = (raw: Record<string, unknown>) => {
  migrated: Record<string, unknown>;
  conflict?: { field: string; reason: string };
};

/**
 * Migration registry from version N to N + 1.
 */
const MIGRATIONS: Record<number, MigrationFunction> = {
  // Version 0 (legacy or unversioned) -> Version 1
  0: (raw: Record<string, unknown>) => {
    const migrated = { ...raw };

    // Check for semantic conflict example: conflicting obsolete keys
    if (migrated.enable_subagents !== undefined && migrated.disable_subagents !== undefined) {
      if (Boolean(migrated.enable_subagents) === Boolean(migrated.disable_subagents)) {
        return {
          migrated,
          conflict: {
            field: "enable_subagents/disable_subagents",
            reason:
              "Contradictory legacy keys: both enable_subagents and disable_subagents are set to conflicting truth values.",
          },
        };
      }
    }

    // Convert legacy camelCase keys if present
    if (migrated.maxParallelAgents !== undefined) {
      if (!migrated.execution) migrated.execution = {};
      (migrated.execution as Record<string, unknown>).max_parallel_agents =
        migrated.maxParallelAgents;
      delete migrated.maxParallelAgents;
    }

    if (migrated.retentionDays !== undefined) {
      if (!migrated.archive) migrated.archive = {};
      (migrated.archive as Record<string, unknown>).retention_days = migrated.retentionDays;
      delete migrated.retentionDays;
    }

    migrated.schema_version = 1;

    return { migrated };
  },
};

export const migrateConfigObject = (
  rawInput: Record<string, unknown>,
): {
  migrated: boolean;
  fromVersion: number;
  toVersion: number;
  config: Record<string, unknown>;
  conflict?: { field: string; reason: string };
} => {
  const fromVersion =
    typeof rawInput.schema_version === "number" && Number.isInteger(rawInput.schema_version)
      ? rawInput.schema_version
      : 0;

  if (fromVersion === CURRENT_SCHEMA_VERSION) {
    return {
      migrated: false,
      fromVersion,
      toVersion: CURRENT_SCHEMA_VERSION,
      config: rawInput,
    };
  }

  if (fromVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported configuration schema_version ${fromVersion}. Current supported version is ${CURRENT_SCHEMA_VERSION}.`,
    );
  }

  // Staged migration step-by-step
  let currentVersion = fromVersion;
  let staged = { ...rawInput };

  while (currentVersion < CURRENT_SCHEMA_VERSION) {
    const migrationFn = MIGRATIONS[currentVersion];
    if (!migrationFn) {
      throw new Error(`No migration step defined from schema version ${currentVersion}.`);
    }

    const { migrated, conflict } = migrationFn(staged);
    if (conflict) {
      return {
        migrated: false,
        fromVersion,
        toVersion: CURRENT_SCHEMA_VERSION,
        config: rawInput,
        conflict,
      };
    }

    staged = migrated;
    currentVersion++;
  }

  return {
    migrated: true,
    fromVersion,
    toVersion: CURRENT_SCHEMA_VERSION,
    config: staged,
  };
};

export const migrateConfigFile = async (
  filePath: string,
  options?: { backupDir?: string },
): Promise<MigrationResult> => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Configuration file does not exist: ${filePath}`);
  }

  const fileContent = fs.readFileSync(filePath, "utf-8");
  const parsed = parseYaml(fileContent);

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Configuration file content must be a YAML/JSON object: ${filePath}`);
  }

  const rawConfig = parsed as Record<string, unknown>;
  const migrationOutcome = migrateConfigObject(rawConfig);

  if (migrationOutcome.conflict) {
    return {
      migrated: false,
      fromVersion: migrationOutcome.fromVersion,
      toVersion: migrationOutcome.toVersion,
      config: rawConfig as unknown as GitHubConventionConfig,
      conflict: migrationOutcome.conflict,
    };
  }

  if (!migrationOutcome.migrated) {
    const merged = mergeObjects(DEFAULT_CONFIG as unknown as Record<string, unknown>, rawConfig);
    const validation = validateConfig(merged);
    if (!validation.valid) {
      throw new Error(
        `Configuration validation failed:\n${validation.errors
          .map((e) => ` - [${e.path}] ${e.message}`)
          .join("\n")}`,
      );
    }
    return {
      migrated: false,
      fromVersion: migrationOutcome.fromVersion,
      toVersion: migrationOutcome.toVersion,
      config: merged as unknown as GitHubConventionConfig,
    };
  }

  // Merge staged result with defaults and validate
  const mergedStaged = mergeObjects(
    DEFAULT_CONFIG as unknown as Record<string, unknown>,
    migrationOutcome.config,
  );
  const validation = validateConfig(mergedStaged);

  if (!validation.valid) {
    // Staging failed validation - abort without side effects
    throw new Error(
      `Staged migration failed validation. Rolled back without changes:\n${validation.errors
        .map((e) => ` - [${e.path}] ${e.message}`)
        .join("\n")}`,
    );
  }

  // Create backup first
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dirName = options?.backupDir ?? path.dirname(filePath);
  const baseName = path.basename(filePath);
  const backupPath = path.join(dirName, `${baseName}.bak.${timestamp}`);

  fs.writeFileSync(backupPath, fileContent, "utf-8");

  try {
    const newYaml = stringifyYaml(migrationOutcome.config);
    fs.writeFileSync(filePath, newYaml, "utf-8");
  } catch (writeError) {
    // Rollback to original content
    fs.writeFileSync(filePath, fileContent, "utf-8");
    throw new Error(
      `Failed to write migrated configuration. Restored from backup. Reason: ${String(writeError)}`,
    );
  }

  return {
    migrated: true,
    fromVersion: migrationOutcome.fromVersion,
    toVersion: migrationOutcome.toVersion,
    config: mergedStaged as unknown as GitHubConventionConfig,
    backupPath,
  };
};
