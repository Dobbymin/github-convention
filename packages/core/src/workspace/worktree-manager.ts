import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteJson } from "../state/atomic-write.js";
import type {
  WorktreeInspection,
  WorktreeOwnershipRecord,
  WorktreeRemovalResult,
} from "./types.js";

const OWNERSHIP_FILE = ".github-convention-worktree.json";

const runGit = (cwd: string, args: readonly string[]): string =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });

export const createIsolatedWorktree = (
  repoRoot: string,
  worktreePath: string,
  taskId: string,
  branchName: string,
  baseRef = "HEAD",
): WorktreeOwnershipRecord => {
  const resolvedRoot = path.resolve(repoRoot);
  const resolvedWorktree = path.resolve(worktreePath);

  if (fs.existsSync(resolvedWorktree)) {
    throw new Error(`Target worktree path already exists: ${resolvedWorktree}`);
  }

  fs.mkdirSync(path.dirname(resolvedWorktree), { recursive: true });
  runGit(resolvedRoot, ["worktree", "add", "-b", branchName, resolvedWorktree, baseRef]);

  const record: WorktreeOwnershipRecord = {
    schemaVersion: 1,
    taskId,
    branchName,
    worktreePath: resolvedWorktree,
    createdAt: new Date().toISOString(),
    owner: "orchestrator",
  };
  atomicWriteJson(path.join(resolvedWorktree, OWNERSHIP_FILE), record);
  return record;
};

export const inspectWorktree = (worktreePath: string): WorktreeInspection => {
  const resolvedWorktree = path.resolve(worktreePath);
  if (!fs.existsSync(resolvedWorktree)) {
    return {
      exists: false,
      ownedByNode: false,
      dirty: false,
      statusLines: [],
      worktreePath: resolvedWorktree,
    };
  }

  const ownershipPath = path.join(resolvedWorktree, OWNERSHIP_FILE);
  let ownedByNode = false;
  if (fs.existsSync(ownershipPath)) {
    try {
      const parsed = JSON.parse(
        fs.readFileSync(ownershipPath, "utf-8"),
      ) as Partial<WorktreeOwnershipRecord>;
      ownedByNode =
        parsed.owner === "orchestrator" &&
        typeof parsed.worktreePath === "string" &&
        path.normalize(parsed.worktreePath) === path.normalize(resolvedWorktree);
    } catch {
      ownedByNode = false;
    }
  }

  const rawStatus = runGit(resolvedWorktree, ["status", "--porcelain"]);
  const statusLines = rawStatus
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0 && !line.endsWith(OWNERSHIP_FILE));

  return {
    exists: true,
    ownedByNode,
    dirty: statusLines.length > 0,
    statusLines,
    worktreePath: resolvedWorktree,
  };
};

export const removeOwnedWorktree = (
  repoRoot: string,
  worktreePath: string,
  explicitApproval = false,
): WorktreeRemovalResult => {
  const resolvedRoot = path.resolve(repoRoot);
  const resolvedWorktree = path.resolve(worktreePath);
  const inspection = inspectWorktree(resolvedWorktree);

  if (!inspection.exists) {
    return {
      removed: false,
      approvalRequired: false,
      worktreePath: resolvedWorktree,
      reason: "Worktree does not exist.",
    };
  }

  if (!inspection.ownedByNode && !explicitApproval) {
    return {
      removed: false,
      approvalRequired: true,
      worktreePath: resolvedWorktree,
      reason: "Worktree lacks valid orchestrator ownership manifest; explicit approval required.",
    };
  }

  if (inspection.dirty && !explicitApproval) {
    return {
      removed: false,
      approvalRequired: true,
      worktreePath: resolvedWorktree,
      reason: "Worktree has uncommitted changes; preserving until explicitly approved.",
    };
  }

  const ownershipPath = path.join(resolvedWorktree, OWNERSHIP_FILE);
  if (fs.existsSync(ownershipPath)) {
    fs.unlinkSync(ownershipPath);
  }

  const args = ["worktree", "remove"];
  if (explicitApproval) args.push("--force");
  args.push(resolvedWorktree);
  runGit(resolvedRoot, args);

  return {
    removed: true,
    approvalRequired: false,
    worktreePath: resolvedWorktree,
    reason: "Removed orchestrator-owned clean worktree.",
  };
};
