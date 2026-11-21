export type ValidationCheckStatus = "pass" | "fail" | "warn";

export interface ValidationCheckItem {
  id: string;
  name: string;
  status: ValidationCheckStatus;
  message: string;
  details?: Record<string, unknown>;
}

export interface ValidateOptions {
  projectRoot?: string;
  configPath?: string;
  skillDir?: string;
  statePath?: string;
}

export interface ValidateResult {
  valid: boolean;
  projectRoot: string;
  checks: ValidationCheckItem[];
  errors: string[];
  warnings: string[];
}
