/**
 * lib/routing/promptClassification.ts
 *
 * Structured prompt classifier for Zorelan's risk and confidence layer.
 *
 * Instead of patching one-off rules into route.ts, this module diagnoses
 * the uncertainty drivers present in a prompt and derives a risk level from
 * their combination. This makes classification explainable, extensible, and
 * easier to debug.
 *
 * Usage:
 *   import { classifyPrompt } from "@/lib/routing/promptClassification";
 *   const classification = classifyPrompt(prompt);
 *   // classification.risk feeds getRiskLevel floor
 *   // classification.domain / drivers / reasons available for diagnostics
 *
 * Validated against 14 benchmark prompts — see calibrationTest.ts.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type DomainType =
  | "fact"
  | "best_practice"
  | "tradeoff"
  | "prediction"
  | "personal_decision"
  | "financial"
  | "medical"
  | "legal"
  | "security"
  | "subjective"
  | "philosophical"
  | "mixed"
  | "unknown";

export type UncertaintyDriver =
  | "future_outcome"
  | "missing_personal_context"
  | "subjective_preferences"
  | "time_sensitive"
  | "high_stakes"
  | "jurisdiction_dependent"
  | "medical_safety"
  | "financial_exposure"
  | "multiple_valid_answers"
  | "stable_consensus";

export type StakesLevel = "low" | "moderate" | "high";

export type PromptClassification = {
  domain: DomainType;
  drivers: UncertaintyDriver[];
  stakes: StakesLevel;
  risk: "low" | "moderate" | "high";
  reasons: string[];
};

// ── Helper detectors ──────────────────────────────────────────────────────────

function isMedicalPrompt(p: string): boolean {
  return (
    /\bsymptom(s)?\b/.test(p) ||
    /\bmedication\b/.test(p) ||
    /\bsafe to take\b/.test(p) ||
    /\bdo i have\b/.test(p) ||
    /\bdiagnos(is|ed)\b/.test(p) ||
    /\bside effect(s)?\b/.test(p) ||
    /\bdose\b/.test(p) ||
    /\btreatment\b/.test(p) ||
    /\bibuprofen\b/.test(p) ||
    /\baspirin\b/.test(p) ||
    /\bparacetamol\b/.test(p) ||
    /\bhealthy\b/.test(p) ||
    /\bhealth\b/.test(p) ||
    /\bnutrition\b/.test(p) ||
    /\bdiet\b/.test(p) ||
    /\bfasting\b/.test(p) ||
    /\bsupplement(s)?\b/.test(p) ||
    /\bis\s+\S+\s+(good|bad)\s+for\s+(you|me|health)\b/.test(p) ||
    /\bis\s+\S+\s+safe\b/.test(p)
  );
}

function isLegalPrompt(p: string): boolean {
  return (
    /\blegal\b/.test(p) ||
    /\billegal\b/.test(p) ||
    /\blaw\b/.test(p) ||
    /\btax\b/.test(p) ||
    /\bliability\b/.test(p) ||
    /\blawsuit\b/.test(p) ||
    /\bsue\b/.test(p) ||
    /\bregulat(ion|ory|ed)\b/.test(p) ||
    /\bcomplian(ce|t)\b/.test(p) ||
    /\bcontract\b/.test(p)
  );
}

/**
 * Detects prompts involving production security decisions or known vulnerability
 * patterns. These prompts can produce agreeable-sounding AI answers that still
 * carry high-consequence execution risk and must not auto-allow.
 */
function isSecurityCriticalPrompt(p: string): boolean {
  return (
    /\bvirus scan(ning)?\b/.test(p) ||
    /\bmalware\b/.test(p) ||
    /\bsql injection\b/.test(p) ||
    /\b(xss|csrf|ssrf)\b/.test(p) ||
    /\bpath traversal\b/.test(p) ||
    /\bremote code execution\b/.test(p) ||
    /\bsecurity vulnerabilit/.test(p) ||
    /\bwithout (virus |malware )?(scan(ning)?|sanitiz)/.test(p)
  );
}

function isFinancialPrompt(p: string): boolean {
  return (
    /\binvest(ing|ment|or)?\b/.test(p) ||
    /\bstock(s|market)?\b/.test(p) ||
    /\bportfolio\b/.test(p) ||
    /\bbuy a house\b/.test(p) ||
    /\bcrypto(currency)?\b/.test(p) ||
    /\bbitcoin\b/.test(p) ||
    /\bether(eum)?\b/.test(p) ||
    /\bfinanci(al|ally)\b/.test(p) ||
    /\bsaving(s)?\b/.test(p) ||
    /\bretirement\b/.test(p) ||
    /\bmortgage\b/.test(p) ||
    /\bdebt\b/.test(p)
  );
}

