export type SubAgentsMode = "auto" | "enabled" | "disabled";
export type AuthPreference = "gh" | "connected_agent_tool";

export interface RetryConfig {
  worker_max_retries?: number;
  code_ci_max_retries?: number;
  transient_ci_max_retries?: number;
  [key: string]: unknown;
}

export interface ExecutionConfig {
  sub_agents?: SubAgentsMode;
  max_parallel_agents?: number;
  retry?: RetryConfig;
  [key: string]: unknown;
}

export interface ArchiveConfig {
  retention_days?: number;
  auto_cleanup_on_cli_start?: boolean;
  [key: string]: unknown;
}

export interface GitHubConfig {
  auth_preference?: AuthPreference;
  default_branch?: string;
  create_draft_pr?: boolean;
  require_issue_approval?: boolean;
  require_release_approval?: boolean;
  [key: string]: unknown;
}

export interface QualityConfig {
  reuse_existing_tools?: boolean;
  require_secret_scan?: boolean;
  secret_scanner_install_requires_approval?: boolean;
  self_review_required_before_pr?: boolean;
  extra_checks?: string[];
  [key: string]: unknown;
}

export interface ExternalNotificationConfig {
  enabled?: boolean;
  provider?: string | null;
  [key: string]: unknown;
}

export interface NotificationsConfig {
  session?: boolean;
  external?: ExternalNotificationConfig;
  [key: string]: unknown;
}

export interface PrivacyConfig {
  telemetry?: boolean;
  [key: string]: unknown;
}

export interface GitHubConventionConfig {
  schema_version: number;
  execution: {
    sub_agents: SubAgentsMode;
    max_parallel_agents: number;
    retry: {
      worker_max_retries: number;
      code_ci_max_retries: number;
      transient_ci_max_retries: number;
    };
  };
  archive: {
    retention_days: number;
    auto_cleanup_on_cli_start: boolean;
  };
  github: {
    auth_preference: AuthPreference;
    default_branch: string;
    create_draft_pr: false;
    require_issue_approval: true;
    require_release_approval: true;
  };
  quality: {
    reuse_existing_tools: boolean;
    require_secret_scan: true;
    secret_scanner_install_requires_approval: true;
    self_review_required_before_pr: true;
    extra_checks: string[];
  };
  notifications: {
    session: boolean;
    external: {
      enabled: boolean;
      provider: string | null;
    };
  };
  privacy: {
    telemetry: false;
  };
  [key: string]: unknown;
}

export type PartialConfig = {
  schema_version?: number;
  execution?: ExecutionConfig;
  archive?: ArchiveConfig;
  github?: GitHubConfig;
  quality?: QualityConfig;
  notifications?: NotificationsConfig;
  privacy?: PrivacyConfig;
  [key: string]: unknown;
};

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface MigrationResult {
  migrated: boolean;
  fromVersion: number;
  toVersion: number;
  config: GitHubConventionConfig;
  backupPath?: string;
  conflict?: {
    field: string;
    reason: string;
  };
}
