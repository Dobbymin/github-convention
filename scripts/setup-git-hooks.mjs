import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

let repositoryRoot;

try {
  repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
} catch {
  console.info("Skipping Git hook setup because this is not a Git repository.");
  process.exit(0);
}

const hooksDirectory = resolve(repositoryRoot, ".githooks");

if (!existsSync(resolve(hooksDirectory, "pre-commit"))) {
  console.info("Skipping Git hook setup because .githooks/pre-commit is missing.");
  process.exit(0);
}

execFileSync("git", ["-C", repositoryRoot, "config", "--local", "core.hooksPath", ".githooks"], {
  stdio: "inherit",
});
execFileSync("git", ["-C", repositoryRoot, "config", "--local", "fetch.prune", "true"], {
  stdio: "inherit",
});
