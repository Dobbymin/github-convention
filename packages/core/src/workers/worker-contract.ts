import type {
  ForbiddenWorkerAction,
  WorkerAssignment,
  WorkerVerificationInput,
  WorkerVerificationResult,
} from "./types.js";

const DEFAULT_FORBIDDEN_ACTIONS: readonly ForbiddenWorkerAction[] = [
  "git_commit",
  "git_push",
  "github_issue_mutation",
  "github_pr_mutation",
  "github_label_mutation",
  "review_thread_resolve",
  "pr_merge",
  "shared_state_write",
];

const toPosix = (value: string): string => value.replaceAll("\\", "/").replace(/^\.\//, "");

const matchesAllowedPattern = (filePath: string, pattern: string): boolean => {
  const normalizedFile = toPosix(filePath);
  const normalizedPattern = toPosix(pattern);

  if (normalizedPattern.endsWith("/**")) {
    const prefix = normalizedPattern.slice(0, -3);
    return normalizedFile === prefix || normalizedFile.startsWith(`${prefix}/`);
  }
  return normalizedFile === normalizedPattern;
};

export const buildWorkerAssignment = (
  task: Omit<WorkerAssignment, "forbiddenActions" | "reportLanguage">,
): WorkerAssignment => ({
  ...task,
  allowedFiles: task.allowedFiles.map(toPosix),
  forbiddenActions: DEFAULT_FORBIDDEN_ACTIONS,
  reportLanguage: "en",
});

export const verifyWorkerResult = (input: WorkerVerificationInput): WorkerVerificationResult => {
  const reasons: string[] = [];
  const outOfScopeFiles: string[] = [];

  for (const changed of input.actualChangedFiles) {
    const allowed = input.allowedFiles.some((pattern) => matchesAllowedPattern(changed, pattern));
    if (!allowed) {
      outOfScopeFiles.push(toPosix(changed));
    }
  }

  if (outOfScopeFiles.length > 0) {
    reasons.push(`Out-of-scope file modifications detected: ${outOfScopeFiles.join(", ")}`);
  }

  if (input.secretFindings.length > 0) {
    reasons.push(`Secret scan detected ${input.secretFindings.length} finding(s).`);
  }

  if (!input.verificationPassed) {
    reasons.push("Independent verification checks failed.");
  }

  const forbidden = input.attemptedForbiddenActions ?? [];
  if (forbidden.length > 0) {
    reasons.push(`Worker attempted forbidden action(s): ${forbidden.join(", ")}`);
  }

  if (input.report.status !== "completed") {
    reasons.push(`Worker reported status '${input.report.status}'.`);
  }

  return {
    accepted: reasons.length === 0,
    outOfScopeFiles,
    secretFindings: input.secretFindings,
    forbiddenActionsAttempted: forbidden,
    reasons,
  };
};
