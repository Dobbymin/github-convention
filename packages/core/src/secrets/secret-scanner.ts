import * as crypto from "node:crypto";
import { redactSecrets } from "../logging/redactor.js";
import type {
  SecretAllowlistRule,
  SecretFinding,
  SecretScanInputFile,
  SecretScanResult,
} from "./types.js";

const SECRET_RULES: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  { id: "github_pat", pattern: /\b(gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
  { id: "aws_access_key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: "private_key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { id: "bearer_token", pattern: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi },
  {
    id: "generic_api_key",
    pattern: /\b(?:api_key|secret_key|access_token)\s*[:=]\s*["'][A-Za-z0-9_\-]{12,}["']/gi,
  },
];

const toPosix = (value: string): string => value.replaceAll("\\", "/").replace(/^\.\//, "");

const fingerprintValue = (ruleId: string, raw: string): string =>
  crypto.createHash("sha256").update(`${ruleId}:${raw}`).digest("hex").slice(0, 16);

export const scanContentForSecrets = (
  files: readonly SecretScanInputFile[],
  allowlist: readonly SecretAllowlistRule[] = [],
): SecretScanResult => {
  const findings: SecretFinding[] = [];

  for (const file of files) {
    const normalizedPath = toPosix(file.path);
    const lines = file.content.split(/\r?\n/);

    for (let idx = 0; idx < lines.length; idx += 1) {
      const lineText = lines[idx]!;
      for (const rule of SECRET_RULES) {
        rule.pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = rule.pattern.exec(lineText)) !== null) {
          const matchedText = match[0];
          const fingerprint = fingerprintValue(rule.id, matchedText);
          const allowlisted = allowlist.some(
            (entry) => toPosix(entry.path) === normalizedPath && entry.fingerprint === fingerprint,
          );

          findings.push({
            path: normalizedPath,
            line: idx + 1,
            ruleId: rule.id,
            fingerprint,
            redactedPreview: redactSecrets(lineText.trim()),
            allowlisted,
          });
        }
      }
    }
  }

  const blockingFindings = findings.filter((item) => !item.allowlisted);

  return {
    clean: blockingFindings.length === 0,
    blocked: blockingFindings.length > 0,
    findings,
    blockingFindings,
  };
};
