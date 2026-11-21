import { redactSecrets } from "@github-convention/core";
import type { GhCommandRunner } from "../auth/types.js";

export type ProtectionGapKind =
  | "require_pull_request"
  | "require_status_checks"
  | "block_force_pushes"
  | "block_deletions"
  | "require_conversation_resolution";

export type ProtectionGap = Readonly<{
  kind: ProtectionGapKind;
  description: string;
  currentValue: unknown;
  recommendedValue: unknown;
}>;

export type ProtectionSource = "classic" | "ruleset" | "both" | "none";

export type BranchProtectionSnapshot = Readonly<{
  owner: string;
  repo: string;
  branch: string;
  protected: boolean;
  requirePullRequest: boolean;
  requiredStatusCheckContexts: readonly string[];
  blockForcePushes: boolean;
  blockDeletions: boolean;
  requireConversationResolution: boolean;
  source: ProtectionSource;
  gaps: readonly ProtectionGap[];
}>;

export type InspectBranchProtectionOptions = Readonly<{
  owner: string;
  repo: string;
  branch: string;
  runner: GhCommandRunner;
  requiredChecks?: readonly string[];
}>;

export type ProposeProtectionChangesOptions = Readonly<{
  requiredChecks?: readonly string[];
  approved?: boolean;
  dryRun?: boolean;
  runner?: GhCommandRunner;
}>;

export type BranchProtectionProposal = Readonly<{
  owner: string;
  repo: string;
  branch: string;
  requiresApproval: true;
  approved: boolean;
  dryRun: boolean;
  applied: boolean;
  gaps: readonly ProtectionGap[];
  proposedPayload: Readonly<Record<string, unknown>>;
  commandPreview: readonly string[];
  summary: string;
}>;

type ClassicProtectionResponse = {
  required_pull_request_reviews?: Record<string, unknown> | null;
  required_status_checks?: {
    strict?: boolean;
    contexts?: string[];
    checks?: Array<{ context?: string }>;
  } | null;
  allow_force_pushes?: { enabled?: boolean } | boolean;
  allow_deletions?: { enabled?: boolean } | boolean;
  required_conversation_resolution?: { enabled?: boolean } | boolean;
};

type BranchRuleEntry = {
  type?: string;
  parameters?: {
    require_conversation_resolution?: boolean;
    required_status_checks?: Array<{ context?: string }>;
  };
};

const isToggleEnabled = (
  value: { enabled?: boolean } | boolean | undefined,
): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }
  if (value && typeof value.enabled === "boolean") {
    return value.enabled;
  }
  return undefined;
};

const isNotFoundError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("404") ||
    message.includes("Not Found") ||
    message.includes("Branch not protected")
  );
};

const tryReadGhJson = async <T>(runner: GhCommandRunner, endpoint: string): Promise<T | null> => {
  try {
    const raw = await runner("gh", ["api", endpoint]);
    if (!raw.trim()) {
      return null;
    }
    return JSON.parse(raw) as T;
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw new Error(redactSecrets(error instanceof Error ? error.message : String(error)));
  }
};

const computeGaps = (
  snapshot: Omit<BranchProtectionSnapshot, "gaps">,
  requiredChecks?: readonly string[],
): readonly ProtectionGap[] => {
  const gaps: ProtectionGap[] = [];

  if (!snapshot.requirePullRequest) {
    gaps.push({
      kind: "require_pull_request",
      description: "Require pull request reviews before merging.",
      currentValue: false,
      recommendedValue: true,
    });
  }

  const expectedChecks = requiredChecks?.filter((check) => check.trim().length > 0) ?? [];
  if (expectedChecks.length > 0) {
    const missing = expectedChecks.filter(
      (check) => !snapshot.requiredStatusCheckContexts.includes(check),
    );
    if (missing.length > 0) {
      gaps.push({
        kind: "require_status_checks",
        description: `Require CI status checks: ${missing.join(", ")}.`,
        currentValue: snapshot.requiredStatusCheckContexts,
        recommendedValue: Array.from(
          new Set([...snapshot.requiredStatusCheckContexts, ...expectedChecks]),
        ),
      });
    }
  } else if (snapshot.requiredStatusCheckContexts.length === 0) {
    gaps.push({
      kind: "require_status_checks",
      description: "Require at least one CI status check before merging.",
      currentValue: [],
      recommendedValue: ["ci"],
    });
  }

  if (!snapshot.blockForcePushes) {
    gaps.push({
      kind: "block_force_pushes",
      description: "Block force pushes to protected branch.",
      currentValue: false,
      recommendedValue: true,
    });
  }

  if (!snapshot.blockDeletions) {
    gaps.push({
      kind: "block_deletions",
      description: "Block deletion of protected branch.",
      currentValue: false,
      recommendedValue: true,
    });
  }

  if (!snapshot.requireConversationResolution) {
    gaps.push({
      kind: "require_conversation_resolution",
      description: "Require conversation resolution before merging.",
      currentValue: false,
      recommendedValue: true,
    });
  }

  return gaps;
};

