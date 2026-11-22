import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  REPO_ROOT,
  parseSimpleYaml,
  validateAgainstSchema,
  validateRepo,
} from "../validate.mjs";

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "gh-conv-val-"));

test("validateAgainstSchema and parseSimpleYaml validate examples and catch mismatches", () => {
  const configSchema = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "schemas", "config.schema.json"), "utf8"),
  );
  const stateSchema = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "schemas", "state.schema.json"), "utf8"),
  );
  const configExample = parseSimpleYaml(
    fs.readFileSync(path.join(REPO_ROOT, "examples", "config.yaml"), "utf8"),
  );
  const stateExample = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "examples", "state.json"), "utf8"),
  );

  // Valid live examples pass
  validateAgainstSchema(configExample, configSchema, "examples/config.yaml");
  validateAgainstSchema(stateExample, stateSchema, "examples/state.json");

  // state.json no longer hardcodes "reportLanguage": "en"
  assert.notEqual(stateExample.tasks[0].worker.reportLanguage, "en");

  // Invalid config.yaml caught
  assert.throws(
    () =>
      validateAgainstSchema(
        { schema_version: 1, session: { context_mode: "invalid" } },
        configSchema,
        "bad-config",
      ),
    /not in enum/,
  );
  assert.throws(
    () =>
      validateAgainstSchema(
        { schema_version: 1, privacy: { telemetry: true } },
        configSchema,
        "bad-privacy",
      ),
    /expected const false/,
  );

  // Invalid state.json caught
  assert.throws(
    () => validateAgainstSchema({ schemaVersion: 1 }, stateSchema, "missing-fields"),
    /missing required property/,
  );
  assert.throws(
    () =>
      validateAgainstSchema(
        { ...stateExample, status: "unknown_status" },
        stateSchema,
        "bad-status",
      ),
    /not in enum/,
  );
});

test("validateRepo fails when README.md version drifts from package.json", () => {
  const tempRoot = makeTempDir();
  try {
    fs.cpSync(REPO_ROOT, tempRoot, {
      recursive: true,
      filter: (src) => !src.includes(`${path.sep}.git`),
    });
    const readmePath = path.join(tempRoot, "README.md");
    const drifted = fs.readFileSync(readmePath, "utf8").replaceAll("v0.2.1", "v0.2.0");
    fs.writeFileSync(readmePath, drifted);

    assert.throws(() => validateRepo(tempRoot), /README\.md/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
