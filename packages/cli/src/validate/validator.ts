import * as fs from "node:fs";
import * as path from "node:path";
import {
  isCompatibleVersion,
  loadConfigFile,
  loadManifest,
  parseYaml,
  validateConfig,
  validateExecutionState,
  verifyManifestIntegrity,
} from "@dobbymin/github-convention-core";
import cliPackage from "../../package.json" with { type: "json" };
import type { ValidateOptions, ValidateResult, ValidationCheckItem } from "./types.js";

export function runValidate(options: ValidateOptions = {}): ValidateResult {
  const projectRoot = options.projectRoot || process.cwd();
  const checks: ValidationCheckItem[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Config Validation
  let configPath: string | undefined = options.configPath;
  let explicitConfigSpecified = Boolean(options.configPath);

  if (!configPath) {
    const candidates = [
      path.join(projectRoot, ".github-convention.yaml"),
      path.join(projectRoot, ".github-convention.yml"),
      path.join(projectRoot, ".github-convention.json"),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        configPath = c;
        break;
      }
    }
  }

  if (explicitConfigSpecified && (!configPath || !fs.existsSync(configPath))) {
    checks.push({
      id: "config.exists",
      name: "Configuration file existence",
      status: "fail",
      message: `Specified configuration file does not exist: ${configPath}`,
    });
    errors.push(`Specified configuration file does not exist: ${configPath}`);
  } else if (!configPath || !fs.existsSync(configPath)) {
    checks.push({
      id: "config.exists",
      name: "Configuration file existence",
      status: "pass",
      message: "No custom configuration file found; default convention settings apply.",
    });
  } else {
    try {
      const parsed = loadConfigFile(configPath);
      const validation = validateConfig(parsed);

      if (validation.valid) {
        checks.push({
          id: "config.schema",
          name: "Configuration schema and safety validation",
          status: validation.warnings.length > 0 ? "warn" : "pass",
          message: `Configuration at '${configPath}' is valid.${
            validation.warnings.length > 0 ? ` (${validation.warnings.length} warning(s))` : ""
          }`,
          details: {
            warnings: validation.warnings,
          },
        });
        for (const w of validation.warnings) {
          warnings.push(`[${w.path}] ${w.message}`);
        }
      } else {
        checks.push({
          id: "config.schema",
          name: "Configuration schema and safety validation",
          status: "fail",
          message: `Configuration at '${configPath}' failed validation with ${validation.errors.length} error(s).`,
          details: {
            errors: validation.errors,
            warnings: validation.warnings,
          },
        });
        for (const e of validation.errors) {
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

    // 3. Manifest Integrity Check
    const manifest = loadManifest(skillDir);
    if (manifest) {
      const integrity = verifyManifestIntegrity(skillDir, manifest);
      if (integrity.valid) {
        checks.push({
          id: "skill.integrity",
          name: "Skill installation integrity",
          status: "pass",
          message: `All ${manifest.files.length} managed skill files match SHA-256 integrity manifest.`,
        });
      } else {
        const details = [
          ...integrity.modifiedFiles.map((f) => `modified: ${f}`),
          ...integrity.missingFiles.map((f) => `missing: ${f}`),
          ...integrity.unexpectedFiles.map((f) => `unexpected: ${f}`),
        ].join(", ");
        checks.push({
          id: "skill.integrity",
          name: "Skill installation integrity",
          status: "fail",
          message: `Skill installation integrity violation: ${details}`,
          details: { integrity },
        });
        errors.push(`Skill installation integrity violation: ${details}`);
      }
    }
  }

  // 4. Execution State Validation (if present)
  let statePath = options.statePath;
  if (!statePath) {
    const candidateState = path.join(projectRoot, ".github-convention", "state.json");
    if (fs.existsSync(candidateState)) {
      statePath = candidateState;
    }
  }

  if (statePath && fs.existsSync(statePath)) {
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
        errors.push(`Execution state corrupted: ${stateValidation.errors.join("; ")}`);
      }
    } catch (err) {
      checks.push({
        id: "state.validation",
        name: "Execution state validation",
        status: "fail",
        message: `Execution state file could not be parsed: ${err instanceof Error ? err.message : String(err)}`,
      });
      errors.push("Execution state file could not be parsed.");
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

  const valid = !checks.some((c) => c.status === "fail");

  return {
    valid,
    projectRoot,
    checks,
    errors,
    warnings,
  };
}
