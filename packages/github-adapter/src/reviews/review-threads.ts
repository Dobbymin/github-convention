import { redactSecrets } from "@github-convention/core";
import { defaultGhCommandRunner } from "../auth/gh-auth.js";
import type { GhCommandRunner } from "../auth/types.js";

export type PullRequestReviewComment = Readonly<{
  id: string;
  body: string;
  author?: string;
  path?: string;
  line?: number;
}>;

export type PullRequestReviewThread = Readonly<{
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path?: string;
  line?: number;
  comments: readonly PullRequestReviewComment[];
}>;

export type FetchReviewThreadsOptions = Readonly<{
  repo: string;
  pullNumber: number;
  runner?: GhCommandRunner;
}>;

export type ResolveReviewThreadOptions = Readonly<{
  threadId: string;
  runner?: GhCommandRunner;
}>;

export type ResolveReviewThreadResult = Readonly<{
  threadId: string;
  isResolved: boolean;
}>;

export type ThreadResolutionTarget = Readonly<{
  threadId: string;
  resolve: boolean;
  reason?: string;
}>;

export type ResolveVerifiedThreadsOptions = Readonly<{
  threads: readonly ThreadResolutionTarget[];
  runner?: GhCommandRunner;
}>;

export type ResolveVerifiedThreadsResult = Readonly<{
  resolvedThreadIds: readonly string[];
  skippedThreadIds: readonly string[];
}>;

const FETCH_REVIEW_THREADS_QUERY = `
query($owner: String!, $name: String!, $pullNumber: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $pullNumber) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          comments(first: 20) {
            nodes {
              id
              body
              path
              line
              author {
                login
              }
            }
          }
        }
      }
    }
  }
}
`.trim();

const RESOLVE_REVIEW_THREAD_MUTATION = `
mutation($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) {
    thread {
      id
      isResolved
    }
  }
}
`.trim();

type RawCommentNode = {
  id: string;
  body?: string | null;
  path?: string | null;
  line?: number | null;
  author?: { login?: string | null } | null;
};

type RawThreadNode = {
  id: string;
  isResolved?: boolean;
  isOutdated?: boolean;
  path?: string | null;
  line?: number | null;
  comments?: { nodes?: readonly RawCommentNode[] };
};

type RawFetchThreadsResponse = {
  data?: {
    repository?: {
      pullRequest?: {
        reviewThreads?: {
          nodes?: readonly RawThreadNode[];
        };
      };
    };
  };
};

type RawResolveThreadResponse = {
  data?: {
    resolveReviewThread?: {
      thread?: {
        id?: string;
        isResolved?: boolean;
      };
    };
  };
};

const parseRepoParts = (repo: string): { owner: string; name: string } => {
  const parts = repo.split("/").filter((part) => part.length > 0);
  if (parts.length !== 2) {
    throw new Error(`Invalid repository slug "${repo}". Expected "owner/name".`);
  }
  return { owner: parts[0], name: parts[1] };
};

export const fetchPullRequestReviewThreads = async (
  options: FetchReviewThreadsOptions,
): Promise<readonly PullRequestReviewThread[]> => {
  const runner = options.runner ?? defaultGhCommandRunner;
  const { owner, name } = parseRepoParts(options.repo);

  const raw = await runner("gh", [
    "api",
    "graphql",
    "-f",
    `query=${FETCH_REVIEW_THREADS_QUERY}`,
    "-f",
    `owner=${owner}`,
    "-f",
    `name=${name}`,
    "-F",
    `pullNumber=${options.pullNumber}`,
  ]);

  const parsed = JSON.parse(raw) as RawFetchThreadsResponse;
  const nodes = parsed.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];

  return nodes.map((node) => ({
    id: node.id,
    isResolved: Boolean(node.isResolved),
    isOutdated: Boolean(node.isOutdated),
    path: node.path ?? undefined,
    line: node.line ?? undefined,
    comments: (node.comments?.nodes ?? []).map((comment) => ({
      id: comment.id,
      body: redactSecrets(comment.body ?? ""),
      author: comment.author?.login ?? undefined,
      path: comment.path ?? undefined,
      line: comment.line ?? undefined,
    })),
  }));
};

export const resolveReviewThread = async (
  options: ResolveReviewThreadOptions,
): Promise<ResolveReviewThreadResult> => {
  const runner = options.runner ?? defaultGhCommandRunner;
  const raw = await runner("gh", [
    "api",
    "graphql",
    "-f",
    `query=${RESOLVE_REVIEW_THREAD_MUTATION}`,
    "-f",
    `threadId=${options.threadId}`,
  ]);

  const parsed = JSON.parse(raw) as RawResolveThreadResponse;
  const thread = parsed.data?.resolveReviewThread?.thread;

  return {
    threadId: thread?.id ?? options.threadId,
    isResolved: thread?.isResolved ?? true,
  };
};

export const resolveVerifiedReviewThreads = async (
  options: ResolveVerifiedThreadsOptions,
): Promise<ResolveVerifiedThreadsResult> => {
  const resolvedThreadIds: string[] = [];
  const skippedThreadIds: string[] = [];

  for (const thread of options.threads) {
    if (!thread.resolve) {
      skippedThreadIds.push(thread.threadId);
      continue;
    }

    const result = await resolveReviewThread({
      threadId: thread.threadId,
      runner: options.runner,
    });
    if (result.isResolved) {
      resolvedThreadIds.push(result.threadId);
    } else {
      skippedThreadIds.push(result.threadId);
    }
  }

  return { resolvedThreadIds, skippedThreadIds };
};
