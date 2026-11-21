import * as fs from "node:fs";
import * as os from "node:os";
import { ErrorCodes } from "../output/exit-codes.js";

export interface LockMetadata {
  pid: number;
  hostname: string;
  createdAt: string;
}

export class LockBusyError extends Error {
  readonly code: string = ErrorCodes.LOCK_BUSY;
  readonly lockPath: string;
  readonly holder?: LockMetadata;

  constructor(lockPath: string, message: string, holder?: LockMetadata) {
    super(message);
    this.name = "LockBusyError";
    this.lockPath = lockPath;
    this.holder = holder;
  }
}

export class FileLock {
  readonly lockPath: string;
  private isHeld = false;

  constructor(targetFilePath: string) {
    this.lockPath = targetFilePath.endsWith(".lock") ? targetFilePath : `${targetFilePath}.lock`;
  }

  private isProcessAlive(pid: number): boolean {
    try {
      // Sending signal 0 tests process existence without terminating it
      process.kill(pid, 0);
      return true;
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException;
      return nodeErr.code !== "ESRCH";
    }
  }

  acquire(options?: { staleTimeoutMs?: number }): void {
    const metadata: LockMetadata = {
      pid: process.pid,
      hostname: os.hostname(),
      createdAt: new Date().toISOString(),
    };
    const content = JSON.stringify(metadata, null, 2);

    try {
      // 'wx' flag opens for writing and fails if file exists (atomic)
      const fd = fs.openSync(this.lockPath, "wx");
      fs.writeFileSync(fd, content, "utf-8");
      fs.closeSync(fd);
      this.isHeld = true;
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code !== "EEXIST") {
        throw err;
      }

      // Lock file already exists. Inspect if it's stale.
      let existingHolder: LockMetadata | undefined;
      try {
        const raw = fs.readFileSync(this.lockPath, "utf-8");
        existingHolder = JSON.parse(raw) as LockMetadata;
      } catch {
        // Corrupt lock file can be treated as candidate for replacement if timeout exceeded
      }

      if (existingHolder && existingHolder.hostname === os.hostname()) {
        const alive = this.isProcessAlive(existingHolder.pid);
        if (!alive) {
          // Process died without releasing lock; break stale lock safely
          try {
            fs.unlinkSync(this.lockPath);
            return this.acquire(options);
          } catch {
            // Raced with another process
          }
        }
      }

      if (options?.staleTimeoutMs && existingHolder?.createdAt) {
        const lockAgeMs = Date.now() - new Date(existingHolder.createdAt).getTime();
        if (lockAgeMs > options.staleTimeoutMs) {
          try {
            fs.unlinkSync(this.lockPath);
            return this.acquire(options);
          } catch {
            // Raced with another process
          }
        }
      }

      const holderInfo = existingHolder
        ? `held by PID ${existingHolder.pid} on ${existingHolder.hostname}`
        : "held by another process";

      throw new LockBusyError(
        this.lockPath,
        `Lock is busy: ${this.lockPath} is currently ${holderInfo}.`,
        existingHolder,
      );
    }
  }

  release(): void {
    if (!this.isHeld && !fs.existsSync(this.lockPath)) {
      return;
    }

    try {
      // Check that we are indeed the holder before releasing
      const raw = fs.readFileSync(this.lockPath, "utf-8");
      const holder = JSON.parse(raw) as LockMetadata;
      if (holder.pid === process.pid && holder.hostname === os.hostname()) {
        fs.unlinkSync(this.lockPath);
      }
    } catch {
      // Lock already removed or unreadable
    } finally {
      this.isHeld = false;
    }
  }

  async withLock<T>(fn: () => Promise<T> | T, options?: { staleTimeoutMs?: number }): Promise<T> {
    this.acquire(options);
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
