import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import type { GhCommandRunner } from "../auth/types.js";
import { fetchPullRequestReviewThreads, resolveVerifiedReviewThreads } from "../reviews/index.js";
import { fetchPullRequestCheckRuns } from "./index.js";

describe("github-adapter review threads", () => {
  it("fetches PR review threads via GraphQL and redacts secrets", async () => {
    const calls: { file: string; args: readonly string[] }[] = [];
    const runner: GhCommandRunner = (file, args) => {
      calls.push({ file, args });
      return JSON.stringify({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [
                  {
                    id: "PRRT_1",
                    isResolved: false,
                    isOutdated: false,
                    path: "packages/core/src/index.ts",
                    line: 10,
                    comments: {
                      nodes: [
                        {
                          id: "PRRC_1",
                          body: "Rename variable and remove ghp_1234567890abcdef1234567890abcdef1234",
                          path: "packages/core/src/index.ts",
                          line: 10,
                          author: { login: "reviewer" },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      });
    };

    const threads = await fetchPullRequestReviewThreads({
      repo: "octo/repo",
      pullNumber: 36,
      runner,
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].file, "gh");
    assert.ok(calls[0].args.includes("graphql"));
    assert.ok(calls[0].args.includes("owner=octo"));
    assert.ok(calls[0].args.includes("name=repo"));
    assert.ok(calls[0].args.includes("pullNumber=36"));

    assert.equal(threads.length, 1);
    assert.equal(threads[0].id, "PRRT_1");
    assert.equal(
      path.normalize(threads[0].path ?? ""),
      path.normalize("packages/core/src/index.ts"),
    );
    assert.equal(threads[0].comments[0].author, "reviewer");
    assert.equal(threads[0].comments[0].body.includes("ghp_"), false);
  });

  it("resolves only verified straightforward threads and skips unverified or approval-required ones", async () => {
    const resolvedMutations: string[] = [];
    const runner: GhCommandRunner = (_file, args) => {
      const threadArg = args.find((arg) => arg.startsWith("threadId="));
      const threadId = threadArg?.slice("threadId=".length) ?? "";
      resolvedMutations.push(threadId);
      return JSON.stringify({
        data: {
          resolveReviewThread: {
            thread: { id: threadId, isResolved: true },
          },
        },
      });
    };

    const result = await resolveVerifiedReviewThreads({
      threads: [
        { threadId: "PRRT_straightforward_verified", resolve: true },
        { threadId: "PRRT_architecture_open", resolve: false, reason: "Requires approval" },
        { threadId: "PRRT_unverified_open", resolve: false, reason: "Not verified" },
      ],
      runner,
    });

    assert.deepEqual(resolvedMutations, ["PRRT_straightforward_verified"]);
    assert.deepEqual(result.resolvedThreadIds, ["PRRT_straightforward_verified"]);
    assert.deepEqual(result.skippedThreadIds, ["PRRT_architecture_open", "PRRT_unverified_open"]);
  });
});

describe("github-adapter ci observer", () => {
  it("fetches PR check runs and normalizes buckets and redacted descriptions", async () => {
    const calls: { file: string; args: readonly string[] }[] = [];
    const runner: GhCommandRunner = (file, args) => {
      calls.push({ file, args });
      return JSON.stringify([
        {
          name: "typecheck",
          state: "SUCCESS",
          bucket: "pass",
          description: "Passed",
          link: "https://github.com/octo/repo/actions/runs/1",
          workflow: "CI",
        },
        {
          name: "test",
          state: "FAILURE",
          bucket: "fail",
          description: "Failed with token ghp_1234567890abcdef1234567890abcdef1234",
          link: "https://github.com/octo/repo/actions/runs/2",
          workflow: "CI",
        },
      ]);
    };

    const checks = await fetchPullRequestCheckRuns({
      repo: "octo/repo",
      pullNumber: 36,
      runner,
    });

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, [
      "pr",
      "checks",
      "36",
      "--repo",
      "octo/repo",
      "--json",
      "name,state,bucket,description,link,workflow",
    ]);

    assert.equal(checks.length, 2);
    assert.equal(checks[0].bucket, "pass");
    assert.equal(checks[1].bucket, "fail");
    assert.equal(checks[1].description?.includes("ghp_"), false);
  });
});