function isPredictionPrompt(p: string): boolean {
  return (
    /\bwill\b/.test(p) ||
    /\bgoing to\b/.test(p) ||
    /in the next \d+ (year|month)/i.test(p) ||
    /\bwhat will happen\b/.test(p) ||
    /\bfuture of\b/.test(p) ||
    /\bpredict\b/.test(p) ||
    /\boutlook\b/.test(p) ||
    /\bforecast\b/.test(p)
  );
}

function isPersonalDecisionPrompt(p: string): boolean {
  // Deliberately narrow — only life/career/location decisions, NOT
  // "should I use X" technical questions.
  return (
    /\bquit my job\b/.test(p) ||
    /\bleave my job\b/.test(p) ||
    /\bmove (to|cities|country)\b/.test(p) ||
    /\bmy situation\b/.test(p) ||
    /\bfor me personally\b/.test(p) ||
    /\bshould i quit\b/.test(p) ||
    /\bshould i leave\b/.test(p) ||
    /\bshould i move\b/.test(p) ||
    /\bshould i retire\b/.test(p) ||
    /\bshould i get married\b/.test(p) ||
    /\bshould i have (a |kids|children)\b/.test(p)
  );
}

function isTimeSensitivePrompt(p: string): boolean {
  return (
    /\bright now\b/.test(p) ||
    /\bcurrently\b/.test(p) ||
    /\bthis year\b/.test(p) ||
    /\btoday\b/.test(p) ||
    /\bat the moment\b/.test(p) ||
    /\bin \d{4}\b/.test(p) ||
    /\bnowadays\b/.test(p) ||
    /\brecently\b/.test(p)
  );
}

function isTradeoffPrompt(p: string): boolean {
  return (
    /\bvs\.?\b/.test(p) ||
    /\bversus\b/.test(p) ||
    /\bbetter (for|than)\b/.test(p) ||
    /\bchoose\b/.test(p) ||
    /\bwhich (should|is|one)\b/.test(p) ||
    // "or" only when combined with "should i" — avoids "is water H or O?"
    (/\bshould i\b/.test(p) && /\bor\b/.test(p))
  );
}

function isPhilosophicalPrompt(p: string): boolean {
  return (
    /\bgod\b/.test(p) ||
    /\bmeaning of life\b/.test(p) ||
    /\bpurpose of life\b/.test(p) ||
    /\bexistence of\b/.test(p) ||
    /\bfree will\b/.test(p)
  );
}

function isSubjectivePrompt(p: string): boolean {
  return (
    /\bbest\b/.test(p) ||
    /\bworth it\b/.test(p) ||
    /\bshould people\b/.test(p) ||
    /\bis it right\b/.test(p) ||
    /\bmorally\b/.test(p) ||
    /\bethically\b/.test(p)
  );
}

/**
 * Best-practice prompts have widely accepted answers with no meaningful
 * tradeoff. Key signal: "should I use X" with no "or Y" alternative.
 * HTTPS is the canonical example — there is no real alternative worth choosing.
 */
function isBestPracticePrompt(p: string): boolean {
  const hasRecommendationSeek =
    /\bshould i use\b/.test(p) || /\bshould i (always|ever)\b/.test(p);
  const isNotTradeoff = !(/\bor\b/.test(p) || /\bvs\.?\b/.test(p) || /\bversus\b/.test(p));
  const isNotHighStakes =
    !isFinancialPrompt(p) && !isMedicalPrompt(p) && !isLegalPrompt(p);
  return hasRecommendationSeek && isNotTradeoff && isNotHighStakes;
}

function isFactPrompt(p: string): boolean {
  return (
    /^is\b/.test(p) ||
    /^are\b/.test(p) ||
    /^what happens\b/.test(p) ||
    /^what is\b/.test(p) ||
    /^does\b/.test(p) ||
    /^do\b/.test(p) ||
    /^can\b/.test(p) ||
    /^how does\b/.test(p)
  );
}

function isStableFactPrompt(p: string): boolean {
  return (
    isFactPrompt(p) &&
    !isPredictionPrompt(p) &&
    !isMedicalPrompt(p) &&
    !isLegalPrompt(p) &&
    !isFinancialPrompt(p) &&
    !isPersonalDecisionPrompt(p)
  );
}

// ── Risk derivation ───────────────────────────────────────────────────────────

/**
 * Derives risk from the combination of uncertainty drivers and stakes.
 *
 * Precedence (highest wins — first match applies):
 *   Tier 1: medical_safety / jurisdiction_dependent / financial_exposure → high
 *   Tier 2: future_outcome + high-consequence driver → high
 *   Tier 3: missing_personal_context + personal_decision domain → high
 *   Tier 4: future_outcome alone → moderate (generic forecast)
 *   Tier 5: multiple_valid_answers / subjective_preferences / time_sensitive → moderate
 *   Tier 6: stable_consensus alone → low
 *   Default: moderate (unknown is not safe)
 */
