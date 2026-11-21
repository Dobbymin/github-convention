import type {
  CompatibleLabelMatch,
  ConflictingLabelMatch,
  DeprecatedLabelCandidate,
  DuplicateLabelCandidate,
  GitHubLabel,
  LabelReconciliationResult,
  TemplateLabel,
} from "./types.js";

const normalizeName = (name: string): string => name.trim().toLowerCase();

const normalizeColor = (color: string): string => color.replace(/^#/, "").trim().toLowerCase();

const normalizeDescription = (description: string | undefined): string =>
  (description ?? "").trim();

export const reconcileLabels = (
  existingLabels: readonly GitHubLabel[],
  templateLabels: readonly TemplateLabel[],
): LabelReconciliationResult => {
  const compatible: CompatibleLabelMatch[] = [];
  const missing: TemplateLabel[] = [];
  const conflicting: ConflictingLabelMatch[] = [];
  const deprecatedCandidates: DeprecatedLabelCandidate[] = [];
  const duplicateCandidates: DuplicateLabelCandidate[] = [];

  // 1. Group existing labels by normalized name to detect exact-name duplicates.
  const existingByName = new Map<string, GitHubLabel[]>();
  for (const label of existingLabels) {
    const key = normalizeName(label.name);
    const list = existingByName.get(key) ?? [];
    list.push(label);
    existingByName.set(key, list);
  }

  for (const [normalizedName, group] of existingByName.entries()) {
    if (group.length > 1) {
      duplicateCandidates.push({
        normalizedName,
        labels: group,
        reason: `Multiple existing labels share the normalized name "${normalizedName}".`,
      });
    }
  }

  const matchedExisting = new Set<GitHubLabel>();

  // 2. Match template labels against existing labels (exact match first, then migrated_from).
  for (const template of templateLabels) {
    const exactKey = normalizeName(template.name);
    const exactMatches = existingByName.get(exactKey) ?? [];
    const migratedKeys = (template.migrated_from ?? []).map(normalizeName);
    const migratedMatches = migratedKeys.flatMap((key) => existingByName.get(key) ?? []);

    if (exactMatches.length > 0 && migratedMatches.length > 0) {
      duplicateCandidates.push({
        normalizedName: exactKey,
        labels: [...exactMatches, ...migratedMatches],
        reason: `Both canonical label "${template.name}" and migrated legacy label(s) exist.`,
      });
    }

    if (exactMatches.length > 0) {
      const existing = exactMatches[0];
      matchedExisting.add(existing);
      for (const extra of exactMatches.slice(1)) {
        matchedExisting.add(extra);
      }

      const reasons: string[] = [];
      if (normalizeColor(existing.color) !== normalizeColor(template.color)) {
        reasons.push(
          `color mismatch (existing "${normalizeColor(existing.color)}" vs template "${normalizeColor(template.color)}")`,
        );
      }
      const existingDesc = normalizeDescription(existing.description);
      const templateDesc = normalizeDescription(template.description);
      if (existingDesc.length > 0 && templateDesc.length > 0 && existingDesc !== templateDesc) {
        reasons.push(`description mismatch ("${existingDesc}" vs "${templateDesc}")`);
      }

      if (reasons.length > 0) {
        conflicting.push({ existing, template, reasons });
      } else {
        compatible.push({ existing, template, matchType: "exact" });
      }
      continue;
    }

    if (migratedMatches.length > 0) {
      const existing = migratedMatches[0];
      for (const match of migratedMatches) {
        matchedExisting.add(match);
      }
      compatible.push({ existing, template, matchType: "migrated_from" });
      continue;
    }

    missing.push(template);
  }

  // 3. Any unmatched existing label is a deprecated candidate.
  for (const label of existingLabels) {
    if (matchedExisting.has(label)) {
      continue;
    }
    const lower = normalizeName(label.name);
    const reason =
      lower === "blocked" || lower.startsWith("status:")
        ? "Disallowed by label policy; native dependencies or state replace this label."
        : "Not present in template label catalog.";
    deprecatedCandidates.push({ label, reason });
  }

  return {
    compatible,
    missing,
    conflicting,
    deprecatedCandidates,
    duplicateCandidates,
  };
};
