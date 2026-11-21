import * as assert from "node:assert/strict";
import { test } from "node:test";
import { Logger, MemoryLogSink, redactSecrets } from "./index.js";

test("redactSecrets: redacts tokens, private keys, passwords, and URLs (FR-STATE-08)", () => {
  // GitHub PAT
  const text1 = "Using token ghp_1234567890abcdefghijklmnopqrstuvwxyz12 to authenticate";
  assert.equal(redactSecrets(text1), "Using token [REDACTED_GITHUB_TOKEN] to authenticate");

  // Bearer token
  const text2 = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz";
  assert.equal(redactSecrets(text2), "Authorization: Bearer [REDACTED_BEARER_TOKEN]");

  // URL with credentials
  const text3 = "Cloning from https://dobbymin:secret_password@github.com/repo.git";
  assert.equal(
    redactSecrets(text3),
    "Cloning from https://[REDACTED]:[REDACTED]@github.com/repo.git",
  );

  // Private key
  const text4 =
    "Key content:\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----\nDone";
  assert.equal(redactSecrets(text4), "Key content:\n[REDACTED_PRIVATE_KEY]\nDone");

  // Sensitive key-value assignments
  const text5 = "CONFIG_ENV: API_KEY=my_secret_api_key_12345";
  assert.equal(redactSecrets(text5), "CONFIG_ENV: API_KEY=[REDACTED]");
});

test("Logger: records sanitized messages into sink and enforces telemetry absence (FR-STATE-07)", () => {
  const sink = new MemoryLogSink();
  const logger = new Logger({ sink });

  assert.equal(logger.assertNoTelemetry(), true);

  logger.info("Started task with token ghp_abcdefghijklmnopqrstuvwxyz0123456789");
  logger.warn("Warning: URL was https://admin:pass1234@example.com/api");

  assert.equal(sink.entries.length, 2);
  assert.ok(!sink.entries[0].message.includes("ghp_"));
  assert.ok(sink.entries[0].message.includes("[REDACTED_GITHUB_TOKEN]"));
  assert.ok(!sink.entries[1].message.includes("pass1234"));
  assert.ok(sink.entries[1].message.includes("[REDACTED]:[REDACTED]@"));
});
