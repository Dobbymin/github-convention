import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const resolveSessionContext = (cwd = process.cwd()) => {
  const configPath = path.join(cwd, ".github-convention", "config.yaml");
  if (!fs.existsSync(configPath)) {
    return null;
  }
  return [
    "github-convention active: .github-convention/config.yaml detected.",
    "Run `github-convention status` and follow `skills/github-convention/SKILL.md` approval gates before remote mutations.",
  ].join("\n");
};

const isDirectExecution =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  const message = resolveSessionContext(process.cwd());
  if (message) {
    process.stdout.write(`${message}\n`);
  }
}
