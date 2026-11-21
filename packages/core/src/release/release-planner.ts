import type {
  ParsedConventionalCommit,
  ReleaseCommitInput,
  ReleaseProposal,
  ReleaseProposalInput,
  SemVerBump,
} from "./types.js";

type ParsedSemVer = Readonly<{
  major: number;
  minor: number;
  patch: number;
}>;

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const CONVENTIONAL_HEADER_PATTERN = /^([a-zA-Z0-9_-]+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;
const BREAKING_FOOTER_PATTERN = /^BREAKING[ -]CHANGE:\s*/m;

const stripLeadingV = (version: string): string => version.trim().replace(/^v(?=\d)/, "");

export const parseSemVer = (version: string): ParsedSemVer => {
  const normalized = stripLeadingV(version);
  const match = SEMVER_PATTERN.exec(normalized);
  if (match === null) {
    throw new Error(`Invalid SemVer version: "${version}". Expected X.Y.Z.`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
};

export const bumpSemVer = (current: ParsedSemVer, bump: SemVerBump): string => {
  switch (bump) {
    case "major":
      return `${current.major + 1}.0.0`;
    case "minor":
      return `${current.major}.${current.minor + 1}.0`;
    case "patch":
      return `${current.major}.${current.minor}.${current.patch + 1}`;
  }
};

export const parseConventionalCommit = (input: ReleaseCommitInput): ParsedConventionalCommit => {
  const rawMessage = input.message.trim();
  const [firstLine = ""] = rawMessage.split(/\r?\n/, 1);
  const match = CONVENTIONAL_HEADER_PATTERN.exec(firstLine.trim());
  const hasBreakingFooter = BREAKING_FOOTER_PATTERN.test(rawMessage);

  if (match === null) {
    return {
      ...(input.sha !== undefined ? { sha: input.sha } : {}),
      ...(input.prNumber !== undefined ? { prNumber: input.prNumber } : {}),
      type: "other",
      breaking: hasBreakingFooter,
      subject: firstLine.trim() || rawMessage,
      rawMessage,
    };
  }

  const scope = match[2]?.trim();
  return {
    ...(input.sha !== undefined ? { sha: input.sha } : {}),
    ...(input.prNumber !== undefined ? { prNumber: input.prNumber } : {}),
    type: match[1].toLowerCase(),
    ...(scope ? { scope } : {}),
    breaking: Boolean(match[3]) || hasBreakingFooter,
    subject: match[4].trim(),
    rawMessage,
  };
};

export const deriveSemVerBump = (commits: readonly ParsedConventionalCommit[]): SemVerBump => {
  if (commits.some((commit) => commit.breaking)) return "major";
  if (commits.some((commit) => commit.type === "feat")) return "minor";
  return "patch";
};

export const formatReleaseTag = (version: string, tagFormat?: string): string => {
  const normalizedVersion = stripLeadingV(version);
  const trimmedFormat = tagFormat?.trim();
  if (!trimmedFormat) {
    return `v${normalizedVersion}`;
  }
  if (trimmedFormat.includes("{version}")) {
    return trimmedFormat.replaceAll("{version}", normalizedVersion);
  }
  return `${trimmedFormat}${normalizedVersion}`;
};

const formatCommitLine = (commit: ParsedConventionalCommit): string => {
  const scopePrefix = commit.scope ? `**${commit.scope}**: ` : "";
  const prSuffix = commit.prNumber !== undefined ? ` (#${commit.prNumber})` : "";
  const shaSuffix = commit.sha ? ` (${commit.sha.slice(0, 7)})` : "";
  return `- ${scopePrefix}${commit.subject}${prSuffix}${shaSuffix}`;
};

const buildSections = (
  breakingChanges: readonly ParsedConventionalCommit[],
  features: readonly ParsedConventionalCommit[],
  fixes: readonly ParsedConventionalCommit[],
  otherCommits: readonly ParsedConventionalCommit[],
): readonly string[] => {
  const sections: string[] = [];
  const appendSection = (heading: string, items: readonly ParsedConventionalCommit[]): void => {
    if (items.length === 0) return;
    sections.push(`### ${heading}`, "", ...items.map(formatCommitLine), "");
  };

  appendSection("Breaking Changes", breakingChanges);
  appendSection("Features", features);
  appendSection("Fixes", fixes);
  appendSection("Other Changes", otherCommits);

  if (sections.length === 0) {
    sections.push("- Maintenance release with no categorized commit entries.", "");
  }

  return sections;
};

export const proposeRelease = (input: ReleaseProposalInput): ReleaseProposal => {
  const parsedCurrent = parseSemVer(input.currentVersion);
  const normalizedCurrent = `${parsedCurrent.major}.${parsedCurrent.minor}.${parsedCurrent.patch}`;
  const commits = input.commits.map(parseConventionalCommit);
  const bump = deriveSemVerBump(commits);

  const policyVersion = input.existingPolicyVersion?.trim();
  const hasPolicyVersion = Boolean(policyVersion);
  const versionSource = hasPolicyVersion ? "existing_policy" : "conventional_commits";
  const proposedVersion = hasPolicyVersion
    ? stripLeadingV(policyVersion!)
    : bumpSemVer(parsedCurrent, bump);

  const tagName = formatReleaseTag(proposedVersion, input.existingPolicyTagFormat);
  const releaseDate = input.releaseDate?.trim() || new Date().toISOString().slice(0, 10);

  const breakingChanges = commits.filter((commit) => commit.breaking);
  const features = commits.filter((commit) => !commit.breaking && commit.type === "feat");
  const fixes = commits.filter((commit) => !commit.breaking && commit.type === "fix");
  const otherCommits = commits.filter(
    (commit) => !commit.breaking && commit.type !== "feat" && commit.type !== "fix",
  );

  const sections = buildSections(breakingChanges, features, fixes, otherCommits);
  const changelog = [`## [${tagName}] - ${releaseDate}`, "", ...sections].join("\n").trimEnd();

  const sourceLine =
    versionSource === "existing_policy"
      ? `Version \`${proposedVersion}\` selected from existing repository release policy.`
      : `Version \`${proposedVersion}\` derived via \`${bump}\` bump from \`${normalizedCurrent}\`.`;
  const repoLine = input.repository ? `Repository: \`${input.repository}\`\n` : "";

  const releaseNotes = [`# Release ${tagName}`, "", `${repoLine}${sourceLine}`, "", ...sections]
    .join("\n")
    .trimEnd();

  return {
    currentVersion: normalizedCurrent,
    proposedVersion,
    tagName,
    bump,
    versionSource,
    commits,
    breakingChanges,
    features,
    fixes,
    otherCommits,
    changelog,
    releaseNotes,
  };
};
