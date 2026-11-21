import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_CONFIG,
  mergeObjects,
  migrateConfigFile,
  migrateConfigObject,
  parseYaml,
  resolveConfig,
  stringifyYaml,
  validateConfig,
} from "./index.js";

test("mergeObjects: recursively merges objects and completely replaces arrays", () => {
  const base = {
    schema_version: 1,
    execution: {
      sub_agents: "auto",
      max_parallel_agents: 3,
      retry: {
        worker_max_retries: 2,
        code_ci_max_retries: 2,
      },
    },
    quality: {
      extra_checks: ["npm run lint", "npm test"],
    },
    archive: {
      retention_days: 30,
    },
  };

  const override = {
    execution: {
      max_parallel_agents: 5,
      retry: {
        worker_max_retries: 4,
      },
    },
    quality: {
      extra_checks: ["npm run test:fast"],
    },
  };

  const result = mergeObjects(base, override);

  // Scalars replaced
  assert.equal((result.execution as Record<string, unknown>).max_parallel_agents, 5);
  // Nested object merged recursively
  assert.equal(
    ((result.execution as Record<string, unknown>).retry as Record<string, unknown>)
      .worker_max_retries,
    4,
  );
  // Unsupplied keys preserved from base
  assert.equal((result.execution as Record<string, unknown>).sub_agents, "auto");
  assert.equal(
    ((result.execution as Record<string, unknown>).retry as Record<string, unknown>)
      .code_ci_max_retries,
    2,
  );
  assert.equal((result.archive as Record<string, unknown>).retention_days, 30);
  // Arrays replaced completely, NOT concatenated
  assert.deepEqual((result.quality as Record<string, unknown>).extra_checks, ["npm run test:fast"]);
});

test("validateConfig: succeeds on valid default config", () => {
  const validation = validateConfig(DEFAULT_CONFIG);
  assert.equal(validation.valid, true);
  assert.equal(validation.errors.length, 0);
  assert.equal(validation.warnings.length, 0);
});

test("validateConfig: strictly blocks safety invariant violations (FR-CFG-03)", () => {
  // 1. require_issue_approval: false
  const violated1 = {
    ...DEFAULT_CONFIG,
    github: {
      ...DEFAULT_CONFIG.github,
      require_issue_approval: false,
    },
  };
  const val1 = validateConfig(violated1);
  assert.equal(val1.valid, false);
  assert.ok(val1.errors.some((e) => e.path === "github.require_issue_approval"));

  // 2. require_release_approval: false
  const violated2 = {
    ...DEFAULT_CONFIG,
    github: {
      ...DEFAULT_CONFIG.github,
      require_release_approval: false,
    },
  };
  const val2 = validateConfig(violated2);
  assert.equal(val2.valid, false);
  assert.ok(val2.errors.some((e) => e.path === "github.require_release_approval"));

  // 3. create_draft_pr: true
  const violated3 = {
    ...DEFAULT_CONFIG,
    github: {
      ...DEFAULT_CONFIG.github,
      create_draft_pr: true,
    },
  };
  const val3 = validateConfig(violated3);
  assert.equal(val3.valid, false);
  assert.ok(val3.errors.some((e) => e.path === "github.create_draft_pr"));

  // 4. require_secret_scan: false
  const violated4 = {
    ...DEFAULT_CONFIG,
    quality: {
      ...DEFAULT_CONFIG.quality,
      require_secret_scan: false,
    },
  };
  const val4 = validateConfig(violated4);
  assert.equal(val4.valid, false);
  assert.ok(val4.errors.some((e) => e.path === "quality.require_secret_scan"));

  // 5. secret_scanner_install_requires_approval: false
  const violated5 = {
    ...DEFAULT_CONFIG,
    quality: {
      ...DEFAULT_CONFIG.quality,
      secret_scanner_install_requires_approval: false,
    },
  };
  const val5 = validateConfig(violated5);
  assert.equal(val5.valid, false);
  assert.ok(val5.errors.some((e) => e.path === "quality.secret_scanner_install_requires_approval"));

  // 6. self_review_required_before_pr: false
  const violated6 = {
    ...DEFAULT_CONFIG,
    quality: {
      ...DEFAULT_CONFIG.quality,
      self_review_required_before_pr: false,
    },
  };
  const val6 = validateConfig(violated6);
  assert.equal(val6.valid, false);
  assert.ok(val6.errors.some((e) => e.path === "quality.self_review_required_before_pr"));

  // 7. telemetry: true
  const violated7 = {
    ...DEFAULT_CONFIG,
    privacy: {
      telemetry: true,
    },
  };
  const val7 = validateConfig(violated7);
  assert.equal(val7.valid, false);
  assert.ok(val7.errors.some((e) => e.path === "privacy.telemetry"));
});

