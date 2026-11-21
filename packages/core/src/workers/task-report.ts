import type { ParsedTaskReport, TaskReportStatus } from "./types.js";

const REQUIRED_SECTIONS = [
  "Summary",
  "Changed Files",
  "Tests",
  "Technical Decisions",
  "Known Issues",
  "Blockers",
] as const;

const VALID_STATUSES = new Set<TaskReportStatus>(["completed", "blocked", "failed"]);

const parseBulletLines = (sectionText: string): string[] =>
  sectionText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim().replace(/^`|`$/g, ""))
    .filter((item) => item.length > 0 && item !== "None.");

export const parseTaskReport = (markdown: string): ParsedTaskReport => {
  const issueMatch = /^\s*-\s*Issue:\s*(.+)$/im.exec(markdown);
  const statusMatch = /^\s*-\s*Status:\s*(.+)$/im.exec(markdown);

  const rawStatus = (statusMatch?.[1]?.trim().toLowerCase() ?? "") as TaskReportStatus;
  const status: TaskReportStatus = VALID_STATUSES.has(rawStatus) ? rawStatus : "failed";

  const sections = new Map<string, string>();
  const headingPattern = /^###\s+(.+)$/gm;
  const matches = [...markdown.matchAll(headingPattern)];
  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i]!;
    const title = match[1]!.trim();
    const start = (match.index ?? 0) + match[0].length;
    const end =
      i + 1 < matches.length ? (matches[i + 1]!.index ?? markdown.length) : markdown.length;
    sections.set(title, markdown.slice(start, end).trim());
  }

  return {
    issue: issueMatch?.[1]?.trim() ?? "",
    status,
    summary: sections.get("Summary") ?? "",
    changedFiles: parseBulletLines(sections.get("Changed Files") ?? ""),
    tests: parseBulletLines(sections.get("Tests") ?? ""),
    technicalDecisions: parseBulletLines(sections.get("Technical Decisions") ?? ""),
    knownIssues: parseBulletLines(sections.get("Known Issues") ?? ""),
    blockers: parseBulletLines(sections.get("Blockers") ?? ""),
  };
};

export const validateTaskReport = (
  markdown: string,
): { valid: boolean; errors: readonly string[]; report: ParsedTaskReport } => {
  const report = parseTaskReport(markdown);
  const errors: string[] = [];

  if (!report.issue) errors.push("Task Report is missing '- Issue:' header.");
  if (!/^\s*-\s*Status:\s*(completed|blocked|failed)\s*$/im.test(markdown)) {
    errors.push("Task Report must declare '- Status: completed | blocked | failed'.");
  }
  for (const section of REQUIRED_SECTIONS) {
    if (!new RegExp(`^###\\s+${section}\\s*$`, "m").test(markdown)) {
      errors.push(`Task Report is missing '### ${section}' section.`);
    }
  }
  if (!report.summary) errors.push("Task Report '### Summary' cannot be empty.");

  return {
    valid: errors.length === 0,
    errors,
    report,
  };
};
