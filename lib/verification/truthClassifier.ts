import type { PromptClassification } from "@/lib/routing/promptClassification";

export type TruthClassification =
  | "FACTUAL_STABLE"
  | "FACTUAL_UNCERTAIN"
  | "CONTROVERSIAL"
  | "MISINFORMATION_PATTERN";

export interface TruthClassifierResult {
  classification: TruthClassification;
  reasoning: string;
}

// Prompts asserting well-known false claims — highest priority.
const MISINFORMATION_PATTERNS: RegExp[] = [
  /\bvaccines?\s+(cause|causes|causing)\s+autism\b/i,
  /\bautism\b.*\bcaused\s+by\s+vaccines?\b/i,
  /\bearth\s+is\s+flat\b/i,
  /\bflat[\s-]earth\b/i,
  /\b5g\s+(causes?|spread(s|ing)?)\s+(covid|coronavirus|cancer)\b/i,
  /\bcovid[- ]?19?\s+(is\s+)?(a\s+)?(hoax|fake|not\s+real)\b/i,
  /\bchemtrails?\s+(are|is)\b/i,
  /\bholocaust\s+(didn'?t\s+happen|never\s+happened|is\s+(a\s+)?(fake|hoax|lie|myth))\b/i,
  /\bclimate\s+change\s+is\s+(a\s+)?(fake|hoax|not\s+real|a\s+lie)\b/i,
  /\b(drink|drinking|consume|consuming)\s+bleach\b/i,
  /\bbleach\s+(cure|treat|heals?|prevents?)\b/i,
  /\bmoon\s+landing\s+(was\s+)?(faked?|a\s+hoax|never\s+happened|didn'?t\s+happen)\b/i,
];

// Topics contested on values or politics — no stable factual answer.
const CONTROVERSIAL_PATTERNS: RegExp[] = [
  /\b(abortion|pro-life|pro-choice)\b/i,
  /\bgun\s+(control|rights?|ban)\b/i,
  /\bsecond\s+amendment\b/i,
  /\b(death\s+penalty|capital\s+punishment)\b/i,
  /\baffirmative\s+action\b/i,
  /\beuthanasia\b/i,
  /\bassisted\s+suicide\b/i,
  /\b(does\s+god|is\s+god|god\s+exist(s)?|does\s+allah|is\s+allah)\b/i,
  /\b(socialism|capitalism|communism)\s+(is\s+)?(better|best|worse|right|wrong)\b/i,
  /\b(democrats?|republicans?|liberals?|conservatives?)\s+(are\s+)?(better|right|correct|wrong|worse|bad)\b/i,
  /\billegal\s+immigration\b/i,
  /\bopen\s+borders\b/i,
  /\bshould\s+(marijuana|cannabis|drugs?)\s+be\s+(legal|legalized|decriminalized)\b/i,
  /\bis\s+(religion|christianity|islam|judaism)\s+(true|false|real|fake)\b/i,
];

/**
 * Classify a prompt by its truth-stability characteristics.
 *
 * This is a trust guardrail, not a fact-checking engine.
 * It prevents false confidence when models agree on uncertain or contested topics.
 *
 * Precedence: MISINFORMATION_PATTERN > CONTROVERSIAL > domain-based derivation.
 */
export function classifyTruthRisk(
  prompt: string,
  promptClassification: PromptClassification
): TruthClassifierResult {
  const p = prompt.toLowerCase();

  for (const pattern of MISINFORMATION_PATTERNS) {
    if (pattern.test(p)) {
      return {
        classification: "MISINFORMATION_PATTERN",
        reasoning: "Prompt matches a known misinformation pattern.",
      };
    }
  }

  for (const pattern of CONTROVERSIAL_PATTERNS) {
    if (pattern.test(p)) {
      return {
        classification: "CONTROVERSIAL",
        reasoning: "Prompt involves a politically or ethically contested topic.",
      };
    }
  }

  const { domain, drivers } = promptClassification;

  if (domain === "subjective") {
    return {
      classification: "CONTROVERSIAL",
      reasoning: "Prompt involves subjective judgment or contested values.",
    };
  }

  if (
    domain === "financial" ||
    domain === "medical" ||
    domain === "legal" ||
    domain === "prediction" ||
    domain === "personal_decision" ||
    domain === "security" ||
    domain === "mixed" ||
    domain === "unknown"
  ) {
    return {
      classification: "FACTUAL_UNCERTAIN",
      reasoning: `Prompt falls in the '${domain}' domain, which carries inherent uncertainty or context-dependence.`,
    };
  }

  if (domain === "tradeoff") {
    return {
      classification: "FACTUAL_UNCERTAIN",
      reasoning:
        "Prompt asks for a tradeoff evaluation; the correct answer depends on context.",
    };
  }

  if (
    domain === "fact" ||
    domain === "best_practice" ||
    drivers.includes("stable_consensus")
  ) {
    return {
      classification: "FACTUAL_STABLE",
      reasoning:
        "Prompt asks about a stable fact or widely accepted best practice.",
    };
  }

  return {
    classification: "FACTUAL_UNCERTAIN",
    reasoning:
      "Prompt could not be confirmed as a stable fact; treating as uncertain.",
  };
}
