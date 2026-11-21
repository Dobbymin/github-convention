#!/usr/bin/env node

import { assertCompatiblePackageMetadata } from "@github-convention/core";
import cliPackage from "../package.json" with { type: "json" };
import skillPackage from "../../skill/package.json" with { type: "json" };
import { runCli } from "./runner.js";

export * from "./commands.js";
export * from "./doctor/index.js";
export * from "./formatter.js";
export * from "./install/index.js";
export * from "./options.js";
export * from "./runner.js";
export * from "./validate/index.js";

assertCompatiblePackageMetadata(cliPackage, skillPackage);

// If executed directly from CLI binary
const isDirectExecution =
  process.argv[1]?.endsWith("github-convention") ||
  process.argv[1]?.endsWith("index.js") ||
  process.argv[1]?.endsWith("index.ts");

if (isDirectExecution) {
  runCli(process.argv.slice(2))
    .then(({ exitCode }) => {
      process.exit(exitCode);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
