import {
  evaluateQualityGates,
  redactSecrets,
  type QualityGateInputs,
} from "@dobbymin/github-convention-core";
import type { GhCommandRunner } from "../auth/types.js";
import type { GitHubReadAdapter } from "../read/read-adapter.js";

export type GatedPullRequestInput = Readonly<{
  repo?: string;
  issueNumber: number;
  headBranch: string;
  baseBranch: string;
  title: string;
  summary: string;
  verificationSummary: string;
  acceptanceChecklist: readonly string[];
  gates: QualityGateInputs;
  dryRun?: boolean;
}>;

export type GatedPullRequestResult = Readonly<{
  action: "created" | "reused" | "blocked_by_gates" | "dry_run";
  isDraft: false;
  mergeOwner: "user";
  prNumber?: number;
  prUrl?: string;
  failedGates: readonly string[];
}>;

const parsePrNumber = (stdout: string): { number?: number; url?: string } => {
  const trimmed = stdout.trim();
  const match = /\/pull\/(\d+)/.exec(trimmed);
  if (match) return { number: Number(match[1]), url: trimmed };
  const num = Number(trimmed);
  return Number.isInteger(num) && num > 0 ? { number: num } : {};
};

export const createGatedPullRequest = async (
  input: GatedPullRequestInput,
  readAdapter: GitHubReadAdapter,
  writeRunner: GhCommandRunner,
): Promise<GatedPullRequestResult> => {
  const gateResult = evaluateQualityGates(input.gates);
  if (!gateResult.passed) {
    return {
      action: "blocked_by_gates",
      isDraft: false,
      mergeOwner: "user",
      failedGates: gateResult.failedGates,
    };
  }

  const openPrs = await readAdapter.listPullRequests({ state: "open", limit: 100 });
  const existing = openPrs.find((pr) => pr.headRefName === input.headBranch);
  if (existing) {
    return {
      action: "reused",
      isDraft: false,
      mergeOwner: "user",
      prNumber: existing.number,
      prUrl: existing.url,
      failedGates: [],
    };
  }

  if (input.dryRun) {
    return {
      action: "dry_run",
      isDraft: false,
      mergeOwner: "user",
      failedGates: [],
    };
  }

  const body = [
    "## Summary",
    redactSecrets(input.summary),
    "",
    `Closes #${input.issueNumber}`,
    "",
    "## Verification",
    redactSecrets(input.verificationSummary),
    "",
    "## Acceptance Criteria",
    ...input.acceptanceChecklist.map((item) => `- [x] ${item}`),
  ].join("\n");

  const args = ["pr", "create"];
  if (input.repo) args.push("--repo", input.repo);
  args.push(
    "--base",
    input.baseBranch,
    "--head",
    input.headBranch,
    "--title",
    input.title,
    "--body",
    body,
  );

  const stdout = await writeRunner("gh", args);
  const parsed = parsePrNumber(stdout);

  return {
    action: "created",
    isDraft: false,
    mergeOwner: "user",
    ...(parsed.number !== undefined ? { prNumber: parsed.number } : {}),
    ...(parsed.url !== undefined ? { prUrl: parsed.url } : {}),
    failedGates: [],
  };
};
