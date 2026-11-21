import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { FileHashRecord } from "./types.js";

export const computeFileHash = (filePath: string): { sha256: string; size: number } => {
  const content = fs.readFileSync(filePath);
  const hash = crypto.createHash("sha256").update(content).digest("hex");
  return {
    sha256: hash,
    size: content.length,
  };
};

export const computeDirectoryManifest = (baseDir: string, currentSubDir = ""): FileHashRecord[] => {
  const targetDir = path.join(baseDir, currentSubDir);
  if (!fs.existsSync(targetDir)) {
    return [];
  }

  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  const records: FileHashRecord[] = [];

  for (const entry of entries) {
    if (entry.name === ".manifest.json" || entry.name === ".DS_Store") {
      continue;
    }

    const relPath = currentSubDir ? path.join(currentSubDir, entry.name) : entry.name;
    const fullPath = path.join(baseDir, relPath);

    if (entry.isDirectory()) {
      records.push(...computeDirectoryManifest(baseDir, relPath));
    } else if (entry.isFile()) {
      const { sha256, size } = computeFileHash(fullPath);
      // Normalize to forward slashes for cross-platform manifest stability
      const normalizedRelPath = relPath.split(path.sep).join("/");
      records.push({
        relativePath: normalizedRelPath,
        sha256,
        size,
      });
    }
  }

  return records.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
};
