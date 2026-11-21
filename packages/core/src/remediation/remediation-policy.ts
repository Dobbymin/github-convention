import { redactSecrets } from "../logging/index.js";
import type {
  ApprovalRequiredReviewCategory,
  CiFailureCategory,
  CiFailureClassification,
  CiFailureInput,
  CiRetryDecision,
  CiRetryEvaluationInput,
  ReviewCommentCategory,
  ReviewCommentClassification,
  ReviewCommentInput,
  StraightforwardReviewCategory,
  ThreadResolutionDecision,
  ThreadResolutionInput,
} from "./types.js";

type PatternRule<TCategory extends string> = Readonly<{
  category: TCategory;
  patterns: readonly RegExp[];
  reason: string;
}>;

const APPROVAL_REQUIRED_REVIEW_RULES: readonly PatternRule<ApprovalRequiredReviewCategory>[] = [
  {
    category: "architecture",
    patterns: [
      /\barchitect(ure|ural)?\b/i,
      /\bdesign\s+(pattern|change|decision)\b/i,
      /\bmodule\s+boundar(y|ies)\b/i,
      /\bextract\s+(service|package|layer)\b/i,
      /\brefactor\s+(layer|architecture|dependency)\b/i,
      /\bbreaking\s+change\b/i,
    ],
    reason: "Comment requests an architectural or structural design change.",
  },
  {
    category: "business_logic",
    patterns: [
      /\bbusiness\s+logic\b/i,
      /\bdomain\s+(rule|logic|behavior)\b/i,
      /\bpricing\b/i,
      /\bbilling\b/i,
      /\bauthorization\s+rule\b/i,
      /\bworkflow\s+state\b/i,
      /\bsemantic(s)?\s+change\b/i,
    ],
    reason: "Comment affects business or domain logic.",
  },
  {
    category: "requirements",
    patterns: [
      /\brequirement(s)?\b/i,
      /\bspec(ification)?\b/i,
      /\bproduct\s+(decision|scope)\b/i,
      /\bacceptance\s+criteria\b/i,
      /\bout\s+of\s+scope\b/i,
      /\bchange\s+behavior\b/i,
    ],
    reason: "Comment changes or questions product requirements.",
  },
];

const STRAIGHTFORWARD_REVIEW_RULES: readonly PatternRule<StraightforwardReviewCategory>[] = [
  {
    category: "naming",
    patterns: [
      /\brename\b/i,
      /\bnaming\b/i,
      /\btypo\b/i,
      /\bmisspell(ed|ing)?\b/i,
      /\bvariable\s+name\b/i,
      /\bfunction\s+name\b/i,
      /\bclearer\s+name\b/i,
    ],
    reason: "Comment requests a straightforward naming or typo fix.",
  },
  {
    category: "style",
    patterns: [
      /\bformat(ting)?\b/i,
      /\bprettier\b/i,
      /\blint\b/i,
      /\beslint\b/i,
      /\bwhitespace\b/i,
      /\bindent(ation)?\b/i,
      /\bimport\s+order\b/i,
      /\bstyle\b/i,
      /\bunused\s+(import|variable)\b/i,
    ],
    reason: "Comment requests a straightforward formatting or lint fix.",
  },
  {
    category: "exception",
    patterns: [
      /\bnull\s+check\b/i,
      /\bundefined\s+check\b/i,
      /\bguard\b/i,
      /\bthrow\b/i,
      /\bcatch\b/i,
      /\berror\s+(handling|message)\b/i,
      /\bedge\s+case\b/i,
      /\bbound(s|ary)?\s+check\b/i,
    ],
    reason: "Comment requests a straightforward guard or exception-handling fix.",
  },
  {
    category: "test",
    patterns: [
      /\badd\s+(a\s+)?(unit\s+)?test\b/i,
      /\bmissing\s+test\b/i,
      /\btest\s+case\b/i,
      /\bassertion\b/i,
      /\btest\s+coverage\b/i,
    ],
    reason: "Comment requests adding or tightening a unit test.",
  },
];

type CiRule = PatternRule<CiFailureCategory> &
  Readonly<{
    retryable: boolean;
    maxRetries: number;
    requiresUserInput: boolean;
  }>;

