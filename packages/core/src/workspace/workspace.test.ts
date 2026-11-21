import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createIsolatedWorktree, inspectWorktree, removeOwnedWorktree } from "./index.js";

const initTempRepo = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ghc-wt-repo-"));
  execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: dir, stdio: "ignore" });
  fs.writeFileSync(path.join(dir, "README.md"), "# temp\n", "utf-8");
  execFileSync("git", ["add", "README.md"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "chore: init"], { cwd: dir, stdio: "ignore" });
  return dir;
};

test("worktree lifecycle: creates distinct worktree, refuses dirty removal without approval, and removes clean owned worktree", () => {
  const repoRoot = initTempRepo();
  const wtRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ghc-wt-child-"));
  const wtPath = path.join(wtRoot, "task-1");

  const record = createIsolatedWorktree(repoRoot, wtPath, "TASK-1", "feat/task-1");
  assert.equal(path.normalize(record.worktreePath), path.normalize(wtPath));
  assert.notEqual(path.normalize(repoRoot), path.normalize(wtPath));

  // Dirty worktree must be preserved unless explicitly approved
  fs.writeFileSync(path.join(wtPath, "uncommitted.txt"), "wip", "utf-8");
  const dirtyInspection = inspectWorktree(wtPath);
  assert.equal(dirtyInspection.ownedByNode, true);
  assert.equal(dirtyInspection.dirty, true);

  const blockedRemove = removeOwnedWorktree(repoRoot, wtPath, false);
  assert.equal(blockedRemove.removed, false);
  assert.equal(blockedRemove.approvalRequired, true);
  assert.equal(fs.existsSync(wtPath), true);

  // Clean worktree removes cleanly
  fs.unlinkSync(path.join(wtPath, "uncommitted.txt"));
  const cleanRemove = removeOwnedWorktree(repoRoot, wtPath, false);
  assert.equal(cleanRemove.removed, true);
  assert.equal(fs.existsSync(wtPath), false);

  fs.rmSync(repoRoot, { recursive: true, force: true });
  fs.rmSync(wtRoot, { recursive: true, force: true });
});
