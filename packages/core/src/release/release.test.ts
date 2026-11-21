import assert from "node:assert/strict";
import test from "node:test";
import { proposeRelease } from "./index.js";

test("proposeRelease: derives major, minor, and patch bumps from Conventional Commits", () => {
  const majorByBang = proposeRelease({
    currentVersion: "1.2.3",
    releaseDate: "2026-11-21",
    commits: [
      { sha: "1111111aaaa", message: "feat(cli)!: drop legacy flag", prNumber: 41 },
      { sha: "2222222bbbb", message: "fix: handle empty config" },
    ],
  });
  assert.equal(majorByBang.bump, "major");
  assert.equal(majorByBang.proposedVersion, "2.0.0");
  assert.equal(majorByBang.tagName, "v2.0.0");
  assert.equal(majorByBang.versionSource, "conventional_commits");
  assert.equal(majorByBang.breakingChanges.length, 1);
  assert.equal(majorByBang.fixes.length, 1);
  assert.match(majorByBang.changelog, /## \[v2\.0\.0\] - 2026-11-21/);
  assert.match(majorByBang.changelog, /### Breaking Changes/);
  assert.match(majorByBang.changelog, /\*\*cli\*\*: drop legacy flag \(#41\) \(1111111\)/);

  const majorByFooter = proposeRelease({
    currentVersion: "v0.4.2",
    releaseDate: "2026-11-21",
    commits: [
      {
        message: "refactor: redesign config loader\n\nBREAKING CHANGE: removes v1 schema",
      },
    ],
  });
  assert.equal(majorByFooter.currentVersion, "0.4.2");
  assert.equal(majorByFooter.bump, "major");
  assert.equal(majorByFooter.proposedVersion, "1.0.0");

  const minorProposal = proposeRelease({
    currentVersion: "1.2.3",
    releaseDate: "2026-11-21",
    commits: [
      { message: "feat(release): add proposal engine" },
      { message: "fix(core): normalize path" },
      { message: "docs: update readme" },
    ],
  });
  assert.equal(minorProposal.bump, "minor");
  assert.equal(minorProposal.proposedVersion, "1.3.0");
  assert.equal(minorProposal.features.length, 1);
  assert.equal(minorProposal.fixes.length, 1);
  assert.equal(minorProposal.otherCommits.length, 1);

  const patchProposal = proposeRelease({
    currentVersion: "1.2.3",
    releaseDate: "2026-11-21",
    commits: [{ message: "fix: resolve edge case" }, { message: "chore: tidy scripts" }],
  });
  assert.equal(patchProposal.bump, "patch");
  assert.equal(patchProposal.proposedVersion, "1.2.4");
});

test("proposeRelease: respects existing repository release policy over derived SemVer", () => {
  const proposal = proposeRelease({
    currentVersion: "1.2.3",
    existingPolicyVersion: "v1.5.0-rc.1",
    existingPolicyTagFormat: "release-{version}",
    releaseDate: "2026-11-21",
    repository: "Dobbymin/github-convention",
    commits: [{ message: "feat!: breaking change that policy overrides" }],
  });

  assert.equal(proposal.versionSource, "existing_policy");
  assert.equal(proposal.proposedVersion, "1.5.0-rc.1");
  assert.equal(proposal.tagName, "release-1.5.0-rc.1");
  assert.match(
    proposal.releaseNotes,
    /Version `1\.5\.0-rc\.1` selected from existing repository release policy\./,
  );
  assert.match(proposal.releaseNotes, /# Release release-1\.5\.0-rc\.1/);
});

test("proposeRelease: throws on invalid currentVersion", () => {
  assert.throws(
    () =>
      proposeRelease({
        currentVersion: "not-a-version",
        commits: [],
      }),
    /Invalid SemVer version/,
  );
});