const CI_FAILURE_RULES: readonly CiRule[] = [
  {
    category: "missing_secret",
    patterns: [
      /\bmissing\s+secret\b/i,
      /\bsecret\s+not\s+found\b/i,
      /\bGITHUB_TOKEN\b/,
      /\bNPM_TOKEN\b/,
      /\bAPI_KEY\b.*\b(missing|not\s+set|required)\b/i,
    ],
    retryable: false,
    maxRetries: 0,
    requiresUserInput: true,
    reason: "CI failed due to a missing secret; user input is required.",
  },
  {
    category: "credentials",
    patterns: [
      /\binvalid\s+(credentials|token|api\s*key)\b/i,
      /\bexpired\s+(token|credentials)\b/i,
      /\bauthentication\s+failed\b/i,
      /\b401\s+unauthorized\b/i,
      /\bbad\s+credentials\b/i,
    ],
    retryable: false,
    maxRetries: 0,
    requiresUserInput: true,
    reason: "CI failed due to invalid or expired credentials; user input is required.",
  },
  {
    category: "permission",
    patterns: [
      /\bpermission\s+denied\b/i,
      /\bresource\s+not\s+accessible\s+by\s+integration\b/i,
      /\b403\s+forbidden\b/i,
      /\binsufficient\s+permissions\b/i,
    ],
    retryable: false,
    maxRetries: 0,
    requiresUserInput: true,
    reason: "CI failed due to insufficient permissions; user input is required.",
  },
  {
    category: "external_config",
    patterns: [
      /\bexternal\s+config(uration)?\b/i,
      /\bbranch\s+protection\b/i,
      /\brequired\s+status\s+check\b/i,
      /\bmarketplace\s+action\s+blocked\b/i,
      /\borganization\s+policy\b/i,
    ],
    retryable: false,
    maxRetries: 0,
    requiresUserInput: true,
    reason: "CI failed due to external configuration or policy; user input is required.",
  },
  {
    category: "infra_outage",
    patterns: [
      /\bgithub\s+outage\b/i,
      /\bincident\s+in\s+progress\b/i,
      /\bno\s+runner\s+available\b/i,
      /\bhosted\s+runner\s+unavailable\b/i,
      /\b503\s+service\s+unavailable\b/i,
    ],
    retryable: false,
    maxRetries: 0,
    requiresUserInput: true,
    reason: "CI failed due to an infrastructure outage; pausing without guessing.",
  },
  {
    category: "transient_network",
    patterns: [
      /\bETIMEDOUT\b/i,
      /\bECONNRESET\b/i,
      /\bECONNREFUSED\b/i,
      /\bENOTFOUND\b/i,
      /\bnetwork\s+(error|timeout)\b/i,
      /\brate\s+limit\b/i,
      /\b429\s+too\s+many\s+requests\b/i,
      /\b502\s+bad\s+gateway\b/i,
      /\b504\s+gateway\s+timeout\b/i,
      /\btransient\b/i,
    ],
    retryable: true,
    maxRetries: 3,
    requiresUserInput: false,
    reason: "Transient external or network failure is eligible for up to 3 retries.",
  },
  {
    category: "lint_error",
    patterns: [/\beslint\b/i, /\bprettier\b/i, /\blint\s*(error|failed)\b/i, /\bformat:check\b/i],
    retryable: true,
    maxRetries: 2,
    requiresUserInput: false,
    reason: "Lint or formatting failure is eligible for up to 2 remediation retries.",
  },
  {
    category: "type_error",
    patterns: [/\btsc\b/i, /\bTS\d{4}:/, /\btypecheck\b/i, /\btype\s+error\b/i],
    retryable: true,
    maxRetries: 2,
    requiresUserInput: false,
    reason: "TypeScript typecheck failure is eligible for up to 2 remediation retries.",
  },
  {
    category: "test_failure",
    patterns: [
      /\btest\s+failed\b/i,
      /\btests?\s+failing\b/i,
      /\bassertionerror\b/i,
      /\bexpected\s+.*\s+to\b/i,
      /\bnode\s+--test\b/i,
    ],
    retryable: true,
    maxRetries: 2,
    requiresUserInput: false,
    reason: "Test failure is eligible for up to 2 remediation retries.",
  },
  {
    category: "code_error",
    patterns: [
      /\bsyntaxerror\b/i,
      /\breferenceerror\b/i,
      /\bcompile\s+(error|failed)\b/i,
      /\bbuild\s+failed\b/i,
      /\bexit\s+code\s+1\b/i,
    ],
    retryable: true,
    maxRetries: 2,
    requiresUserInput: false,
    reason: "Code or build failure is eligible for up to 2 remediation retries.",
  },
];

const collectMatches = (text: string, patterns: readonly RegExp[]): readonly string[] => {
  const matches: string[] = [];
  for (const pattern of patterns) {
    const found = pattern.exec(text);
    if (found?.[0]) {
      matches.push(found[0]);
    }
  }
  return matches;
};

const findMatchingRule = <TCategory extends string, TRule extends PatternRule<TCategory>>(
  text: string,
  rules: readonly TRule[],
): { rule: TRule; matchedSignals: readonly string[] } | undefined => {
  for (const rule of rules) {
    const matchedSignals = collectMatches(text, rule.patterns);
    if (matchedSignals.length > 0) {
      return { rule, matchedSignals };
    }
  }
  return undefined;
};

