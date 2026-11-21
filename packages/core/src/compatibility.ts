export type SemVer = Readonly<{ major: number; minor: number; patch: number }>;

export type VersionedPackage = Readonly<{
  version: string;
}>;

export type SkillPackage = VersionedPackage &
  Readonly<{
    githubConvention: Readonly<{
      compatibleCli: string;
    }>;
  }>;

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const parseSemVer = (version: string): SemVer | null => {
  const match = SEMVER_PATTERN.exec(version);
  if (match === null) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
};

export const isCompatibleVersion = (version: string, range: string): boolean => {
  if (!range.startsWith("^")) return false;
  const candidate = parseSemVer(version);
  const minimum = parseSemVer(range.slice(1));
  if (candidate === null || minimum === null) return false;
  if (minimum.major > 0) {
    return candidate.major === minimum.major && candidate.minor >= minimum.minor;
  }
  return (
    candidate.major === 0 && candidate.minor === minimum.minor && candidate.patch >= minimum.patch
  );
};

export const assertCompatibleVersions = (
  cliVersion: string,
  skillVersion: string,
  cliRange: string,
): void => {
  if (!isCompatibleVersion(cliVersion, cliRange)) {
    throw new Error(
      `CLI version ${cliVersion} is not compatible with Skill ${skillVersion} (${cliRange}).`,
    );
  }
};

export const assertCompatiblePackageMetadata = (
  cliPackage: VersionedPackage,
  skillPackage: SkillPackage,
): void => {
  assertCompatibleVersions(
    cliPackage.version,
    skillPackage.version,
    skillPackage.githubConvention.compatibleCli,
  );
};
