import assert from "node:assert/strict";
import test from "node:test";
import { checkGhAuth, type GhCommandRunner } from "../auth/index.js";
import {
  GitHubReadAdapter,
  reconcileLabels,
  type GitHubLabel,
  type TemplateLabel,
} from "./index.js";

test("checkGhAuth: prefers existing gh CLI auth over agentToolStatus and redacts secrets", async () => {
  const calls: Array<{ file: string; args: readonly string[] }> = [];
  const runner: GhCommandRunner = (file, args) => {
    calls.push({ file, args });
    return "github.com\n  ✓ Logged in to github.com account octocat\n  - Token: ghp_1234567890abcdefghijklmnopqrstuvwxyz1234\n";
  };

  const result = await checkGhAuth({
    runner,
    hostname: "github.com",
    agentToolStatus: { connected: true, account: "agent-user" },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, "gh");
  assert.deepEqual(calls[0].args, ["auth", "status", "--hostname", "github.com"]);
  assert.equal(result.authenticated, true);
  assert.equal(result.source, "gh_cli");
  assert.equal(result.account, "octocat");
  assert.ok(!result.rawOutput?.includes("ghp_1234567890"));
  assert.ok(result.rawOutput?.includes("[REDACTED]"));
});

test("checkGhAuth: falls back to connected agentToolStatus when gh fails and redacts error", async () => {
  const runner: GhCommandRunner = () => {
    const err = new Error("gh auth failed with Bearer abcdef1234567890abcdef");
    throw err;
  };

  const fallback = await checkGhAuth({
    runner,
    agentToolStatus: {
      connected: true,
      account: "mcp-user",
      detail: "Connected via MCP GitHub tool",
    },
  });

  assert.equal(fallback.authenticated, true);
  assert.equal(fallback.source, "agent_tool");
  assert.equal(fallback.account, "mcp-user");
  assert.ok(!fallback.error?.includes("abcdef1234567890abcdef"));
  assert.ok(fallback.error?.includes("[REDACTED_BEARER_TOKEN]"));

  const unauthenticated = await checkGhAuth({ runner });
  assert.equal(unauthenticated.authenticated, false);
  assert.equal(unauthenticated.source, "none");
});

test("GitHubReadAdapter: performs fresh remote reads without caching and redacts errors", async () => {
  let issueCallCount = 0;
  const recordedCommands: string[][] = [];

  const runner: GhCommandRunner = (_file, args) => {
    recordedCommands.push([...args]);
    if (args[0] === "repo" && args[1] === "view") {
      return JSON.stringify({
        name: "github-convention",
        owner: { login: "Dobbymin" },
        nameWithOwner: "Dobbymin/github-convention",
        defaultBranchRef: { name: "main" },
        isPrivate: false,
        url: "https://github.com/Dobbymin/github-convention",
      });
    }
    if (args[0] === "label" && args[1] === "list") {
      return JSON.stringify([
        { name: "type:feature", description: "New capability", color: "a2eeef" },
      ]);
    }
    if (args[0] === "issue" && args[1] === "list") {
      issueCallCount += 1;
      return JSON.stringify([
        {
          number: 22,
          title: `Issue v${issueCallCount}`,
          body: "Body",
          state: "OPEN",
          labels: [{ name: "type:feature" }],
          url: "https://github.com/Dobbymin/github-convention/issues/22",
        },
      ]);
    }
    if (args[0] === "issue" && args[1] === "view") {
      return JSON.stringify({
        number: 22,
        title: "Issue 22",
        body: "Detail",
        state: "OPEN",
        labels: ["type:feature"],
        url: "https://github.com/Dobbymin/github-convention/issues/22",
      });
    }
    if (args[0] === "pr" && args[1] === "list") {
      return JSON.stringify([
        {
          number: 30,
          title: "feat: read adapter",
          state: "OPEN",
          headRefName: "feat/22-read-adapter",
          baseRefName: "main",
          url: "https://github.com/Dobbymin/github-convention/pull/30",
          isDraft: false,
          labels: [{ name: "scope:adapter" }],
        },
      ]);
    }
    throw new Error("Unexpected command");
  };

  const adapter = new GitHubReadAdapter({ repo: "Dobbymin/github-convention", runner });

  const repo = await adapter.getRepoMetadata();
  assert.equal(repo.owner, "Dobbymin");
  assert.equal(repo.defaultBranch, "main");

  const labels = await adapter.listLabels();
  assert.equal(labels.length, 1);
  assert.equal(labels[0].name, "type:feature");

  const firstIssues = await adapter.listIssues();
  const secondIssues = await adapter.listIssues();
  assert.equal(firstIssues[0].title, "Issue v1");
  assert.equal(secondIssues[0].title, "Issue v2");
  assert.equal(issueCallCount, 2);

  const singleIssue = await adapter.getIssue(22);
  assert.equal(singleIssue.number, 22);

  const prs = await adapter.listPullRequests();
  assert.equal(prs[0].headRefName, "feat/22-read-adapter");
  assert.ok(recordedCommands.every((cmd) => cmd.includes("--repo")));

  const failingAdapter = new GitHubReadAdapter({
    runner: () => {
      throw new Error("fatal: could not read https://user:secretpass@github.com/repo.git");
    },
  });
  await assert.rejects(
    () => failingAdapter.getRepoMetadata(),
    (err: Error) =>
      err.message.includes("[REDACTED]:[REDACTED]@") && !err.message.includes("secretpass"),
  );
});

test("reconcileLabels: classifies compatible, missing, conflicting, deprecated, and duplicate candidates", () => {
  const existing: GitHubLabel[] = [
    { name: "type:epic", description: "Parent Issue grouping related work", color: "5319e7" },
    { name: "bug", description: "Legacy bug", color: "d73a4a" },
    { name: "type:docs", description: "Documentation-only change", color: "ffffff" },
    { name: "blocked", description: "Blocked", color: "000000" },
    { name: "scope:cli", description: "Command-line interface", color: "1d76db" },
    { name: "Scope:CLI", description: "Duplicate case", color: "1d76db" },
  ];

  const template: TemplateLabel[] = [
    {
      name: "type:epic",
      description: "Parent Issue grouping related work",
      color: "5319e7",
      category: "type",
      required: true,
    },
    {
      name: "type:bug",
      description: "Defect",
      color: "d73a4a",
      category: "type",
      required: true,
      migrated_from: ["bug"],
    },
    {
      name: "type:docs",
      description: "Documentation-only change",
      color: "0075ca",
      category: "type",
      required: true,
    },
    {
      name: "type:feature",
      description: "New capability",
      color: "a2eeef",
      category: "type",
      required: true,
    },
    {
      name: "scope:cli",
      description: "Command-line interface",
      color: "1d76db",
      category: "scope",
      required: false,
    },
  ];

  const result = reconcileLabels(existing, template);

  assert.equal(result.compatible.length, 3);
  assert.ok(
    result.compatible.some(
      (m) =>
        m.template.name === "type:bug" &&
        m.existing.name === "bug" &&
        m.matchType === "migrated_from",
    ),
  );
  assert.deepEqual(
    result.missing.map((m) => m.name),
    ["type:feature"],
  );
  assert.equal(result.conflicting.length, 1);
  assert.equal(result.conflicting[0].template.name, "type:docs");
  assert.deepEqual(
    result.deprecatedCandidates.map((d) => d.label.name),
    ["blocked"],
  );
  assert.equal(result.duplicateCandidates.length, 1);
  assert.equal(result.duplicateCandidates[0].normalizedName, "scope:cli");
});
