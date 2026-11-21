import * as fs from "node:fs";
import * as path from "node:path";
import {
  DEFAULT_CONFIG,
  analyzeRepository,
  atomicWriteFile,
  computeDirectoryManifest,
  saveManifest,
  stringifyYaml,
  type InstallManifest,
  type RepositoryAnalysis,
} from "@dobbymin/github-convention-core";
import cliPackage from "../../package.json" with { type: "json" };
import { applyGitignorePlan, planGitignoreUpdates } from "../ignore/index.js";
import {
  FALLBACK_SKILL_MD,
  copyDirectoryRecursive,
  resolveSkillSourceDir,
} from "../install/index.js";
import type { InitOptions, InitPlan, InitResult, PlannedFileAction } from "./types.js";

const CONFIG_REL_PATH = ".github-convention/config.yaml";
const CONVENTIONS_README_REL_PATH = ".github-convention/conventions/README.md";
const CANONICAL_SKILL_DIR_REL_PATH = ".agents/skills/github-convention";
const CANONICAL_SKILL_REL_PATH = ".agents/skills/github-convention/SKILL.md";

const buildProjectConfigYaml = (): string => {
  return stringifyYaml(DEFAULT_CONFIG) + "\n";
};

const buildProjectConventionsReadme = (analysis: RepositoryAnalysis): string => {
  const lines: string[] = [
    "# Project Conventions",
    "",
    "This directory stores project-specific workflow and repository conventions",
    "outside the canonical base Skill (`.agents/skills/github-convention/`).",
    "",
    "## Discovered Repository Profile",
    "",
  ];

  const scriptEntries = Object.entries(analysis.scripts).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  if (scriptEntries.length > 0) {
    lines.push("### Package Scripts");
    for (const [kind, scriptName] of scriptEntries) {
      lines.push(`- \`${kind}\`: \`${scriptName}\``);
    }
    lines.push("");
  }

  if (analysis.packageManagers.length > 0) {
    lines.push(
      `- Package Managers: ${analysis.packageManagers.map((pm) => `\`${pm}\``).join(", ")}`,
    );
  }

  if (analysis.git.isGitRepo) {
    lines.push(
      `- Git Branch: ${analysis.git.currentBranch ? `\`${analysis.git.currentBranch}\`` : "detached / unknown"}`,
    );
    if (analysis.git.inferredCommitStyle) {
      lines.push(`- Inferred Commit Style: \`${analysis.git.inferredCommitStyle}\``);
    }
  }

  if (analysis.templates.issueTemplates.length > 0 || analysis.templates.prTemplates.length > 0) {
    lines.push("");
    lines.push("### Existing Templates (Preserved)");
    for (const tpl of [...analysis.templates.issueTemplates, ...analysis.templates.prTemplates]) {
      lines.push(`- \`${tpl}\``);
    }
  }

  if (analysis.conflicts.length > 0) {
    lines.push("");
    lines.push("### Detected Convention Conflicts");
    for (const conflict of analysis.conflicts) {
      const details = conflict.sources.map((s) => `${s.relativePath}=${s.value}`).join(", ");
      lines.push(`- \`${conflict.topic}\` (${conflict.status}): ${details}`);
    }
  }

  lines.push("");
  return lines.join("\n");
};

