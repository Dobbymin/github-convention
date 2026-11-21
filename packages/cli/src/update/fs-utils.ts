import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

/** Reject absolute paths, traversal, and empty segments before touching the filesystem. */
export const safeRelativePath = (relativePath: string): string => {
  const normalized = relativePath.replaceAll("\\", "/");
  if (normalized.length === 0 || path.isAbsolute(normalized)) {
    throw new Error(`Unsafe relative path: '${relativePath}'`);
  }

  const segments = normalized.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new Error(`Unsafe relative path: '${relativePath}'`);
  }

  return segments.join(path.sep);
};

export const resolveInside = (root: string, relativePath: string): string => {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, safeRelativePath(relativePath));
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`Path escapes managed root: '${relativePath}'`);
  }
  return resolved;
};

export const lstatOrNull = (targetPath: string): fs.Stats | null => {
  try {
    return fs.lstatSync(targetPath);
  } catch {
    return null;
  }
};

/** Hash only regular files; symlinks and other file types are never followed. */
export const hashRegularFile = (
  targetPath: string,
): { sha256: string; size: number } | undefined => {
  const stat = lstatOrNull(targetPath);
  if (!stat?.isFile()) return undefined;
  const content = fs.readFileSync(targetPath);
  return {
    sha256: crypto.createHash("sha256").update(content).digest("hex"),
    size: content.length,
  };
};
