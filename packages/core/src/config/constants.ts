import type { GitHubConventionConfig } from "./types.js";

export const CURRENT_SCHEMA_VERSION = 1;

export const DEFAULT_CONFIG: Readonly<GitHubConventionConfig> = Object.freeze({
  schema_version: 1,
  execution: Object.freeze({
    sub_agents: "auto",
    max_parallel_agents: 3,
    retry: Object.freeze({
      worker_max_retries: 2,
      code_ci_max_retries: 2,
      transient_ci_max_retries: 3,
    }),
  }),
  archive: Object.freeze({
    retention_days: 30,
    auto_cleanup_on_cli_start: true,
  }),
  github: Object.freeze({
    auth_preference: "gh",
    default_branch: "detect",
    create_draft_pr: false,
    require_issue_approval: true,
    require_release_approval: true,
  }),
  quality: Object.freeze({
    reuse_existing_tools: true,
    require_secret_scan: true,
    secret_scanner_install_requires_approval: true,
    self_review_required_before_pr: true,
    extra_checks: [],
  }),
  notifications: Object.freeze({
    session: true,
    external: Object.freeze({
      enabled: false,
      provider: null,
    }),
  }),
  privacy: Object.freeze({
    telemetry: false,
  }),
});

export const IMMUTABLE_SAFETY_INVARIANTS: ReadonlyArray<{
  readonly path: string;
  readonly expected: unknown;
  readonly description: string;
}> = Object.freeze([
  {
    path: "github.require_issue_approval",
    expected: true,
    description: "Issue creation approval cannot be disabled by configuration.",
  },
  {
    path: "github.require_release_approval",
    expected: true,
    description: "Release proposal approval cannot be disabled by configuration.",
  },
  {
    path: "github.create_draft_pr",
    expected: false,
    description: "Draft PR creation cannot be enabled by configuration.",
  },
  {
    path: "quality.require_secret_scan",
    expected: true,
    description: "Secret scanning requirement cannot be disabled by configuration.",
  },
  {
    path: "quality.secret_scanner_install_requires_approval",
    expected: true,
    description: "Secret scanner installation approval cannot be disabled by configuration.",
  },
  {
    path: "quality.self_review_required_before_pr",
    expected: true,
    description: "Self-review requirement before PR creation cannot be disabled by configuration.",
  },
  {
    path: "privacy.telemetry",
    expected: false,
    description: "Telemetry cannot be enabled by configuration.",
  },
]);
