#!/usr/bin/env node

import { assertCompatibleVersions } from "@github-convention/core";

const cliVersion = "0.1.0";
const skillVersion = "0.1.0";
const compatibleCliRange = "^0.1.0";

assertCompatibleVersions(cliVersion, skillVersion, compatibleCliRange);
console.log(`github-convention ${cliVersion}`);
