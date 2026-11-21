#!/usr/bin/env node

import { assertCompatiblePackageMetadata } from "@github-convention/core";
import cliPackage from "../package.json" with { type: "json" };
import skillPackage from "../../skill/package.json" with { type: "json" };

assertCompatiblePackageMetadata(cliPackage, skillPackage);

console.log(`github-convention ${cliPackage.version}`);
