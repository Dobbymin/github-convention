import assert from "node:assert/strict";
import test from "node:test";
import { scanContentForSecrets } from "./index.js";

test("scanContentForSecrets: detects secrets, redacts previews, and blocks commit/push", () => {
  const token = ["ghp", "1234567890abcdefghijklmnop"].join("_");
  const res = scanContentForSecrets([
    { path: "src/config.ts", content: `export const TOKEN = "${token}";\n` },
  ]);

  assert.equal(res.clean, false);
  assert.equal(res.blocked, true);
  assert.equal(res.blockingFindings.length, 1);
  assert.equal(res.blockingFindings[0]?.redactedPreview.includes(token), false);
});

test("scanContentForSecrets: supports narrow path+fingerprint allowlist without blanket-ignoring", () => {
  const token = ["ghp", "1234567890abcdefghijklmnop"].join("_");
  const initial = scanContentForSecrets([{ path: "fixtures/test.ts", content: token }]);
  const fp = initial.blockingFindings[0]!.fingerprint;

  const allowed = scanContentForSecrets(
    [{ path: "fixtures/test.ts", content: token }],
    [{ path: "fixtures/test.ts", fingerprint: fp, reason: "Synthetic test fixture" }],
  );
  assert.equal(allowed.blocked, false);

  const otherFile = scanContentForSecrets(
    [{ path: "src/real.ts", content: token }],
    [{ path: "fixtures/test.ts", fingerprint: fp, reason: "Synthetic test fixture" }],
  );
  assert.equal(otherFile.blocked, true);
});
