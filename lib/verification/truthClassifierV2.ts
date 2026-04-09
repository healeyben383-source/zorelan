import Anthropic from "@anthropic-ai/sdk";
import type { PromptClassification } from "@/lib/routing/promptClassification";
import type { TruthClassification, TruthClassifierResult } from "./truthClassifier";

// Domains that V2 is never allowed to upgrade out of FACTUAL_UNCERTAIN,
// regardless of how confident the model sounds.
const HARD_UNCERTAIN_DOMAINS = new Set<PromptClassification["domain"]>([
  "medical",
  "financial",
  "legal",
  "prediction",
  "personal_decision",
  "security",
  "mixed",
]);

const MODEL = "claude-haiku-4-5-20251001";
const TIMEOUT_MS = 10_000;

const SYSTEM_PROMPT =
  "You are an epistemic stability classifier. " +
  "Given a question and the AI answers provided, return a JSON object with exactly this shape: " +
  '{"classification":"FACTUAL_STABLE"|"FACTUAL_UNCERTAIN"|"CONTROVERSIAL"|"MISINFORMATION_PATTERN","reasoning":"one sentence"}. ' +
  "Definitions: " +
  "FACTUAL_STABLE = stable scientific, technical, or explanatory knowledge with broad consensus and no meaningful context-dependence. " +
  "FACTUAL_UNCERTAIN = context-dependent, personalized, medical, financial, legal, predictive, timing-sensitive, or not safely universal. " +
  "CONTROVERSIAL = politically, ethically, religiously, or ideologically contested — no stable factual answer. " +
  "MISINFORMATION_PATTERN = question assumes or promotes a known false premise, even if the answers correctly rebut it. " +
  "You are NOT a fact-checker. Classify epistemic stability only. No other text outside the JSON object.";

/**
 * Lightweight model-based truth/controversy classifier (V2).
 *
 * Uses Anthropic Haiku — same model and pattern as the quality judge.
 * Falls back to the deterministic result on timeout or parse failure.
 */
export async function classifyTruthRiskV2(args: {
  prompt: string;
  answers: Array<{ provider: string; text: string }>;
  promptClassification?: PromptClassification;
  fallback: TruthClassifierResult;
}): Promise<TruthClassifierResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return args.fallback;

  const client = new Anthropic({ apiKey });

  const answerBlock = args.answers
    .map((a) => `[${a.provider}]: ${a.text.slice(0, 400)}`)
    .join("\n\n");

  const userContent = `Question: ${args.prompt}\n\nModel answers:\n${answerBlock}`;

  try {
    const response = await Promise.race([
      client.messages.create({
        model: MODEL,
        max_tokens: 120,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("truth_v2_timeout")), TIMEOUT_MS)
      ),
    ]);

    const raw =
      response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
    if (!raw) return args.fallback;

    const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned) as { classification: unknown; reasoning: unknown };

    const VALID: TruthClassification[] = [
      "FACTUAL_STABLE",
      "FACTUAL_UNCERTAIN",
      "CONTROVERSIAL",
      "MISINFORMATION_PATTERN",
    ];

    if (
      !VALID.includes(parsed.classification as TruthClassification) ||
      typeof parsed.reasoning !== "string"
    ) {
      return args.fallback;
    }

    return {
      classification: parsed.classification as TruthClassification,
      reasoning: parsed.reasoning,
    };
  } catch {
    return args.fallback;
  }
}

/**
 * Conservative merge of deterministic (V1) and semantic (V2) truth classifications.
 *
 * Precedence:
 *   1. Either says MISINFORMATION_PATTERN  → MISINFORMATION_PATTERN
 *   2. Either says CONTROVERSIAL           → CONTROVERSIAL
 *   3. V1=FACTUAL_UNCERTAIN + V2=FACTUAL_STABLE:
 *        upgrade only when domain is NOT a hard-uncertain domain
 *        AND semantic agreement is not low
 *        AND no likely conflict detected
 *   4. Either says FACTUAL_UNCERTAIN       → FACTUAL_UNCERTAIN
 *   5. Both agree on FACTUAL_STABLE        → FACTUAL_STABLE
 */
export function mergeTruthClassifications(args: {
  deterministic: TruthClassifierResult;
  v2: TruthClassifierResult;
  promptClassification: PromptClassification;
  semanticAgreementLevel: "high" | "medium" | "low";
  likelyConflict: boolean;
}): TruthClassifierResult & { source: "deterministic" | "v2" | "merged" } {
  const { deterministic, v2, promptClassification, semanticAgreementLevel, likelyConflict } = args;
  const dc = deterministic.classification;
  const vc = v2.classification;

  if (dc === "MISINFORMATION_PATTERN" || vc === "MISINFORMATION_PATTERN") {
    const winner = dc === "MISINFORMATION_PATTERN" ? deterministic : v2;
    return { ...winner, classification: "MISINFORMATION_PATTERN", source: dc === vc ? "deterministic" : "merged" };
  }

  if (dc === "CONTROVERSIAL" || vc === "CONTROVERSIAL") {
    const winner = dc === "CONTROVERSIAL" ? deterministic : v2;
    return { ...winner, classification: "CONTROVERSIAL", source: dc === vc ? "deterministic" : "merged" };
  }

  // V2 wants to upgrade FACTUAL_UNCERTAIN → FACTUAL_STABLE
  if (dc === "FACTUAL_UNCERTAIN" && vc === "FACTUAL_STABLE") {
    const domainIsHardUncertain = HARD_UNCERTAIN_DOMAINS.has(promptClassification.domain);
    const agreementIsStrong = semanticAgreementLevel === "high" && !likelyConflict;

    if (!domainIsHardUncertain && agreementIsStrong) {
      return { ...v2, classification: "FACTUAL_STABLE", source: "v2" };
    }
    // Upgrade blocked — keep deterministic
    return { ...deterministic, source: "deterministic" };
  }

  if (dc === "FACTUAL_UNCERTAIN" || vc === "FACTUAL_UNCERTAIN") {
    const winner = dc === "FACTUAL_UNCERTAIN" ? deterministic : v2;
    return { ...winner, classification: "FACTUAL_UNCERTAIN", source: dc === vc ? "deterministic" : "merged" };
  }

  // Both agree FACTUAL_STABLE
  return { ...deterministic, classification: "FACTUAL_STABLE", source: "deterministic" };
}
