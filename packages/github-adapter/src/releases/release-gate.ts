import { redactSecrets } from "@github-convention/core";
import { defaultGhCommandRunner } from "../auth/gh-auth.js";
import type { GhCommandRunner } from "../auth/types.js";

export type GatedReleaseProposal = Readonly<{
  proposedVersion: string;
  tagName: string;
  releaseNotes: string;
  changelog?: string;
}>;

export type GatedReleaseInput = Readonly<{
  proposal: GatedReleaseProposal;
  repo?: string;
  target?: string;
  title?: string;
  explicitApproval?: boolean;
  nonInteractive?: boolean;
  dryRun?: boolean;
  draft?: boolean;
  prerelease?: boolean;
  createGitTag?: boolean;
  pushGitTag?: boolean;
}>;

export type PlannedCommand = Readonly<{
  file: "git" | "gh";
  args: readonly string[];
}>;

export type GatedReleaseStatus = "approval_required" | "dry_run" | "released";

export type GatedReleaseResult = Readonly<{
  status: GatedReleaseStatus;
  executed: boolean;
  tagName: string;
  version: string;
  releaseUrl?: string;
  plannedCommands: readonly PlannedCommand[];
  reason?: string;
}>;

const buildPlannedCommands = (input: GatedReleaseInput): readonly PlannedCommand[] => {
  const tagName = input.proposal.tagName.trim();
  const title = input.title?.trim() || `Release ${tagName}`;
  const notes = redactSecrets(input.proposal.releaseNotes);
  const commands: PlannedCommand[] = [];

  if (input.createGitTag !== false) {
    const tagArgs = ["tag", "-a", tagName];
    if (input.target) {
      tagArgs.push(input.target);
    }
    tagArgs.push("-m", title);
    commands.push({ file: "git", args: tagArgs });

    if (input.pushGitTag !== false) {
      commands.push({ file: "git", args: ["push", "origin", tagName] });
    }
  }

  const ghArgs = ["release", "create", tagName, "--title", title, "--notes", notes];
  if (input.repo) {
    ghArgs.push("--repo", input.repo);
  }
  if (input.target) {
    ghArgs.push("--target", input.target);
  }
  if (input.draft) {
    ghArgs.push("--draft");
  }
  if (input.prerelease) {
    ghArgs.push("--prerelease");
  }
  commands.push({ file: "gh", args: ghArgs });

  return commands;
};

const extractReleaseUrl = (stdout: string): string | undefined => {
  const match = /https:\/\/\S+/.exec(stdout.trim());
  return match?.[0];
};

export const executeGatedRelease = async (
  input: GatedReleaseInput,
  runner: GhCommandRunner = defaultGhCommandRunner,
): Promise<GatedReleaseResult> => {
  const tagName = input.proposal.tagName.trim();
  const version = input.proposal.proposedVersion.trim();
  const plannedCommands = buildPlannedCommands(input);

  if (input.dryRun) {
    return {
      status: "dry_run",
      executed: false,
      tagName,
      version,
      plannedCommands,
      reason:
        input.explicitApproval === true
          ? "Dry run requested; no git tag or GitHub release was created."
          : "Dry run requested; explicit approval is still required before execution.",
    };
  }

  if (input.explicitApproval !== true) {
    return {
      status: "approval_required",
      executed: false,
      tagName,
      version,
      plannedCommands,
      reason: input.nonInteractive
        ? "Non-interactive mode blocked: explicit approval is required before creating tags or GitHub releases."
        : "Explicit approval is required before creating tags or GitHub releases.",
    };
  }

  let releaseUrl: string | undefined;
  for (const command of plannedCommands) {
    const stdout = await runner(command.file, command.args);
    if (command.file === "gh") {
      releaseUrl = extractReleaseUrl(stdout);
    }
  }

  return {
    status: "released",
    executed: true,
    tagName,
    version,
    ...(releaseUrl ? { releaseUrl } : {}),
    plannedCommands,
  };
};