function deriveRisk(input: {
  domain: DomainType;
  drivers: UncertaintyDriver[];
  stakes: StakesLevel;
}): "low" | "moderate" | "high" {
  const d = new Set(input.drivers);

  if (
    d.has("medical_safety") ||
    d.has("jurisdiction_dependent") ||
    d.has("financial_exposure")
  ) {
    return "high";
  }

  if (
    d.has("future_outcome") &&
    (d.has("financial_exposure") ||
      d.has("medical_safety") ||
      d.has("high_stakes") ||
      d.has("missing_personal_context") ||
      input.stakes === "high")
  ) {
    return "high";
  }

  if (
    d.has("missing_personal_context") &&
    input.domain === "personal_decision"
  ) {
    return "high";
  }

  if (d.has("future_outcome")) {
    return "moderate";
  }

  if (
    d.has("multiple_valid_answers") ||
    d.has("subjective_preferences") ||
    d.has("time_sensitive")
  ) {
    return "moderate";
  }

  if (d.has("stable_consensus")) {
    return "low";
  }

  return "moderate";
}

// ── Main classifier ───────────────────────────────────────────────────────────

export function classifyPrompt(prompt: string): PromptClassification {
  const p = prompt.toLowerCase().trim();

  const drivers = new Set<UncertaintyDriver>();
  const reasons: string[] = [];

  let domain: DomainType = "unknown";
  let stakes: StakesLevel = "low";

  // ── Domain detection (order matters — more specific first) ────────────────
if (isSecurityCriticalPrompt(p)) {
  domain = "security";
  stakes = "high";
} else if (isMedicalPrompt(p)) {
  domain = "medical";
  stakes = "high";
} else if (isLegalPrompt(p)) {
  domain = "legal";
  stakes = "high";
} else if (isFinancialPrompt(p)) {
  domain = "financial";
  stakes = "high";
} else if (isPersonalDecisionPrompt(p)) {
  domain = "personal_decision";
  stakes = "high";
} else if (isPredictionPrompt(p)) {
  domain = "prediction";
} else if (isTradeoffPrompt(p)) {
  domain = "tradeoff";
  if (stakes === "low") stakes = "moderate";
} else if (isBestPracticePrompt(p)) {
  domain = "best_practice";
} else if (isPhilosophicalPrompt(p)) {
  domain = "philosophical";
} else if (isSubjectivePrompt(p)) {
  domain = "subjective";
} else if (isStableFactPrompt(p)) {
  domain = "fact";
}

  // Handle mixed domain (multiple high-stakes domains present)
  const highStakesDomainCount = [
    isMedicalPrompt(p),
    isLegalPrompt(p),
    isFinancialPrompt(p),
  ].filter(Boolean).length;
  if (highStakesDomainCount > 1) {
    domain = "mixed";
  }

  // ── Driver detection ──────────────────────────────────────────────────────

  if (isPredictionPrompt(p)) {
    drivers.add("future_outcome");
    reasons.push("Prompt asks for a future outcome or prediction.");
  }

  if (isPersonalDecisionPrompt(p)) {
    drivers.add("missing_personal_context");
    reasons.push("Prompt depends on user-specific context not fully available.");
  }

  if (isSubjectivePrompt(p)) {
    drivers.add("subjective_preferences");
    reasons.push("Prompt depends on personal preferences or values.");
  }

  if (isTimeSensitivePrompt(p)) {
    drivers.add("time_sensitive");
    reasons.push("Prompt depends on current timing or market conditions.");
  }

  if (isMedicalPrompt(p)) {
    drivers.add("medical_safety");
    reasons.push("Prompt involves medical or health safety.");
  }

  if (isLegalPrompt(p)) {
    drivers.add("jurisdiction_dependent");
    reasons.push("Prompt may vary by jurisdiction or legal context.");
  }

  if (isFinancialPrompt(p)) {
    drivers.add("financial_exposure");
    reasons.push("Prompt involves financial loss or investment risk.");
  }

  if (isTradeoffPrompt(p)) {
    drivers.add("multiple_valid_answers");
    reasons.push("Prompt allows multiple valid answers depending on context.");
  }

  if (
    stakes === "high" &&
    !drivers.has("medical_safety") &&
    !drivers.has("jurisdiction_dependent") &&
    !drivers.has("financial_exposure")
  ) {
    drivers.add("high_stakes");
    reasons.push("Prompt involves high-stakes personal consequences.");
  }

  // stable_consensus only when no other drivers present
  if (drivers.size === 0 && (isStableFactPrompt(p) || isBestPracticePrompt(p))) {
    drivers.add("stable_consensus");
    reasons.push(
      isBestPracticePrompt(p)
        ? "Prompt asks about a widely accepted best practice with no meaningful alternative."
        : "Prompt appears to ask about a stable, widely settled fact."
    );
  }

  const risk = deriveRisk({ domain, drivers: [...drivers], stakes });

  return {
    domain,
    drivers: [...drivers],
    stakes,
    risk,
    reasons,
  };
}
