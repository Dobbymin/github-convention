import * as fs from "node:fs";
import { DEFAULT_CONFIG } from "./constants.js";
import { mergeObjects } from "./merge.js";
import type { GitHubConventionConfig, ValidationIssue } from "./types.js";
import { validateConfig } from "./validate.js";
import { parseYaml } from "./yaml.js";

export interface LoadConfigOptions {
  globalConfigPath?: string;
  projectConfigPath?: string;
  allowWarnings?: boolean;
}

export interface ResolvedConfigResult {
  config: GitHubConventionConfig;
  warnings: ValidationIssue[];
  sources: {
    global?: string;
    project?: string;
  };
}

export const loadConfigFile = (filePath: string): Record<string, unknown> => {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const content = fs.readFileSync(filePath, "utf-8");
  const parsed = parseYaml(content);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Configuration file at '${filePath}' must be a YAML/JSON object.`);
  }
  return parsed as Record<string, unknown>;
};

export const resolveConfig = (options?: LoadConfigOptions): ResolvedConfigResult => {
  const sources: { global?: string; project?: string } = {};

  let globalData: Record<string, unknown> = {};
  if (options?.globalConfigPath && fs.existsSync(options.globalConfigPath)) {
    globalData = loadConfigFile(options.globalConfigPath);
    sources.global = options.globalConfigPath;
  }

  let projectData: Record<string, unknown> = {};
  if (options?.projectConfigPath && fs.existsSync(options.projectConfigPath)) {
    projectData = loadConfigFile(options.projectConfigPath);
    sources.project = options.projectConfigPath;
  }

  // 1. Start with defaults
  const withGlobal = mergeObjects(DEFAULT_CONFIG as unknown as Record<string, unknown>, globalData);

  // 2. Override with project data
  const finalMerged = mergeObjects(withGlobal, projectData);

  // 3. Validate
  const validation = validateConfig(finalMerged);

  if (!validation.valid) {
    const errorDetails = validation.errors.map((e) => ` - [${e.path}] ${e.message}`).join("\n");
    throw new Error(`Configuration validation failed:\n${errorDetails}`);
  }

  return {
    config: finalMerged as unknown as GitHubConventionConfig,
    warnings: validation.warnings,
    sources,
  };
};
