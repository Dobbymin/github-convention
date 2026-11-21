import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCompatiblePackageMetadata,
  assertCompatibleVersions,
  isCompatibleVersion,
} from "./compatibility.js";

test("accepts a CLI version in the supported caret range", () => {
  assert.equal(isCompatibleVersion("0.1.0", "^0.1.0"), true);
  assert.doesNotThrow(() =>
    assertCompatibleVersions("0.1.0", "0.1.0", "^0.1.0"),
  );
});

test("rejects an incompatible CLI version", () => {
  assert.equal(isCompatibleVersion("1.0.0", "^0.1.0"), false);
  assert.throws(
    () => assertCompatibleVersions("1.0.0", "0.1.0", "^0.1.0"),
    /is not compatible/,
  );
});

test("validates versions from package metadata", () => {
  assert.doesNotThrow(() =>
    assertCompatiblePackageMetadata(
      { version: "0.1.0" },
      { version: "0.1.0", githubConvention: { compatibleCli: "^0.1.0" } },
    ),
  );
  assert.throws(
    () =>
      assertCompatiblePackageMetadata(
        { version: "1.0.0" },
        { version: "0.1.0", githubConvention: { compatibleCli: "^0.1.0" } },
      ),
    /is not compatible/,
  );
});