export const inspectBranchProtection = async (
  options: InspectBranchProtectionOptions,
): Promise<BranchProtectionSnapshot> => {
  const encodedBranch = encodeURIComponent(options.branch);
  const classic = await tryReadGhJson<ClassicProtectionResponse>(
    options.runner,
    `repos/${options.owner}/${options.repo}/branches/${encodedBranch}/protection`,
  );
  const rules = await tryReadGhJson<BranchRuleEntry[]>(
    options.runner,
    `repos/${options.owner}/${options.repo}/rules/branches/${encodedBranch}`,
  );

  const ruleList = Array.isArray(rules) ? rules : [];
  const hasClassic = classic !== null;
  const hasRulesets = ruleList.length > 0;
  const source: ProtectionSource =
    hasClassic && hasRulesets ? "both" : hasClassic ? "classic" : hasRulesets ? "ruleset" : "none";

  const statusChecks = new Set<string>();
  let requirePullRequest = false;
  let blockForcePushes = false;
  let blockDeletions = false;
  let requireConversationResolution = false;

  if (classic) {
    requirePullRequest = Boolean(classic.required_pull_request_reviews);
    for (const ctx of classic.required_status_checks?.contexts ?? []) {
      statusChecks.add(ctx);
    }
    for (const check of classic.required_status_checks?.checks ?? []) {
      if (check.context) {
        statusChecks.add(check.context);
      }
    }
    blockForcePushes = isToggleEnabled(classic.allow_force_pushes) !== true;
    blockDeletions = isToggleEnabled(classic.allow_deletions) !== true;
    requireConversationResolution =
      isToggleEnabled(classic.required_conversation_resolution) === true;
  }

  for (const rule of ruleList) {
    if (rule.type === "pull_request") {
      requirePullRequest = true;
      if (rule.parameters?.require_conversation_resolution) {
        requireConversationResolution = true;
      }
    } else if (rule.type === "required_status_checks") {
      for (const check of rule.parameters?.required_status_checks ?? []) {
        if (check.context) {
          statusChecks.add(check.context);
        }
      }
    } else if (rule.type === "non_fast_forward") {
      blockForcePushes = true;
    } else if (rule.type === "deletion") {
      blockDeletions = true;
    }
  }

  const baseSnapshot: Omit<BranchProtectionSnapshot, "gaps"> = {
    owner: options.owner,
    repo: options.repo,
    branch: options.branch,
    protected: hasClassic || hasRulesets,
    requirePullRequest,
    requiredStatusCheckContexts: Array.from(statusChecks),
    blockForcePushes,
    blockDeletions,
    requireConversationResolution,
    source,
  };

  return {
    ...baseSnapshot,
    gaps: computeGaps(baseSnapshot, options.requiredChecks),
  };
};

export const proposeProtectionChanges = async (
  snapshot: BranchProtectionSnapshot,
  options?: ProposeProtectionChangesOptions,
): Promise<BranchProtectionProposal> => {
  const gaps = options?.requiredChecks
    ? computeGaps(snapshot, options.requiredChecks)
    : snapshot.gaps;

  const targetChecks = Array.from(
    new Set([...snapshot.requiredStatusCheckContexts, ...(options?.requiredChecks ?? [])]),
  );

  const proposedPayload: Record<string, unknown> = {
    required_status_checks: {
      strict: true,
      contexts: targetChecks.length > 0 ? targetChecks : ["ci"],
    },
    enforce_admins: true,
    required_pull_request_reviews: {
      dismiss_stale_reviews: true,
      required_approving_review_count: 1,
    },
    restrictions: null,
    allow_force_pushes: false,
    allow_deletions: false,
    required_conversation_resolution: true,
  };

  const endpoint = `repos/${snapshot.owner}/${snapshot.repo}/branches/${encodeURIComponent(snapshot.branch)}/protection`;
  const commandPreview = ["gh", "api", "-X", "PUT", endpoint, "--input", "-"];

  const approved = options?.approved === true;
  const dryRun = options?.dryRun ?? true;

  if (!approved || dryRun || !options?.runner || gaps.length === 0) {
    const reason =
      gaps.length === 0
        ? `Branch '${snapshot.branch}' already satisfies all protection checks.`
        : !approved
          ? `Approval required before mutating branch protection on '${snapshot.branch}' (${gaps.length} gap(s) found).`
          : `Dry-run mode active; proposal generated for '${snapshot.branch}' without mutating remote protection.`;

    return {
      owner: snapshot.owner,
      repo: snapshot.repo,
      branch: snapshot.branch,
      requiresApproval: true,
      approved,
      dryRun,
      applied: false,
      gaps,
      proposedPayload,
      commandPreview,
      summary: reason,
    };
  }

  await options.runner("gh", [
    "api",
    "-X",
    "PUT",
    endpoint,
    "-f",
    `payload=${JSON.stringify(proposedPayload)}`,
  ]);

  return {
    owner: snapshot.owner,
    repo: snapshot.repo,
    branch: snapshot.branch,
    requiresApproval: true,
    approved: true,
    dryRun: false,
    applied: true,
    gaps,
    proposedPayload,
    commandPreview,
    summary: `Applied approved branch protection updates to '${snapshot.branch}'.`,
  };
};
