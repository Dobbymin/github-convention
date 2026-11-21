import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteJson } from "../state/atomic-write.js";
import { computeDirectoryManifest, computeFileHash } from "./hasher.js";
import type { InstallManifest, IntegrityCheckResult } from "./types.js";

export const MANIFEST_FILENAME = ".manifest.json";

export const saveManifest = (skillDir: string, manifest: InstallManifest): void => {
  const manifestPath = path.join(skillDir, MANIFEST_FILENAME);
  atomicWriteJson(manifestPath, manifest);
};

export const loadManifest = (skillDir: string): InstallManifest | null => {
  const manifestPath = path.join(skillDir, MANIFEST_FILENAME);
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    return JSON.parse(raw) as InstallManifest;
  } catch {
    return null;
  }
};

export const verifyManifestIntegrity = (
  skillDir: string,
  manifest: InstallManifest,
): IntegrityCheckResult => {
  const modifiedFiles: string[] = [];
  const missingFiles: string[] = [];

  const manifestFileMap = new Map<string, string>();
  for (const f of manifest.files) {
    manifestFileMap.set(f.relativePath, f.sha256);
  }

  // Check recorded files
  for (const record of manifest.files) {
    const localPath = path.join(skillDir, record.relativePath);
    if (!fs.existsSync(localPath)) {
      missingFiles.push(record.relativePath);
      continue;
    }

    const { sha256 } = computeFileHash(localPath);
    if (sha256 !== record.sha256) {
      modifiedFiles.push(record.relativePath);
    }
  }

  // Check unexpected extra files
  const currentFiles = computeDirectoryManifest(skillDir);
  const unexpectedFiles: string[] = [];
  for (const f of currentFiles) {
    if (!manifestFileMap.has(f.relativePath)) {
      unexpectedFiles.push(f.relativePath);
    }
  }

  return {
    valid: modifiedFiles.length === 0 && missingFiles.length === 0 && unexpectedFiles.length === 0,
    modifiedFiles,
    missingFiles,
    unexpectedFiles,
  };
};