test("validateConfig: blocks invalid known keys and warns on unknown keys (FR-CFG-04)", () => {
  const invalid = {
    ...DEFAULT_CONFIG,
    execution: {
      ...DEFAULT_CONFIG.execution,
      max_parallel_agents: 999, // Exceeds 64
      custom_unknown_flag: true, // Unknown
    },
    unknown_root_property: "hello", // Unknown
  };

  const validation = validateConfig(invalid);
  assert.equal(validation.valid, false);
  // Known invalid setting fails
  assert.ok(validation.errors.some((e) => e.path === "execution.max_parallel_agents"));
  // Unknown keys produce actionable warnings
  assert.ok(validation.warnings.some((w) => w.path === "unknown_root_property"));
  assert.ok(validation.warnings.some((w) => w.path === "execution.custom_unknown_flag"));
});

test("yaml parser and serializer: parses examples/config.yaml and preserves structure", () => {
  const examplePath = path.resolve(process.cwd(), "examples/config.yaml");
  const yamlContent = fs.readFileSync(examplePath, "utf-8");
  const parsed = parseYaml(yamlContent) as Record<string, unknown>;

  assert.equal(parsed.schema_version, 1);
  assert.equal((parsed.execution as Record<string, unknown>).sub_agents, "auto");
  assert.equal((parsed.execution as Record<string, unknown>).max_parallel_agents, 3);
  assert.equal((parsed.archive as Record<string, unknown>).retention_days, 30);
  assert.equal((parsed.archive as Record<string, unknown>).auto_cleanup_on_cli_start, true);
  assert.equal((parsed.github as Record<string, unknown>).auth_preference, "gh");
  assert.equal((parsed.github as Record<string, unknown>).default_branch, "detect");
  assert.equal((parsed.privacy as Record<string, unknown>).telemetry, false);

  const serialized = stringifyYaml(parsed);
  const reParsed = parseYaml(serialized) as Record<string, unknown>;
  assert.deepEqual(reParsed, parsed);
});

test("migration: migrates legacy version 0 config to version 1 with backup (FR-CFG-05)", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cfg-mig-test-"));
  const testConfigPath = path.join(tmpDir, "config.yaml");

  // Legacy config without schema_version and with camelCase keys
  const legacyYaml = `
maxParallelAgents: 5
retentionDays: 45
github:
  auth_preference: gh
`;
  fs.writeFileSync(testConfigPath, legacyYaml, "utf-8");

  const result = await migrateConfigFile(testConfigPath);
  assert.equal(result.migrated, true);
  assert.equal(result.fromVersion, 0);
  assert.equal(result.toVersion, CURRENT_SCHEMA_VERSION);
  assert.ok(result.backupPath);
  assert.ok(fs.existsSync(result.backupPath));

  // Check backup preserves original content
  const backupContent = fs.readFileSync(result.backupPath, "utf-8");
  assert.equal(backupContent, legacyYaml);

  // Check migrated file is valid version 1 config
  const migratedContent = fs.readFileSync(testConfigPath, "utf-8");
  const migratedParsed = parseYaml(migratedContent) as Record<string, unknown>;
  assert.equal(migratedParsed.schema_version, 1);
  assert.equal((migratedParsed.execution as Record<string, unknown>).max_parallel_agents, 5);
  assert.equal((migratedParsed.archive as Record<string, unknown>).retention_days, 45);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("migration: detects semantic conflict and halts without side effects", () => {
  const conflictingConfig = {
    enable_subagents: true,
    disable_subagents: true,
    maxParallelAgents: 4,
  };

  const outcome = migrateConfigObject(conflictingConfig);
  assert.equal(outcome.migrated, false);
  assert.ok(outcome.conflict);
  assert.equal(outcome.conflict.field, "enable_subagents/disable_subagents");
});

test("resolveConfig: combines defaults, global and project configs", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cfg-resolve-test-"));
  const globalPath = path.join(tmpDir, "global-config.yaml");
  const projectPath = path.join(tmpDir, "project-config.yaml");

  fs.writeFileSync(
    globalPath,
    `
execution:
  max_parallel_agents: 4
archive:
  retention_days: 60
`,
    "utf-8",
  );

  fs.writeFileSync(
    projectPath,
    `
execution:
  max_parallel_agents: 8
quality:
  extra_checks:
    - "npm run custom:check"
`,
    "utf-8",
  );

  const resolved = resolveConfig({
    globalConfigPath: globalPath,
    projectConfigPath: projectPath,
  });

  // Project overrides global and default
  assert.equal(resolved.config.execution.max_parallel_agents, 8);
  // Global overrides default
  assert.equal(resolved.config.archive.retention_days, 60);
  // Inherited default
  assert.equal(resolved.config.execution.sub_agents, "auto");
  assert.equal(resolved.config.github.require_issue_approval, true);
  // Array replaced
  assert.deepEqual(resolved.config.quality.extra_checks, ["npm run custom:check"]);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