const buildInitPlanFromAnalysis = (
  projectRoot: string,
  analysis: RepositoryAnalysis,
  adapterFallbackPaths?: string[],
): InitPlan => {
  const configAbsPath = path.join(projectRoot, CONFIG_REL_PATH);
  const configExists = fs.existsSync(configAbsPath);
  const configAction: PlannedFileAction = configExists
    ? {
        relativePath: CONFIG_REL_PATH,
        action: "skip",
        reason: "Project configuration already exists.",
      }
    : {
        relativePath: CONFIG_REL_PATH,
        action: "create",
        reason: "Create default project configuration.",
      };

  const conventionsAbsPath = path.join(projectRoot, CONVENTIONS_README_REL_PATH);
  const conventionsExists = fs.existsSync(conventionsAbsPath);
  const conventionsAction: PlannedFileAction = conventionsExists
    ? {
        relativePath: CONVENTIONS_README_REL_PATH,
        action: "skip",
        reason: "Project conventions README already exists.",
      }
    : {
        relativePath: CONVENTIONS_README_REL_PATH,
        action: "create",
        reason: "Create project-only conventions outside base Skill.",
      };

  const canonicalSkillAbsPath = path.join(projectRoot, CANONICAL_SKILL_REL_PATH);
  const canonicalSkillExists = fs.existsSync(canonicalSkillAbsPath);
  const canonicalSkillAction: PlannedFileAction = canonicalSkillExists
    ? {
        relativePath: CANONICAL_SKILL_REL_PATH,
        action: "skip",
        reason: "Canonical project Skill already exists.",
      }
    : {
        relativePath: CANONICAL_SKILL_REL_PATH,
        action: "create",
        reason: "Create canonical project Skill.",
      };

  const ignorePlan = planGitignoreUpdates({
    projectRoot,
    adapterFallbackPaths,
  });

  const ignoreAction: PlannedFileAction = ignorePlan.changed
    ? {
        relativePath: ".gitignore",
        action: ignorePlan.exists ? "update" : "create",
        reason: `Add ${ignorePlan.entriesToAdd.length} runtime ignore entries.`,
      }
    : {
        relativePath: ".gitignore",
        action: "skip",
        reason: "All required runtime ignore entries are already present.",
      };

  return {
    projectRoot,
    analysis,
    configAction,
    conventionsAction,
    canonicalSkillAction,
    ignorePlan,
    actions: [configAction, conventionsAction, canonicalSkillAction, ignoreAction],
    ...(configAction.action === "create" ? { proposedConfigYaml: buildProjectConfigYaml() } : {}),
    ...(conventionsAction.action === "create"
      ? { proposedConventionsReadme: buildProjectConventionsReadme(analysis) }
      : {}),
  };
};

export const planInit = (options: InitOptions = {}): InitPlan => {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const { analysis } = analyzeRepository({
    projectRoot,
    dryRun: true,
  });

  return buildInitPlanFromAnalysis(projectRoot, analysis, options.adapterFallbackPaths);
};

export const executeInit = (options: InitOptions = {}): InitResult => {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const dryRun = options.dryRun ?? false;

  const { analysis, cacheWritten } = analyzeRepository({
    projectRoot,
    dryRun,
  });

  const plan = buildInitPlanFromAnalysis(projectRoot, analysis, options.adapterFallbackPaths);
  const writtenFiles: string[] = [];

  if (!dryRun) {
    if (plan.configAction.action === "create" && plan.proposedConfigYaml !== undefined) {
      atomicWriteFile(path.join(projectRoot, CONFIG_REL_PATH), plan.proposedConfigYaml);
      writtenFiles.push(CONFIG_REL_PATH);
    }

    if (
      plan.conventionsAction.action === "create" &&
      plan.proposedConventionsReadme !== undefined
    ) {
      atomicWriteFile(
        path.join(projectRoot, CONVENTIONS_README_REL_PATH),
        plan.proposedConventionsReadme,
      );
      writtenFiles.push(CONVENTIONS_README_REL_PATH);
    }

    if (plan.canonicalSkillAction.action === "create") {
      const canonicalSkillDir = path.join(projectRoot, CANONICAL_SKILL_DIR_REL_PATH);
      const resolvedSourceDir = resolveSkillSourceDir(projectRoot);
      if (resolvedSourceDir) {
        copyDirectoryRecursive(resolvedSourceDir, canonicalSkillDir);
      } else {
        fs.mkdirSync(canonicalSkillDir, { recursive: true });
        fs.writeFileSync(path.join(canonicalSkillDir, "SKILL.md"), FALLBACK_SKILL_MD, "utf-8");
      }

      const files = computeDirectoryManifest(canonicalSkillDir);
      const manifest: InstallManifest = {
        schemaVersion: 1,
        skillName: "github-convention",
        skillVersion: cliPackage.version,
        installedAt: new Date().toISOString(),
        agentId: "canonical",
        scope: "project",
        targetPath: canonicalSkillDir,
        installType: "canonical",
        files,
      };
      saveManifest(canonicalSkillDir, manifest);
      writtenFiles.push(CANONICAL_SKILL_REL_PATH);
    }

    if (applyGitignorePlan(plan.ignorePlan, false)) {
      writtenFiles.push(".gitignore");
    }
  }

  const warnings = analysis.conflicts
    .filter((c) => c.status === "unresolved")
    .map(
      (c) =>
        `[conflict:${c.topic}] ${c.sources.map((s) => `${s.relativePath}=${s.value}`).join(" vs ")}`,
    );

  return {
    projectRoot,
    dryRun,
    initialized: !dryRun,
    cacheWritten,
    plan,
    writtenFiles,
    warnings,
  };
};
