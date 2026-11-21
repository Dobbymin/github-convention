import * as fs from "node:fs";
import * as path from "node:path";

export const atomicWriteFile = (targetPath: string, content: string | Buffer): void => {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const nonce = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const tempPath = `${targetPath}.${nonce}.tmp`;

  try {
    fs.writeFileSync(tempPath, content, "utf-8");
    fs.renameSync(tempPath, targetPath);
  } catch (err) {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {
      // Ignore cleanup error
    }
    throw err;
  }
};

export const atomicWriteJson = (targetPath: string, data: unknown): void => {
  const json = JSON.stringify(data, null, 2) + "\n";
  atomicWriteFile(targetPath, json);
};
