import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  isCompatibleVersion,
  loadConfigFile,
  loadManifest,
  parseYaml,
  resolveConfig,
  validateConfig,
  validateExecutionState,
  verifyManifestIntegrity,
} from "@dobbymin/github-convention-core";
import cliPackage from "../../package.json" with { type: "json" };
import {
  findGlobalConfigFile,
  findProjectConfigFile,
  probeConventionConflicts,
} from "../doctor/probes.js";
import { runList } from "../list/index.js";
import type { ValidateOptions, ValidateResult, ValidationCheckItem } from "./types.js";

const collectRunStatePaths = (projectRoot: string): string[] => {
  const candidates: string[] = [];
  const stateDirs = [
    path.join(projectRoot, ".github-convention", "state", "active"),
    path.join(projectRoot, ".github-convention", "state", "archive"),
  ];

  for (const dir of stateDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      if (
        !entry.endsWith(".json") ||
        entry.endsWith(".lock.json") ||
        entry === "plan.json" ||
        entry.startsWith("approvals-")
      ) {
        continue;
      }
      candidates.push(path.join(dir, entry));
    }
  }

  const legacyState = path.join(projectRoot, ".github-convention", "state.json");
  if (fs.existsSync(legacyState)) {
    candidates.push(legacyState);
  }

  return candidates;
};

