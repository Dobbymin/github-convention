import * as fs from "node:fs";
import * as path from "node:path";
import type { DetectedQualityTools, QualityGateInputs, QualityGateResult } from "./types.js";

export const detectProjectQualityTools = (projectRoot: string): DetectedQualityTools => {
  const pkgPath = path.join(projectRoot, "package.json");
  let scripts: Record<string, string> = {};
  if (fs.existsSync(pkgPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
        scripts?: Record<string, string>;
      };
      if (parsed.scripts && typeof parsed.scripts === "object") {
        scripts = parsed.scripts;
      }
    } catch {
      scripts = {};
    }
  }

  const hasHooks =
    fs.existsSync(path.join(projectRoot, ".githooks", "pre-commit")) ||
    fs.existsSync(path.join(projectRoot, ".husky", "pre-commit"));

  const workflowsDir = path.join(projectRoot, ".github", "workflows");
  const hasCiWorkflows =
    fs.existsSync(workflowsDir) &&
    fs.readdirSync(workflowsDir).some((name) => name.endsWith(".yml") || name.endsWith(".yaml"));

  const hasSecretScanner =
    "secret-scan" in scripts ||
    fs.existsSync(path.join(projectRoot, ".gitleaks.toml")) ||
    fs.existsSync(path.join(projectRoot, ".github", "workflows", "secret-scan.yml"));

  return {
    scripts,
    hasHooks,
    hasCiWorkflows,
    hasSecretScanner,
    ...(!hasSecretScanner
      ? {
          installProposal: {
            tool: "gitleaks",
            requiresApproval: true as const,
            reason:
              "No dedicated external secret scanner detected; propose installation and obtain explicit approval before adding tools or hooks.",
          },
        }
      : {}),
  };
};

export const evaluateQualityGates = (inputs: QualityGateInputs): QualityGateResult => {
  const failedGates: string[] = [];
  if (!inputs.acceptanceCriteriaPassed) failedGates.push("acceptance_criteria");
  if (!inputs.testsPassed) failedGates.push("tests");
  if (!inputs.secretScanClean) failedGates.push("secret_scan");
  if (!inputs.selfReviewPassed) failedGates.push("self_review");
  if (!inputs.rebasedOnLatestBase) failedGates.push("latest_base_revalidation");

  return {
    passed: failedGates.length === 0,
    failedGates,
  };
};
