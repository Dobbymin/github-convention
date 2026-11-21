export type RebasePlan = Readonly<{
  branchName: string;
  defaultBranch: string;
  commands: readonly (readonly string[])[];
  pushArgs: readonly string[];
  allowed: boolean;
  reason: string;
}>;

export const formatBranchName = (type: string, issueNumber: number, slug: string): string => {
  const cleanSlug = slug
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${type}/${issueNumber}-${cleanSlug || "task"}`;
};

export const planBaseRebase = (
  branchName: string,
  defaultBranch: string,
  requiresForcePushAfterRebase = false,
): RebasePlan => {
  if (branchName === defaultBranch || branchName === "main" || branchName === "master") {
    return {
      branchName,
      defaultBranch,
      commands: [],
      pushArgs: [],
      allowed: false,
      reason: `Refusing to push or rewrite protected default branch '${branchName}'.`,
    };
  }

  return {
    branchName,
    defaultBranch,
    commands: [
      ["fetch", "origin", defaultBranch],
      ["rebase", `origin/${defaultBranch}`],
    ],
    pushArgs: requiresForcePushAfterRebase
      ? ["push", "--force-with-lease", "origin", branchName]
      : ["push", "-u", "origin", branchName],
    allowed: true,
    reason: "Rebase and push plan uses safe non-default branch and --force-with-lease when needed.",
  };
};