export function runValidate(options: ValidateOptions = {}): ValidateResult {
  const projectRoot = options.projectRoot || process.cwd();
  const homeDir = options.homeDir || os.homedir();
  const checks: ValidationCheckItem[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Config Validation
  const explicitConfigSpecified = Boolean(options.configPath);
  const configPath: string | undefined =
    options.configPath ?? findProjectConfigFile(projectRoot) ?? undefined;
  const globalConfigPath = findGlobalConfigFile(homeDir) ?? undefined;

  if (explicitConfigSpecified && (!configPath || !fs.existsSync(configPath))) {
    checks.push({
      id: "config.exists",
      name: "Configuration file existence",
      status: "fail",
      message: `Specified configuration file does not exist: ${configPath}`,
    });
    errors.push(`Specified configuration file does not exist: ${configPath}`);
  } else if ((!configPath || !fs.existsSync(configPath)) && !globalConfigPath) {
    checks.push({
      id: "config.exists",
      name: "Configuration file existence",
      status: "pass",
      message: "No custom configuration file found; default convention settings apply.",
    });
  } else {
    try {
      const validationErrors: Array<{ path: string; message: string }> = [];
      const validationWarnings: Array<{ path: string; message: string }> = [];

      if (configPath && fs.existsSync(configPath)) {
        const parsed = loadConfigFile(configPath);
        const validation = validateConfig(parsed);
        validationErrors.push(...validation.errors);
        validationWarnings.push(...validation.warnings);
      }

      if (validationErrors.length === 0) {
        const resolved = resolveConfig({
          ...(globalConfigPath ? { globalConfigPath } : {}),
          ...(configPath && fs.existsSync(configPath) ? { projectConfigPath: configPath } : {}),
        });
        for (const w of resolved.warnings) {
          if (
            !validationWarnings.some(
              (existing) => existing.path === w.path && existing.message === w.message,
            )
          ) {
            validationWarnings.push(w);
          }
        }
      }

      const displayPath = configPath ?? globalConfigPath;
      if (validationErrors.length === 0) {
        checks.push({
          id: "config.schema",
          name: "Configuration schema and safety validation",
          status: validationWarnings.length > 0 ? "warn" : "pass",
          message: `Configuration at '${displayPath}' is valid.${
            validationWarnings.length > 0 ? ` (${validationWarnings.length} warning(s))` : ""
          }`,
          details: {
            warnings: validationWarnings,
          },
        });
        for (const w of validationWarnings) {
          warnings.push(`[${w.path}] ${w.message}`);
        }
      } else {
        checks.push({
          id: "config.schema",
          name: "Configuration schema and safety validation",
          status: "fail",
          message: `Configuration at '${displayPath}' failed validation with ${validationErrors.length} error(s).`,
          details: {
            errors: validationErrors,
            warnings: validationWarnings,
          },
        });
        for (const e of validationErrors) {
          errors.push(`[${e.path}] ${e.message}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      checks.push({
        id: "config.parse",
        name: "Configuration parse error",
        status: "fail",
        message: msg,
      });
      errors.push(msg);
    }
  }

  // 2. Canonical Skill Structure & Frontmatter Validation
  const skillDir =
    options.skillDir || path.join(projectRoot, ".agents", "skills", "github-convention");

  if (fs.existsSync(skillDir)) {
    const skillMdPath = path.join(skillDir, "SKILL.md");
    if (!fs.existsSync(skillMdPath)) {
      checks.push({
        id: "skill.skill_md",
        name: "SKILL.md file existence",
        status: "fail",
        message: `Missing required 'SKILL.md' in skill directory: ${skillDir}`,
      });
      errors.push(`Missing 'SKILL.md' in ${skillDir}`);
    } else {
      const content = fs.readFileSync(skillMdPath, "utf-8");
      const match = /^---\s*\n([\s\S]*?)\n---/.exec(content);
      if (!match) {
        checks.push({
          id: "skill.frontmatter",
          name: "SKILL.md YAML frontmatter",
          status: "fail",
          message: "SKILL.md is missing YAML frontmatter enclosed by '---'.",
        });
        errors.push("SKILL.md is missing YAML frontmatter.");
      } else {
        try {
          const frontmatter = parseYaml(match[1]) as Record<string, unknown>;
          if (
            typeof frontmatter.name !== "string" ||
            !frontmatter.name.trim() ||
            typeof frontmatter.description !== "string" ||
            !frontmatter.description.trim()
          ) {
            checks.push({
              id: "skill.frontmatter",
              name: "SKILL.md YAML frontmatter fields",
              status: "fail",
              message:
                "SKILL.md frontmatter must contain non-empty 'name' and 'description' fields.",
            });
            errors.push("Invalid SKILL.md frontmatter fields.");
          } else {
            checks.push({
              id: "skill.frontmatter",
              name: "SKILL.md YAML frontmatter",
              status: "pass",
              message: `SKILL.md frontmatter valid for '${frontmatter.name}'.`,
            });
          }
        } catch (err) {
          checks.push({
            id: "skill.frontmatter",
            name: "SKILL.md YAML frontmatter parsing",
            status: "fail",
            message: `Failed to parse YAML frontmatter: ${err instanceof Error ? err.message : String(err)}`,
          });
          errors.push("Failed to parse SKILL.md YAML frontmatter.");
        }
      }
    }

    // Skill package.json compatibility check if present
    const skillPkgPath = path.join(skillDir, "package.json");
    if (fs.existsSync(skillPkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(skillPkgPath, "utf-8"));
        const cliRange = pkg.githubConvention?.compatibleCli;
        if (cliRange && typeof cliRange === "string") {
          const compatible = isCompatibleVersion(cliPackage.version, cliRange);
          if (compatible) {
            checks.push({
              id: "skill.compatibility",
              name: "Skill and CLI version compatibility",
              status: "pass",
              message: `CLI version ${cliPackage.version} is compatible with Skill version ${pkg.version} (${cliRange}).`,
            });
          } else {
            checks.push({
              id: "skill.compatibility",
              name: "Skill and CLI version compatibility",
              status: "fail",
              message: `CLI version ${cliPackage.version} is incompatible with Skill requirement ${cliRange}.`,
            });
            errors.push(
              `CLI version ${cliPackage.version} is incompatible with Skill requirement ${cliRange}.`,
            );
          }
        }
      } catch (err) {
        checks.push({
          id: "skill.package",
          name: "Skill package.json validation",
          status: "warn",
          message: `Could not parse skill package.json: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  // 3. Manifest Integrity Check (canonical + all installed agent targets)
  const seenTargets = new Set<string>();
  const targetsToCheck: Array<{ label: string; dir: string }> = [];

  const addTarget = (label: string, dir: string): void => {
    const resolved = path.resolve(dir);
    if (seenTargets.has(resolved) || !fs.existsSync(resolved)) return;
    try {
      if (fs.lstatSync(resolved).isSymbolicLink()) return;
    } catch {
      return;
    }
    seenTargets.add(resolved);
    targetsToCheck.push({ label, dir: resolved });
  };

  addTarget("canonical", skillDir);
  const listResult = runList({ projectRoot, homeDir });
  for (const agent of listResult.agents) {
    if (agent.project.installed && !agent.project.symlink) {
      addTarget(`${agent.agentId}(project)`, agent.project.path);
    }
    if (agent.global.installed && !agent.global.symlink) {
      addTarget(`${agent.agentId}(global)`, agent.global.path);
    }
  }

  for (const target of targetsToCheck) {
    const manifest = loadManifest(target.dir);
    if (!manifest) continue;
    const integrity = verifyManifestIntegrity(target.dir, manifest);
    if (integrity.valid) {
      checks.push({
        id: "skill.integrity",
        name: `Skill installation integrity (${target.label})`,
        status: "pass",
        message: `All ${manifest.files.length} managed skill files at ${target.label} match SHA-256 integrity manifest.`,
      });
    } else {
      const details = [
        ...integrity.modifiedFiles.map((f) => `modified: ${f}`),
        ...integrity.missingFiles.map((f) => `missing: ${f}`),
        ...integrity.unexpectedFiles.map((f) => `unexpected: ${f}`),
      ].join(", ");
      checks.push({
        id: "skill.integrity",
        name: `Skill installation integrity (${target.label})`,
        status: "fail",
        message: `Skill installation integrity violation at ${target.label}: ${details}`,
        details: { integrity, target: target.dir },
      });
      errors.push(`Skill installation integrity violation (${target.label}): ${details}`);
    }
  }

  // 4. Execution State Validation (all active/archive/legacy state files if present)
  const statePaths = options.statePath
    ? fs.existsSync(options.statePath)
      ? [options.statePath]
      : []
    : collectRunStatePaths(projectRoot);

  for (const statePath of statePaths) {
    try {
      const rawState = JSON.parse(fs.readFileSync(statePath, "utf-8"));
      const stateValidation = validateExecutionState(rawState);
      if (stateValidation.valid) {
        checks.push({
          id: "state.validation",
          name: "Execution state validation",
          status: "pass",
          message: `Execution state at '${statePath}' is valid.`,
        });
      } else {
        checks.push({
          id: "state.validation",
          name: "Execution state validation",
          status: "fail",
          message: `Execution state at '${statePath}' is corrupted: ${stateValidation.errors.join("; ")}`,
          details: { errors: stateValidation.errors },
        });
        errors.push(
          `Execution state corrupted (${statePath}): ${stateValidation.errors.join("; ")}`,
        );
      }
    } catch (err) {
      checks.push({
        id: "state.validation",
        name: "Execution state validation",
        status: "fail",
        message: `Execution state file '${statePath}' could not be parsed: ${err instanceof Error ? err.message : String(err)}`,
      });
      errors.push(`Execution state file '${statePath}' could not be parsed.`);
    }
  }

  // 5. Convention Extensions Validation (if present)
  const conventionsDir = path.join(projectRoot, ".github-convention", "conventions");
  if (fs.existsSync(conventionsDir)) {
    try {
      const entries = fs.readdirSync(conventionsDir);
      const invalidFiles = entries.filter((f) => !f.endsWith(".md") && !f.endsWith(".yaml"));
      if (invalidFiles.length > 0) {
        checks.push({
          id: "conventions.files",
          name: "Conventions extension files",
          status: "warn",
          message: `Non-standard convention file format detected: ${invalidFiles.join(", ")} (expected .md or .yaml).`,
        });
        warnings.push(`Non-standard convention files: ${invalidFiles.join(", ")}`);
      } else {
        checks.push({
          id: "conventions.files",
          name: "Conventions extension files",
          status: "pass",
          message: `Conventions extensions valid (${entries.length} file(s)).`,
        });
      }
    } catch (err) {
      checks.push({
        id: "conventions.files",
        name: "Conventions extension files",
        status: "warn",
        message: `Could not read conventions directory: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // 6. Unresolved Convention Conflicts Check
  const unresolvedConflicts = probeConventionConflicts(projectRoot);
  if (unresolvedConflicts.length > 0) {
    const summary = unresolvedConflicts
      .map(
        (c) => `${c.topic}: ${c.sources.map((s) => `${s.relativePath}=${s.value}`).join(" vs ")}`,
      )
      .join("; ");
    checks.push({
      id: "conventions.conflicts",
      name: "Repository convention conflicts",
      status: "warn",
      message: `Unresolved convention conflict(s) detected: ${summary}`,
      details: { conflicts: unresolvedConflicts },
    });
    warnings.push(`Unresolved convention conflict(s): ${summary}`);
  } else {
    checks.push({
      id: "conventions.conflicts",
      name: "Repository convention conflicts",
      status: "pass",
      message: "No unresolved convention conflicts detected.",
    });
  }

  const valid = !checks.some((c) => c.status === "fail");

  return {
    valid,
    projectRoot,
    checks,
    errors,
    warnings,
  };
}
