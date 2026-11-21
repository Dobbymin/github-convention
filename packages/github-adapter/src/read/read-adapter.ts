import { redactSecrets } from "@github-convention/core";
import { defaultGhCommandRunner } from "../auth/gh-auth.js";
import type { GhCommandRunner } from "../auth/types.js";
import type {
  GitHubIssue,
  GitHubLabel,
  GitHubPullRequest,
  GitHubReadAdapterOptions,
  ListIssuesOptions,
  ListPullRequestsOptions,
  RepoMetadata,
} from "./types.js";

type RawRepoView = {
  name: string;
  owner: string | { login: string };
  nameWithOwner: string;
  defaultBranch?: string;
  defaultBranchRef?: { name: string } | null;
  isPrivate: boolean;
  url: string;
};

type RawLabelledItem = {
  labels?: readonly (string | { name: string })[];
};

type RawIssue = RawLabelledItem & {
  number: number;
  title: string;
  body?: string | null;
  state: string;
  url: string;
  createdAt?: string;
  updatedAt?: string;
};

type RawPullRequest = RawLabelledItem & {
  number: number;
  title: string;
  state: string;
  headRefName: string;
  baseRefName: string;
  url: string;
  isDraft?: boolean;
};

const normalizeLabels = (labels?: readonly (string | { name: string })[]): readonly string[] => {
  if (!Array.isArray(labels)) {
    return [];
  }
  return labels.map((label) => (typeof label === "string" ? label : label.name));
};

const normalizeIssue = (raw: RawIssue): GitHubIssue => ({
  number: raw.number,
  title: raw.title,
  body: raw.body ?? "",
  state: raw.state,
  labels: normalizeLabels(raw.labels),
  url: raw.url,
  createdAt: raw.createdAt,
  updatedAt: raw.updatedAt,
});

const normalizePullRequest = (raw: RawPullRequest): GitHubPullRequest => ({
  number: raw.number,
  title: raw.title,
  state: raw.state,
  headRefName: raw.headRefName,
  baseRefName: raw.baseRefName,
  url: raw.url,
  isDraft: raw.isDraft,
  labels: normalizeLabels(raw.labels),
});

export class GitHubReadAdapter {
  private readonly runner: GhCommandRunner;
  private readonly repo?: string;

  public constructor(options: GitHubReadAdapterOptions = {}) {
    this.runner = options.runner ?? defaultGhCommandRunner;
    this.repo = options.repo;
  }

  private withRepoFlag(args: readonly string[]): string[] {
    return this.repo ? [...args, "--repo", this.repo] : [...args];
  }

  private async runJson<T>(args: readonly string[]): Promise<T> {
    try {
      const output = await this.runner("gh", this.withRepoFlag(args));
      return JSON.parse(output) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(redactSecrets(`GitHub read failed: ${message}`));
    }
  }

  public async getRepoMetadata(): Promise<RepoMetadata> {
    const raw = await this.runJson<RawRepoView>([
      "repo",
      "view",
      "--json",
      "name,owner,nameWithOwner,defaultBranchRef,isPrivate,url",
    ]);

    const owner = typeof raw.owner === "string" ? raw.owner : raw.owner.login;
    const defaultBranch = raw.defaultBranch ?? raw.defaultBranchRef?.name ?? "main";

    return {
      name: raw.name,
      owner,
      nameWithOwner: raw.nameWithOwner,
      defaultBranch,
      isPrivate: raw.isPrivate,
      url: raw.url,
    };
  }

  public async listLabels(): Promise<readonly GitHubLabel[]> {
    const raw = await this.runJson<GitHubLabel[]>([
      "label",
      "list",
      "--limit",
      "200",
      "--json",
      "name,description,color,isDefault",
    ]);
    return raw.map((label) => ({
      name: label.name,
      description: label.description ?? "",
      color: label.color,
      isDefault: label.isDefault,
    }));
  }

  public async listIssues(options: ListIssuesOptions = {}): Promise<readonly GitHubIssue[]> {
    const state = options.state ?? "open";
    const limit = options.limit ?? 100;
    const raw = await this.runJson<RawIssue[]>([
      "issue",
      "list",
      "--state",
      state,
      "--limit",
      String(limit),
      "--json",
      "number,title,body,state,labels,url,createdAt,updatedAt",
    ]);
    return raw.map(normalizeIssue);
  }

  public async getIssue(issueNumber: number): Promise<GitHubIssue> {
    if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
      throw new Error(`Issue number must be a positive integer (received ${issueNumber}).`);
    }
    const raw = await this.runJson<RawIssue>([
      "issue",
      "view",
      String(issueNumber),
      "--json",
      "number,title,body,state,labels,url,createdAt,updatedAt",
    ]);
    return normalizeIssue(raw);
  }

  public async listPullRequests(
    options: ListPullRequestsOptions = {},
  ): Promise<readonly GitHubPullRequest[]> {
    const state = options.state ?? "open";
    const limit = options.limit ?? 100;
    const raw = await this.runJson<RawPullRequest[]>([
      "pr",
      "list",
      "--state",
      state,
      "--limit",
      String(limit),
      "--json",
      "number,title,state,headRefName,baseRefName,url,isDraft,labels",
    ]);
    return raw.map(normalizePullRequest);
  }
}
