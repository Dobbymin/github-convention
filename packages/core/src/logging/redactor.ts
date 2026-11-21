const GITHUB_TOKEN_PATTERN = /\b(gh[pousr]_[A-Za-z0-9_]{36,})\b/g;
const BEARER_TOKEN_PATTERN = /\b(Bearer\s+)[A-Za-z0-9._~+/-]{16,}={0,2}\b/gi;
const PRIVATE_KEY_PATTERN =
  /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g;
const URL_CREDENTIALS_PATTERN = /(https?:\/\/)([^:@\s]+):([^@\s]+)@/g;
const SENSITIVE_KV_PATTERN =
  /\b((?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|AUTH_KEY|PRIVATE_KEY)\s*[:=]\s*)(['"]?)([^'"\s,;&]+)\2/gi;

export const redactSecrets = (text: string): string => {
  if (typeof text !== "string" || text.length === 0) {
    return text;
  }

  let redacted = text;

  // 1. Private keys
  redacted = redacted.replace(PRIVATE_KEY_PATTERN, "[REDACTED_PRIVATE_KEY]");

  // 2. URL credentials (e.g. https://user:pass@github.com)
  redacted = redacted.replace(URL_CREDENTIALS_PATTERN, "$1[REDACTED]:[REDACTED]@");

  // 3. GitHub personal access / app tokens
  redacted = redacted.replace(GITHUB_TOKEN_PATTERN, "[REDACTED_GITHUB_TOKEN]");

  // 4. Bearer tokens
  redacted = redacted.replace(BEARER_TOKEN_PATTERN, "$1[REDACTED_BEARER_TOKEN]");

  // 5. Sensitive key-value assignments
  redacted = redacted.replace(SENSITIVE_KV_PATTERN, "$1$2[REDACTED]$2");

  return redacted;
};