export const classifyReviewComment = (input: ReviewCommentInput): ReviewCommentClassification => {
  const normalizedBody = redactSecrets(input.body).trim();
  if (normalizedBody.length === 0) {
    return {
      category: "ambiguous",
      kind: "approval_required",
      requiresApproval: true,
      reason: "Empty review comment is ambiguous and requires human review.",
      matchedSignals: [],
    };
  }

  const approvalMatch = findMatchingRule(normalizedBody, APPROVAL_REQUIRED_REVIEW_RULES);
  if (approvalMatch) {
    return {
      category: approvalMatch.rule.category,
      kind: "approval_required",
      requiresApproval: true,
      reason: approvalMatch.rule.reason,
      matchedSignals: approvalMatch.matchedSignals,
    };
  }

  const straightforwardMatch = findMatchingRule(normalizedBody, STRAIGHTFORWARD_REVIEW_RULES);
  if (straightforwardMatch) {
    return {
      category: straightforwardMatch.rule.category,
      kind: "straightforward",
      requiresApproval: false,
      reason: straightforwardMatch.rule.reason,
      matchedSignals: straightforwardMatch.matchedSignals,
    };
  }

  const fallbackCategory: ReviewCommentCategory = "ambiguous";
  return {
    category: fallbackCategory,
    kind: "approval_required",
    requiresApproval: true,
    reason: "Review comment intent is ambiguous; leaving open for human approval.",
    matchedSignals: [],
  };
};

export const evaluateThreadResolution = (
  input: ThreadResolutionInput,
): ThreadResolutionDecision => {
  if (input.alreadyResolved) {
    return {
      threadId: input.threadId,
      resolve: false,
      reason: "Thread is already resolved.",
    };
  }

  if (input.classification.requiresApproval) {
    return {
      threadId: input.threadId,
      resolve: false,
      reason: `Thread requires approval (${input.classification.category}) and must remain open.`,
    };
  }

  if (!input.addressed) {
    return {
      threadId: input.threadId,
      resolve: false,
      reason: "Thread has not been addressed yet.",
    };
  }

  if (!input.verified) {
    return {
      threadId: input.threadId,
      resolve: false,
      reason: "Thread fix has not been verified yet.",
    };
  }

  return {
    threadId: input.threadId,
    resolve: true,
    reason: `Straightforward ${input.classification.category} thread is addressed and verified.`,
  };
};

const normalizeFailureSignature = (category: CiFailureCategory, text: string): string => {
  const collapsed = redactSecrets(text).toLowerCase().replace(/\s+/g, " ").trim();
  const excerpt = collapsed.slice(0, 160);
  return `${category}:${excerpt}`;
};

export const classifyCiFailure = (input: CiFailureInput): CiFailureClassification => {
  const combined = [input.checkName, input.conclusion, input.summary, input.logExcerpt]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join("\n");

  const match = findMatchingRule(combined, CI_FAILURE_RULES);
  if (match) {
    return {
      category: match.rule.category,
      retryable: match.rule.retryable,
      maxRetries: match.rule.maxRetries,
      requiresUserInput: match.rule.requiresUserInput,
      reason: match.rule.reason,
      signature: normalizeFailureSignature(match.rule.category, combined),
      matchedSignals: match.matchedSignals,
    };
  }

  return {
    category: "unknown",
    retryable: false,
    maxRetries: 0,
    requiresUserInput: true,
    reason: "Unclassified CI failure; pausing for user input without guessing.",
    signature: normalizeFailureSignature("unknown", combined),
    matchedSignals: [],
  };
};

export const evaluateCiRetry = (input: CiRetryEvaluationInput): CiRetryDecision => {
  const { classification, retriesUsed, previousSignatures = [] } = input;

  if (classification.requiresUserInput || !classification.retryable) {
    return {
      shouldRetry: false,
      action: "pause_for_user",
      requiresUserInput: true,
      remainingRetries: 0,
      reason: classification.reason,
    };
  }

  if (previousSignatures.includes(classification.signature)) {
    return {
      shouldRetry: false,
      action: "stop_repeated_failure",
      requiresUserInput: true,
      remainingRetries: 0,
      reason: "Repeated identical CI failure detected; stopping early to avoid a retry loop.",
    };
  }

  if (retriesUsed >= classification.maxRetries) {
    return {
      shouldRetry: false,
      action: "stop_max_retries",
      requiresUserInput: true,
      remainingRetries: 0,
      reason: `Retry cap (${classification.maxRetries}) reached for ${classification.category}.`,
    };
  }

  const nextAttempt = retriesUsed + 1;
  return {
    shouldRetry: true,
    action: "retry",
    requiresUserInput: false,
    nextAttempt,
    remainingRetries: classification.maxRetries - nextAttempt,
    reason: `Retrying ${classification.category} (attempt ${nextAttempt} of ${classification.maxRetries}).`,
  };
};
