import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { FileLock, LockBusyError } from "./index.js";

test("FileLock: acquires and releases lock file cleanly", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lock-test-"));
  const targetFile = path.join(tmpDir, "state.json");
  const lock = new FileLock(targetFile);

  assert.equal(fs.existsSync(lock.lockPath), false);

  lock.acquire();
  assert.equal(fs.existsSync(lock.lockPath), true);

  const raw = fs.readFileSync(lock.lockPath, "utf-8");
  const metadata = JSON.parse(raw);
  assert.equal(metadata.pid, process.pid);

  lock.release();
  assert.equal(fs.existsSync(lock.lockPath), false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("FileLock: concurrent acquisition throws LockBusyError with LOCK_BUSY code", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lock-test-"));
  const targetFile = path.join(tmpDir, "state.json");
  const lock1 = new FileLock(targetFile);
  const lock2 = new FileLock(targetFile);

  lock1.acquire();

  assert.throws(
    () => {
      lock2.acquire();
    },
    (err: unknown) => {
      assert.ok(err instanceof LockBusyError);
      assert.equal((err as LockBusyError).code, "LOCK_BUSY");
      return true;
    },
  );

  lock1.release();

  // Now lock2 can acquire
  lock2.acquire();
  assert.equal(fs.existsSync(lock2.lockPath), true);
  lock2.release();

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("FileLock: withLock safely handles errors and releases lock in finally", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lock-test-"));
  const targetFile = path.join(tmpDir, "state.json");
  const lock = new FileLock(targetFile);

  await assert.rejects(
    async () => {
      await lock.withLock(async () => {
        assert.equal(fs.existsSync(lock.lockPath), true);
        throw new Error("Inside lock error");
      });
    },
    { message: "Inside lock error" },
  );

  assert.equal(fs.existsSync(lock.lockPath), false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
