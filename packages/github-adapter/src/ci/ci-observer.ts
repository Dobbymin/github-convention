import { redactSecrets } from "@github-convention/core";
import { defaultGhCommandRunner } from "../auth/gh-auth.js";
import type { GhCommandRunner } from "../auth/types.js";

export type CheckRunBucket = "pass" | "fail" | "pending" | "skipping" | "cancel" | "unknown";

export type PullRequestCheckRun = Readonly<{
  name: string;
  state: string;
  bucket: CheckRunBucket;
  description?: string;
  link?: string;
  workflow?: string;
}>;

export type FetchPullRequestCheckRunsOptions = Readonly<{
  pullNumber: number;
  repo?: string;
  runner?: GhCommandRunner;
}>;

type RawPrCheck = {
  name?: string;
  state?: string;
  bucket?: string;
  description?: string | null;
  link?: string | null;
  workflow?: string | null;
};

const VALID_BUCKETS = new Set<CheckRunBucket>(["pass", "fail", "pending", "skipping", "cancel"]);

const normalizeBucket = (bucket?: string): CheckRunBucket => {
  const lowered = (bucket ?? "").toLowerCase() as CheckRunBucket;
  return VALID_BUCKETS.has(lowered) ? lowered : "unknown";
};

export const fetchPullRequestCheckRuns = async (
  options: FetchPullRequestCheckRunsOptions,
): Promise<readonly PullRequestCheckRun[]> => {
  const runner = options.runner ?? defaultGhCommandRunner;
  const args: string[] = ["pr", "checks", String(options.pullNumber)];
  if (options.repo) {
    args.push("--repo", options.repo);
  }
  args.push("--json", "name,state,bucket,description,link,workflow");

  const raw = await runner("gh", args);
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }

  return (parsed as readonly RawPrCheck[]).map((item) => ({
    name: item.name ?? "unknown",
    state: item.state ?? "UNKNOWN",
    bucket: normalizeBucket(item.bucket),
    description: item.description ? redactSecrets(item.description) : undefined,
    link: item.link ?? undefined,
    workflow: item.workflow ?? undefined,
  }));
};
