import { redactSecrets } from "../logging/redactor.js";
import type { ParentIssueDraft, SubIssueDraft } from "./types.js";

export type RenderIssueBodyOptions = Readonly<{
  subIssues?: readonly Pick<SubIssueDraft, "id" | "title">[];
}>;

const isParentDraft = (draft: ParentIssueDraft | SubIssueDraft): draft is ParentIssueDraft => {
  return "goals" in draft && "inScope" in draft;
};

const sanitizeMarkerToken = (value: string): string => {
  return redactSecrets(value)
    .replace(/[\r\n;]+/g, "-")
    .replace(/-->/g, "--")
    .trim();
};

export const formatIdempotencyMarker = (planId: string, taskId: string): string => {
  const safePlanId = sanitizeMarkerToken(planId);
  const safeTaskId = sanitizeMarkerToken(taskId);
  return `<!-- github-convention:plan=${safePlanId};task=${safeTaskId} -->`;
};

const formatBulletList = (
  items: readonly string[] | undefined,
  emptyFallback = "- None",
): string => {
  if (!items || items.length === 0) {
    return emptyFallback;
  }
  return items.map((item) => `- ${item}`).join("\n");
};

const formatChecklist = (
  items: readonly string[] | undefined,
  emptyFallback = "- [ ] None",
): string => {
  if (!items || items.length === 0) {
    return emptyFallback;
  }
  return items.map((item) => `- [ ] ${item}`).join("\n");
};

const renderParentBody = (draft: ParentIssueDraft, options?: RenderIssueBodyOptions): string => {
  const sections: string[] = [
    "## Summary",
    "",
    draft.summary,
    "",
    "## Goals",
    "",
    formatBulletList(draft.goals),
    "",
    "## Scope",
    "",
    "### In scope",
    "",
    formatBulletList(draft.inScope),
    "",
    "### Out of scope",
    "",
    formatBulletList(draft.outOfScope),
  ];

  if (options?.subIssues && options.subIssues.length > 0) {
    sections.push(
      "",
      "## Sub-issues",
      "",
      options.subIssues.map((sub) => `- [ ] ${sub.id}: ${sub.title}`).join("\n"),
    );
  }

  sections.push("", "## Acceptance Criteria", "", formatChecklist(draft.acceptanceCriteria));

  if (draft.references && draft.references.length > 0) {
    sections.push("", "## References", "", formatBulletList(draft.references));
  }

  return sections.join("\n");
};

const renderSubIssueBody = (draft: SubIssueDraft): string => {
  const dependencyLines =
    draft.hardDependencies.length > 0
      ? draft.hardDependencies.map((dep) => `- Blocked by: ${dep}`).join("\n")
      : "- None";

  const technicalNotes: string[] = [];
  if (draft.allowedFiles.length > 0) {
    technicalNotes.push(`Allowed files: ${draft.allowedFiles.join(", ")}`);
  }
  if (draft.sharedContracts.length > 0) {
    technicalNotes.push(`Shared contracts: ${draft.sharedContracts.join(", ")}`);
  }
  if (draft.technicalNotes && draft.technicalNotes.length > 0) {
    technicalNotes.push(...draft.technicalNotes);
  }

  const sections: string[] = [
    "## Summary",
    "",
    draft.summary,
    "",
    "## Context",
    "",
    draft.context ?? "None",
    "",
    "## Requirements",
    "",
    formatBulletList(draft.requirements),
    "",
    "## Tasks",
    "",
    formatChecklist(draft.tasks),
    "",
    "## Acceptance Criteria",
    "",
    formatChecklist(draft.acceptanceCriteria),
    "",
    "## Dependencies",
    "",
    dependencyLines,
    "",
    "## Technical Notes",
    "",
    formatBulletList(technicalNotes),
    "",
    "## Assumptions",
    "",
    formatBulletList(draft.assumptions),
  ];

  if (draft.references && draft.references.length > 0) {
    sections.push("", "## References", "", formatBulletList(draft.references));
  }

  return sections.join("\n");
};

export const renderIssueBody = (
  draft: ParentIssueDraft | SubIssueDraft,
  planId: string,
  options?: RenderIssueBodyOptions,
): string => {
  const rawBody = isParentDraft(draft)
    ? renderParentBody(draft, options)
    : renderSubIssueBody(draft);
  const marker = formatIdempotencyMarker(planId, draft.id);
  return redactSecrets(`${rawBody}\n\n${marker}\n`);
};
