import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ProbeEnvironment } from "./types.js";

export const createDefaultProbeEnvironment = (): Required<ProbeEnvironment> => {
  const homeDir = os.homedir();
  const projectDir = process.cwd();
  const rawPath = process.env.PATH ?? "";
  const pathDirs = rawPath.split(path.delimiter).filter(Boolean);

  const fileExists = (filePath: string): boolean => {
    try {
      return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
    } catch {
      return false;
    }
  };

  const dirExists = (dirPath: string): boolean => {
    try {
      return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
    } catch {
      return false;
    }
  };

  const commandExists = (cmd: string): string | null => {
    for (const dir of pathDirs) {
      const fullPath = path.join(dir, cmd);
      if (fileExists(fullPath)) {
        return fullPath;
      }
      if (process.platform === "win32") {
        for (const ext of [".exe", ".cmd", ".bat"]) {
          const winPath = `${fullPath}${ext}`;
          if (fileExists(winPath)) {
            return winPath;
          }
        }
      }
    }
    return null;
  };

  return {
    homeDir,
    projectDir,
    pathDirs,
    fileExists,
    dirExists,
    commandExists,
  };
};

export const resolveProbeEnvironment = (env?: ProbeEnvironment): Required<ProbeEnvironment> => {
  const defaults = createDefaultProbeEnvironment();
  return {
    homeDir: env?.homeDir ?? defaults.homeDir,
    projectDir: env?.projectDir ?? defaults.projectDir,
    pathDirs: env?.pathDirs ?? defaults.pathDirs,
    fileExists: env?.fileExists ?? defaults.fileExists,
    dirExists: env?.dirExists ?? defaults.dirExists,
    commandExists: env?.commandExists ?? defaults.commandExists,
  };
};
