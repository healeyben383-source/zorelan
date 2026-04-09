import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import { z } from "zod";

import { runOpenAI } from "@/lib/providers/openai";
import { runAnthropic } from "@/lib/providers/anthropic";
import { runPerplexity } from "@/lib/providers/perplexity";
import { detectTaskType } from "@/lib/routing/selectProviders";
import { adaptiveSelectProviders } from "@/lib/routing/adaptiveSelect";
import { compareAnswers } from "@/lib/synthesis/compareAnswers";
import {
  judgeSemanticAgreementOrFallback,
  selectJudgeForProviders,
} from "@/lib/synthesis/semanticAgreement";
import {
  updateProviderScore,
  updateProviderQualityScore,
} from "@/lib/routing/providerScores";
import {
  classifyPrompt,
  type PromptClassification,
} from "@/lib/routing/promptClassification";
import { classifyTruthRisk } from "@/lib/verification/truthClassifier";
import {
  classifyTruthRiskV2,
  mergeTruthClassifications,
} from "@/lib/verification/truthClassifierV2";

export const runtime = "nodejs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const redisUrl = process.env.KV_REST_API_URL;
const redisToken = process.env.KV_REST_API_TOKEN;

if (!redisUrl || !redisToken) {
  throw new Error("Missing Upstash Redis environment variables");
}

const redis = new Redis({ url: redisUrl, token: redisToken });

const TIMEOUT_MS = 30_000;
const VERIFICATION_TIMEOUT_MS = 20_000;
const MAX_PROMPT_CHARS = 10_000;
const MAX_PROVIDERS = 2;
const CACHE_TTL_SECONDS = 21_600; // 6 hours
const CACHE_VERSION = "v4-raw-truth-execution-split-2026-03-20";

const QUALITY_JUDGE_MODEL = "claude-haiku-4-5-20251001";
const ENABLE_API_RATE_LIMIT = process.env.ENABLE_API_RATE_LIMIT === "true";

const MINIMUM_SAMPLES_FOR_WEIGHTING = 20;
const DEFAULT_WEIGHT = 1.0;
const DEFAULT_QUALITY = 7.0;

const apiKeyRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.fixedWindow(10, "10 s"),
  analytics: true,
  timeout: 1000,
});

const ipRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.fixedWindow(30, "10 s"),
  analytics: true,
  timeout: 1000,
});

type ProviderName = "openai" | "anthropic" | "perplexity";
type AgreementLevel = "high" | "medium" | "low";
type RiskLevel = "low" | "moderate" | "high";
type DisagreementType =
  | "none"
  | "additive_nuance"
  | "explanation_variation"
  | "conditional_alignment"
  | "material_conflict";

type ApiKeyRecord = {
  email?: string | null;
  plan: string;
  callsLimit: number;
  callsUsed: number;
  customerId?: string;
  subscriptionId?: string;
  status?: "active" | "inactive";
  createdAt?: number;
};

type WithTimeoutResult<T> = {
  value: T;
  durationMs: number;
  timedOut: boolean;
  usedFallback: boolean;
};

type ProviderStreamOptions = {
  onDelta?: (delta: string) => void;
};

type ProviderRunner = (
  prompt: string,
  signal?: AbortSignal,
  options?: ProviderStreamOptions
) => Promise<string>;

type VerdictPayload = {
  verdict: string;
  keyDisagreement: string;
  recommendedAction: string;
  finalConclusionAligned: boolean;
  disagreementType: DisagreementType;
};

type ProviderExecution = {
  provider: ProviderName;
  answer: string;
  durationMs: number;
  timedOut: boolean;
  usedFallback: boolean;
};

type PairEvaluation = {
  providerA: ProviderName;
  providerB: ProviderName;
  answerA: string;
  answerB: string;
  comparison: ReturnType<typeof compareAnswers>;
  semantic: Awaited<ReturnType<typeof judgeSemanticAgreementOrFallback>>;
};

const AgreementLevelSchema = z.enum(["high", "medium", "low"]);
const RiskLevelSchema = z.enum(["low", "moderate", "high"]);
const ProviderNameSchema = z.enum(["openai", "anthropic", "perplexity"]);
const DisagreementTypeSchema = z.enum([
  "none",
  "additive_nuance",
  "explanation_variation",
  "conditional_alignment",
  "material_conflict",
]);

const DecisionResponseSchema = z.object({
  ok: z.literal(true),
  verdict: z.string(),
  consensus: z.object({
    level: AgreementLevelSchema,
    models_aligned: z.number().int().min(0),
  }),
  risk_level: RiskLevelSchema,
  key_disagreement: z.string(),
  recommended_action: z.string(),
  analysis: z.string(),
  verified_answer: z.string(),
  confidence: AgreementLevelSchema,
  confidence_reason: z.string(),
  trust_score: z.object({
    score: z.number().int().min(0).max(100),
    label: z.enum(["high", "moderate", "low"]),
    reason: z.string(),
  }),
  decision: z.enum(["allow", "review", "block"]),
  decision_reason: z.string(),
  answers: z.object({
    openai: z.string(),
    anthropic: z.string(),
    perplexity: z.string(),
  }),
  selectedProviders: z.array(ProviderNameSchema).length(2),
  providers_used: z.array(z.string()),
  verification: z.object({
    final_conclusion_aligned: z.boolean(),
    disagreement_type: DisagreementTypeSchema,
    semantic_label: z.string(),
    semantic_rationale: z.string(),
    semantic_judge_model: z.string(),
    semantic_used_fallback: z.boolean(),
  }),
  arbitration: z.object({
    used: z.boolean(),
    provider: z.string().nullable(),
    winning_pair: z.array(z.string()),
    pair_strengths: z
      .object({
        initial: z.number(),
        withAThird: z.number().nullable(),
        withBThird: z.number().nullable(),
      })
      .nullable(),
  }),
  model_diagnostics: z.record(
    z.string(),
    z.object({
      quality_score: z.number().nullable(),
      duration_ms: z.number(),
      timed_out: z.boolean(),
      used_fallback: z.boolean(),
    })
  ),
  meta: z.object({
    task_type: z.string(),
    overlap_ratio: z.number(),
    agreement_summary: z.string(),
    prompt_chars: z.number(),
    execution_prompt_chars: z.number().optional(),
    likely_conflict: z.boolean(),
    disagreement_type: DisagreementTypeSchema,
    initial_pair: z.array(z.string()),
  }),
  usage: z
    .object({
      plan: z.string(),
      callsLimit: z.number(),
      callsUsed: z.number(),
      callsRemaining: z.number(),
      status: z.enum(["active", "inactive"]),
    })
    .nullable(),
  cached: z.boolean().optional(),
});

function getDecision(
  trustScore: number,
  riskLevel: "low" | "moderate" | "high",
  disagreementType: string
): { decision: "allow" | "review" | "block"; decision_reason: string } {
  if (riskLevel === "high") {
    return {
      decision: "block",
      decision_reason: "Risk level is high. Do not act on this output without human review.",
    };
  }
  if (disagreementType === "material_conflict") {
    return {
      decision: "block",
      decision_reason: "Models produced a material conflict. Output cannot be trusted without resolution.",
    };
  }
  if (trustScore < 60) {
    return {
      decision: "review",
      decision_reason: "Trust score is below 60. Output requires review before acting.",
    };
  }
  if (trustScore < 80) {
    return {
      decision: "review",
      decision_reason: "Trust score is below 80. Verify output before relying on it in production.",
    };
  }
  return {
    decision: "allow",
    decision_reason: "Low risk, no material conflict, and high trust score. Output is consistent and safe to act on.",
  };
}

/**
 * Deterministic execution gating function.
 * Takes domain, risk, disagreement, alignment, and trust score.
 * Returns a hard decision: allow | review | block.
 *
 * Security prompts can never auto-allow — even at high trust.
 * High risk always gates to review minimum.
 * Conditional alignment prevents automatic execution.
 */
function deriveDecision(input: {
  domain: string;
  risk: "low" | "moderate" | "high";
  disagreementType: string;
  finalConclusionAligned: boolean;
  trustScore: number;
}): { decision: "allow" | "review" | "block"; decision_reason: string } {
  const { domain, risk, disagreementType, finalConclusionAligned, trustScore } = input;

  // Absolute safety floor — security prompts never auto-execute
  if (domain === "security") {
    return {
      decision: "review",
      decision_reason: "Human review required. This prompt involves a security-critical decision that cannot be automatically executed.",
    };
  }

  // High risk — no automatic execution regardless of model agreement
  if (risk === "high") {
    return {
      decision: "review",
      decision_reason: "Human review required. This prompt carries high-risk consequences and must not be acted on automatically.",
    };
  }

  // Material conflict — models fundamentally disagree
  if (disagreementType === "material_conflict") {
    return {
      decision: "review",
      decision_reason: "Human review required. Models produced a material conflict and the output cannot be trusted without resolution.",
    };
  }

  // Conditional alignment — execution depends on conditions or caveats
  if (!finalConclusionAligned) {
    return {
      decision: "review",
      decision_reason: "Human review required. Execution depends on conditions or caveats that were not fully resolved.",
    };
  }

  // Moderate risk — allow only with strong trust and clean agreement
  if (risk === "moderate") {
    if (trustScore >= 80 && disagreementType === "none") {
      return {
        decision: "allow",
        decision_reason: "Moderate risk with strong model agreement and high trust score. Output is consistent and safe to act on.",
      };
    }
    return {
      decision: "review",
      decision_reason: "Human review required. Moderate risk with insufficient trust or agreement to execute automatically.",
    };
  }

  // Low risk — allow if trust score clears threshold
  if (risk === "low") {
    if (trustScore >= 75) {
      return {
        decision: "allow",
        decision_reason: "Low risk, high trust score, and consistent model agreement. Output is safe to act on.",
      };
    }
    return {
      decision: "review",
      decision_reason: "Human review required. Low risk but trust score is below threshold to execute automatically.",
    };
  }

  // Default safe fallback
  return {
    decision: "review",
    decision_reason: "Human review required. Execution safety could not be confirmed.",
  };
}

function withTimeout<T>(
  promiseFactory: (signal: AbortSignal) => Promise<T>,
  ms: number,
  fallback: T
): Promise<WithTimeoutResult<T>> {
  return new Promise((resolve) => {
    const start = Date.now();
    const controller = new AbortController();
    let settled = false;

    const finish = (result: WithTimeoutResult<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      controller.abort();
      finish({
        value: fallback,
        durationMs: Date.now() - start,
        timedOut: true,
        usedFallback: true,
      });
    }, ms);

    promiseFactory(controller.signal)
      .then((value) => {
        finish({
          value,
          durationMs: Date.now() - start,
          timedOut: false,
          usedFallback: false,
        });
      })
      .catch(() => {
        finish({
          value: fallback,
          durationMs: Date.now() - start,
          timedOut: false,
          usedFallback: true,
        });
      });
  });
}

function parseApiKeyRecord(input: unknown): ApiKeyRecord | null {
  try {
    const parsed =
      typeof input === "string" ? JSON.parse(input) : (input as ApiKeyRecord);

    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.plan !== "string" ||
      typeof parsed.callsLimit !== "number" ||
      typeof parsed.callsUsed !== "number"
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function extractBearerToken(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  return token || null;
}

function getClientIp(req: NextRequest): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]?.trim() || "unknown";
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

function hashKey(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function generateCacheKey(prompt: string, providers: string[]): string {
  const normalizedPrompt = prompt.trim().toLowerCase();
  const sortedProviders = [...providers].sort().join(":");
  const hash = crypto
    .createHash("sha256")
    .update(`${CACHE_VERSION}::${normalizedPrompt}::${sortedProviders}`)
    .digest("hex")
    .slice(0, 32);
  return `cache:decision:${hash}`;
}

function getRetryAfterSeconds(reset: number): number {
  return Math.max(1, Math.ceil((reset - Date.now()) / 1000));
}

function rateLimitResponse(scope: "ip" | "api_key", reset: number) {
  const retryAfter = getRetryAfterSeconds(reset);
  return NextResponse.json(
    { ok: false, error: "too_many_requests", scope, retry_after: retryAfter },
    { status: 429, headers: { "Retry-After": String(retryAfter) } }
  );
}

function badRequest(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "unauthorized" },
    { status: 401 }
  );
}

function stripCodeFences(text: string): string {
  return text
    .replace(/```plaintext\s*/gi, "")
    .replace(/```json\s*/gi, "")
    .replace(/```markdown\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
}

function cleanEncoding(text: string): string {
  return text
    .replace(/â€™|â€˜/g, "'")
    .replace(/â€œ|â€/g, '"')
    .replace(/â€“|â€”/g, "-")
    .replace(/Â°/g, "°")
    .replace(/â†’/g, "→")
    .replace(/â‰¥/g, "≥")
    .replace(/â‰¤/g, "≤")
    .replace(/âˆ’/g, "-")
    .replace(/â‚‚/g, "₂")
    .replace(/â‚ƒ/g, "₃")
    .replace(/â‚„/g, "₄")
    .replace(/â‚…/g, "₅")
    .replace(/â‚†/g, "₆")
    .replace(/â‚‡/g, "₇")
    .replace(/â‚ˆ/g, "₈")
    .replace(/â‚‰/g, "₉")
    .replace(/â‚€/g, "₀")
    .replace(/Â/g, "");
}

function isDisagreementType(value: unknown): value is DisagreementType {
  return (
    value === "none" ||
    value === "additive_nuance" ||
    value === "explanation_variation" ||
    value === "conditional_alignment" ||
    value === "material_conflict"
  );
}

function inferFallbackClassification(input: {
  agreementLevel: AgreementLevel;
  likelyConflict: boolean;
}): { finalConclusionAligned: boolean; disagreementType: DisagreementType } {
  if (input.agreementLevel === "high") {
    return { finalConclusionAligned: true, disagreementType: "none" };
  }
  if (input.agreementLevel === "medium") {
    if (input.likelyConflict) {
      return {
        finalConclusionAligned: false,
        disagreementType: "conditional_alignment",
      };
    }
    return {
      finalConclusionAligned: true,
      disagreementType: "additive_nuance",
    };
  }
  return {
    finalConclusionAligned: false,
    disagreementType: "material_conflict",
  };
}

function normalizeVerdictWithSemantic(input: {
  semanticAgreementLevel: AgreementLevel;
  semanticLikelyConflict: boolean;
  verdictPayload: VerdictPayload;
  promptClassification: PromptClassification;
}): VerdictPayload {
  if (
    input.promptClassification.risk === "low" &&
    input.semanticAgreementLevel === "high"
  ) {
    return {
      ...input.verdictPayload,
      finalConclusionAligned: true,
      disagreementType: "none",
    };
  }

  // Fallback-path fix: the semantic judge timed out (slow network) and the
  // heuristic returned "medium" for a low-risk factual/best-practice prompt.
  // A direction mismatch ("positive" vs "neutral" answer phrasing) is enough
  // to push the heuristic score below the 0.74 high-agreement threshold even
  // when both models say exactly the same thing. No genuine conflict was
  // detected — normalize to clean alignment, same as the high+low-risk path above.
  if (
    input.semanticAgreementLevel === "medium" &&
    !input.semanticLikelyConflict &&
    input.promptClassification.risk === "low" &&
    (input.promptClassification.domain === "fact" ||
      input.promptClassification.domain === "best_practice")
  ) {
    return {
      ...input.verdictPayload,
      finalConclusionAligned: true,
      disagreementType: "none",
    };
  }

  const normalized: VerdictPayload = { ...input.verdictPayload };

  if (input.semanticAgreementLevel === "high") {
    normalized.finalConclusionAligned = true;

    if (
      normalized.disagreementType === "material_conflict" ||
      normalized.disagreementType === "conditional_alignment"
    ) {
      normalized.disagreementType = "explanation_variation";
    }

    if (normalized.disagreementType === "explanation_variation") {
      normalized.disagreementType = "additive_nuance";
    }
  }

  if (
    input.semanticAgreementLevel === "medium" &&
    !input.semanticLikelyConflict &&
    input.promptClassification.risk !== "low"
  ) {
    normalized.finalConclusionAligned = true;

    if (normalized.disagreementType === "none") {
      normalized.disagreementType = "additive_nuance";
    }

    if (normalized.disagreementType === "material_conflict") {
      normalized.disagreementType = "conditional_alignment";
    }
  }

  if (
    input.semanticAgreementLevel === "low" &&
    normalized.disagreementType === "none"
  ) {
    normalized.finalConclusionAligned = false;
    normalized.disagreementType = input.semanticLikelyConflict
      ? "material_conflict"
      : "conditional_alignment";
  }

  return normalized;
}

function getModelsAligned(input: {
  totalProviders: number;
  agreementLevel: AgreementLevel;
  finalConclusionAligned: boolean;
  disagreementType: DisagreementType;
}): number {
  if (input.totalProviders <= 1) return input.totalProviders;

  switch (input.disagreementType) {
    case "none":
    case "additive_nuance":
    case "explanation_variation":
      if (input.agreementLevel === "low") return 0;
      if (input.agreementLevel === "medium") {
        return Math.max(1, input.totalProviders - 1);
      }
      return input.totalProviders;
    case "conditional_alignment":
      return Math.max(1, input.totalProviders - 1);
    case "material_conflict":
      return 0;
    default:
      if (input.finalConclusionAligned) return input.totalProviders;
      if (input.agreementLevel === "medium") {
        return Math.max(1, input.totalProviders - 1);
      }
      return 0;
  }
}

function getConsensusLevelFromAligned(
  modelsAligned: number,
  totalProviders: number
): AgreementLevel {
  if (modelsAligned >= totalProviders) return "high";
  if (modelsAligned > 0) return "medium";
  return "low";
}

function getRiskLevel(input: {
  prompt: string;
  agreementLevel: AgreementLevel;
  disagreementType: DisagreementType;
  finalConclusionAligned: boolean;
  promptClassification: PromptClassification;
}): RiskLevel {
  if (input.disagreementType === "material_conflict") return "high";

  if (input.promptClassification.risk === "moderate") {
    if (!input.finalConclusionAligned) return "high";
    return "moderate";
  }

  if (input.promptClassification.risk === "high") return "high";

  if (
    input.promptClassification.risk === "low" &&
    input.finalConclusionAligned &&
    (input.disagreementType === "none" ||
      input.disagreementType === "additive_nuance" ||
      input.disagreementType === "explanation_variation")
  ) {
    return "low";
  }

  if (!input.finalConclusionAligned && input.agreementLevel === "low") {
    return "high";
  }

  return "moderate";
}

function getConfidenceReason(input: {
  agreementLevel: AgreementLevel;
  disagreementType: DisagreementType;
  finalConclusionAligned: boolean;
}): string {
  if (input.disagreementType === "material_conflict") {
    return "The models did not align on the main conclusion and materially conflicted, so the answer should be reviewed carefully.";
  }
  if (input.disagreementType === "conditional_alignment") {
    return "A usable answer exists, but it depends on conditions or tradeoffs rather than clean model agreement.";
  }
  if (
    input.agreementLevel === "high" &&
    (input.disagreementType === "none" ||
      input.disagreementType === "additive_nuance")
  ) {
    return "Both models reached the same core conclusion, with little or no meaningful disagreement.";
  }
  if (input.disagreementType === "explanation_variation") {
    return "Models agreed on the core conclusion but differed in framing, emphasis, or supporting detail.";
  }
  if (!input.finalConclusionAligned) {
    return "The original answers did not cleanly support the same main conclusion, so caution is warranted.";
  }
  return "Models broadly aligned, but there is still some nuance in how they approached the answer.";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getAgreementBaseScore(agreementLevel: AgreementLevel): number {
  if (agreementLevel === "high") return 85;
  if (agreementLevel === "medium") return 65;
  return 35;
}

function getTrustLabel(score: number): "high" | "moderate" | "low" {
  if (score >= 75) return "high";
  if (score >= 55) return "moderate";
  return "low";
}

function calculateTrustScore(input: {
  agreementLevel: AgreementLevel;
  disagreementType: DisagreementType;
  finalConclusionAligned: boolean;
  averageQuality: number;
  riskLevel: RiskLevel;
  prompt: string;
  promptClassification?: { domain: string; risk: "low" | "moderate" | "high" };
}): { score: number; label: "high" | "moderate" | "low"; reason: string } {
  const agreementBase = getAgreementBaseScore(input.agreementLevel);
  const qualityNormalized = input.averageQuality * 10;
  let score = agreementBase * 0.65 + qualityNormalized * 0.35;

  const lowerPrompt = input.prompt.toLowerCase();

  const explicitTradeoff =
    lowerPrompt.includes(" vs ") ||
    lowerPrompt.includes("versus") ||
    lowerPrompt.includes("or ") ||
    lowerPrompt.includes("tradeoff") ||
    lowerPrompt.includes("should i use") ||
    lowerPrompt.includes("should i choose") ||
    lowerPrompt.includes("should i raise") ||
    lowerPrompt.includes("bootstrap");

  const speculativeHighRisk =
    lowerPrompt.includes("investment") ||
    lowerPrompt.includes("invest") ||
    lowerPrompt.includes("cryptocurrency") ||
    lowerPrompt.includes("crypto") ||
    lowerPrompt.includes("bitcoin") ||
    lowerPrompt.includes("ethereum") ||
    lowerPrompt.includes("stock") ||
    lowerPrompt.includes("stocks") ||
    lowerPrompt.includes("shares") ||
    lowerPrompt.includes("asset") ||
    lowerPrompt.includes("portfolio") ||
    lowerPrompt.includes("long-term investment");

  if (input.disagreementType === "additive_nuance") score -= 2;
  else if (input.disagreementType === "explanation_variation") score -= 4;
  else if (input.disagreementType === "conditional_alignment") score -= 20;
  else if (input.disagreementType === "material_conflict") score -= 35;

  if (!input.finalConclusionAligned) score -= 10;

  if (input.riskLevel === "moderate") {
    score -= 3;
  } else if (input.riskLevel === "high") {
    score -= 8;
  }

  if (input.agreementLevel === "high") {
    if (input.disagreementType === "none") {
      score = Math.max(score, 94);
    } else if (input.disagreementType === "additive_nuance") {
      score = Math.max(score, 88);
    } else if (input.disagreementType === "explanation_variation") {
      score = Math.max(score, 82);
    }
  } else if (input.agreementLevel === "medium") {
    score = Math.min(score, 74);
  } else if (input.agreementLevel === "low") {
    score = Math.min(score, 54);
  }

  if (
    input.disagreementType === "none" &&
    input.agreementLevel === "high" &&
    input.riskLevel === "low" &&
    !explicitTradeoff &&
    !speculativeHighRisk
  ) {
    score = Math.max(score, 95);
  }

  if (explicitTradeoff) {
    score = Math.min(score, 90);
  }

  if (speculativeHighRisk || input.riskLevel === "high") {
    score = Math.min(score, 70);
  }

  // Domain and risk-based caps — applied after all scoring to prevent trust score
  // from overriding execution safety signals derived from domain, risk, and disagreement.
  if (input.promptClassification?.domain === "security") score = Math.min(score, 70);
  if (input.riskLevel === "high") score = Math.min(score, 75);
  if (input.riskLevel === "moderate") score = Math.min(score, 75);
  if (input.disagreementType === "conditional_alignment") score = Math.min(score, 80);
  if (input.disagreementType === "material_conflict") score = Math.min(score, 60);

  const finalScore = Math.round(clamp(score, 0, 100));

  const agreementText =
    input.agreementLevel === "high"
      ? "Models strongly agree on the core conclusion"
      : input.agreementLevel === "medium"
      ? "Models partially align on the core conclusion"
      : "Models diverge on the core conclusion";

  const qualityText =
    input.averageQuality >= 8
      ? "provider output quality is strong"
      : input.averageQuality >= 6.5
      ? "provider output quality is solid"
      : "provider output quality is mixed";

  const disagreementText =
    input.disagreementType === "none"
      ? "with no meaningful disagreement"
      : input.disagreementType === "additive_nuance"
      ? "with only additive nuance"
      : input.disagreementType === "explanation_variation"
      ? "with variation in explanation"
      : input.disagreementType === "conditional_alignment"
      ? "with context-dependent conditional alignment"
      : "with material conflict between responses";

  const riskText =
    input.riskLevel === "low"
      ? "overall risk is low."
      : input.riskLevel === "moderate"
      ? "overall risk is moderate."
      : "overall risk is elevated.";

  const alignmentText = input.finalConclusionAligned
    ? "The original answers support the same main conclusion,"
    : "The original answers do not cleanly support the same main conclusion,";

  const reason = `${alignmentText} ${agreementText}, ${qualityText}, ${disagreementText}; ${riskText}`;

  return { score: finalScore, label: getTrustLabel(finalScore), reason };
}

function getConfidenceWeight(raw: unknown): number {
  if (!raw || typeof raw !== "object") return DEFAULT_WEIGHT;
  const r = raw as Record<string, unknown>;
  const totalRuns = typeof r.totalRuns === "number" ? r.totalRuns : 0;
  if (totalRuns < MINIMUM_SAMPLES_FOR_WEIGHTING) return DEFAULT_WEIGHT;
  const totalQuality =
    typeof r.totalQualityScore === "number" ? r.totalQualityScore : 0;
  const qualityRatings =
    typeof r.qualityRatings === "number" ? r.qualityRatings : 0;
  if (qualityRatings === 0) return DEFAULT_WEIGHT;
  const avgQuality = totalQuality / qualityRatings;
  return clamp(avgQuality / DEFAULT_QUALITY, 0.9, 1.1);
}

async function incrementAnalytic(key: string): Promise<void> {
  try {
    await redis.incr(`zorelan:analytics:${key}`);
  } catch {
    // non-fatal
  }
}

function shouldTriggerArbitration(input: {
  agreementLevel: AgreementLevel;
  likelyConflict: boolean;
  finalConclusionAligned?: boolean;
}): boolean {
  if (input.agreementLevel === "low") return true;
  if (input.agreementLevel === "medium" && input.likelyConflict) return true;
  if (
    input.agreementLevel === "medium" &&
    input.finalConclusionAligned === false
  ) {
    return true;
  }
  return false;
}

function getPairStrength(
  semantic: Awaited<ReturnType<typeof judgeSemanticAgreementOrFallback>>
): number {
  if (semantic.agreementLevel === "high") return 3;
  if (semantic.agreementLevel === "medium" && !semantic.likelyConflict) {
    return 2;
  }
  if (semantic.agreementLevel === "medium" && semantic.likelyConflict) {
    return 1;
  }
  return 0;
}

function logArbitrationDiagnostic(input: {
  prompt: string;
  taskType: string;
  initialPair: [ProviderName, ProviderName];
  thirdProvider: ProviderName | null;
  initialAgreementLevel: AgreementLevel;
  initialLikelyConflict: boolean;
  initialSemanticLabel: string;
  initialSemanticRationale: string;
  initialUsedFallback: boolean;
  arbitrationTriggered: boolean;
  arbitrationUsed: boolean;
  arbitrationProvider: ProviderName | null;
  winningPair: [ProviderName, ProviderName];
  pairStrengths: {
    initial: number;
    withAThird: number | null;
    withBThird: number | null;
  } | null;
}) {
  console.log(
    "[/api/decision] arbitration_diagnostic",
    JSON.stringify({
      prompt: input.prompt.slice(0, 100),
      task_type: input.taskType,
      initial_pair: input.initialPair,
      third_provider: input.thirdProvider,
      initial_agreement_level: input.initialAgreementLevel,
      initial_likely_conflict: input.initialLikelyConflict,
      initial_semantic_label: input.initialSemanticLabel,
      initial_semantic_rationale: input.initialSemanticRationale,
      initial_used_fallback: input.initialUsedFallback,
      arbitration_triggered: input.arbitrationTriggered,
      arbitration_used: input.arbitrationUsed,
      arbitration_provider: input.arbitrationProvider,
      winning_pair: input.winningPair,
      pair_strengths: input.pairStrengths,
    })
  );
}

async function evaluatePair(input: {
  prompt: string;
  providerA: ProviderName;
  providerB: ProviderName;
  answerA: string;
  answerB: string;
}): Promise<PairEvaluation> {
  const comparison = compareAnswers(input.answerA, input.answerB);
  const judgeProvider = selectJudgeForProviders(
    input.providerA,
    input.providerB
  );

  const semantic = await judgeSemanticAgreementOrFallback(
    { answerA: input.answerA, answerB: input.answerB, question: input.prompt },
    () => ({
      agreementLevel: comparison.agreementLevel,
      likelyConflict: comparison.likelyConflict,
    }),
    { judgeProvider }
  );

  return {
    providerA: input.providerA,
    providerB: input.providerB,
    answerA: input.answerA,
    answerB: input.answerB,
    comparison,
    semantic,
  };
}

async function scoreAnswerQuality(input: {
  answerA: string;
  answerB: string;
  providerA: ProviderName;
  providerB: ProviderName;
}): Promise<{ scoreA: number; scoreB: number }> {
  try {
    const prompt =
      `Rate these two AI responses from 1-10 for quality, accuracy, and usefulness. ` +
      `Return JSON only with no other text: {"scoreA": number, "scoreB": number}\n\n` +
      `Response A: ${input.answerA}\n\nResponse B: ${input.answerB}`;

    const response = await Promise.race([
      anthropic.messages.create({
        model: QUALITY_JUDGE_MODEL,
        max_tokens: 60,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("quality_timeout")),
          VERIFICATION_TIMEOUT_MS
        )
      ),
    ]);

    const raw =
      response.content[0]?.type === "text" ? response.content[0].text : "";
    const cleaned = stripCodeFences(raw);
    const parsed = JSON.parse(cleaned);

    return {
      scoreA:
        typeof parsed.scoreA === "number" ? clamp(parsed.scoreA, 1, 10) : 7,
      scoreB:
        typeof parsed.scoreB === "number" ? clamp(parsed.scoreB, 1, 10) : 7,
    };
  } catch (error) {
    console.error("[/api/decision] quality_error:", error);
    return { scoreA: 7, scoreB: 7 };
  }
}

async function buildDecisionVerdict(params: {
  prompt: string;
  answerA: string;
  answerB: string;
  weightA: number;
  weightB: number;
  agreementLevel: AgreementLevel;
  likelyConflict: boolean;
  verifiedAnswer: string;
}): Promise<VerdictPayload> {
  const fallback = inferFallbackClassification({
    agreementLevel: params.agreementLevel,
    likelyConflict: params.likelyConflict,
  });

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 260,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          'You are a decision-verification engine. Return JSON only with this exact shape: {"verdict":"string","keyDisagreement":"string","recommendedAction":"string","finalConclusionAligned":boolean,"disagreementType":"none|additive_nuance|explanation_variation|conditional_alignment|material_conflict"}. Judge alignment from the ORIGINAL model responses first. The verified synthesis can help summarize the situation, but it is not evidence that the original answers aligned. finalConclusionAligned should be true only when both responses support the same main conclusion. Use none when both responses reach the same conclusion and any additional detail is purely reinforcing. Use additive_nuance only when one response introduces conditions, tradeoffs, or qualifications that affect how or when the conclusion should be applied. Use explanation_variation only when both responses support the same conclusion but frame it in meaningfully different ways. Use conditional_alignment when both responses support the same primary recommendation but one adds meaningful caveats, conditions, or tradeoffs. Use material_conflict ONLY when the two responses give genuinely opposing primary recommendations where following one would contradict the other. Tradeoff answers that converge on context are aligned, not conflicted.',
      },
      {
        role: "user",
        content: [
          `Question: ${params.prompt}`,
          "",
          `Agreement level: ${params.agreementLevel}`,
          `Likely conflict: ${params.likelyConflict ? "yes" : "no"}`,
          "",
          `Response A (confidence: ${params.weightA.toFixed(2)}): ${params.answerA}`,
          "",
          `Response B (confidence: ${params.weightB.toFixed(2)}): ${params.answerB}`,
          "",
          `Verified synthesis: ${params.verifiedAnswer}`,
          "",
          "Do not treat a coherent merged synthesis as proof that the original answers truly agreed.",
        ].join("\n"),
      },
    ],
  });

  try {
    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(stripCodeFences(raw));

    const disagreementType: DisagreementType = isDisagreementType(
      parsed.disagreementType
    )
      ? parsed.disagreementType
      : fallback.disagreementType;

    const finalConclusionAligned =
      typeof parsed.finalConclusionAligned === "boolean"
        ? parsed.finalConclusionAligned
        : fallback.finalConclusionAligned;

    return {
      verdict:
        typeof parsed.verdict === "string" && parsed.verdict.trim()
          ? parsed.verdict.trim()
          : "Proceed based on the verified synthesis.",
      keyDisagreement:
        typeof parsed.keyDisagreement === "string" &&
        parsed.keyDisagreement.trim()
          ? parsed.keyDisagreement.trim()
          : disagreementType === "material_conflict"
          ? "The models differed on the main recommendation."
          : disagreementType === "conditional_alignment"
          ? "A usable answer depends on context, conditions, or tradeoffs."
          : "The models differed mainly in emphasis or supporting detail.",
      recommendedAction:
        typeof parsed.recommendedAction === "string" &&
        parsed.recommendedAction.trim()
          ? parsed.recommendedAction.trim()
          : disagreementType === "conditional_alignment"
          ? "Choose based on the conditions or tradeoffs that matter most in your context."
          : "Use the verified synthesis as the base answer, then apply it to your context.",
      finalConclusionAligned,
      disagreementType,
    };
  } catch {
    return {
      verdict: "Proceed based on the verified synthesis.",
      keyDisagreement:
        fallback.disagreementType === "material_conflict"
          ? "The models diverged on the strongest recommendation."
          : fallback.disagreementType === "conditional_alignment"
          ? "A usable answer depends on context, conditions, or tradeoffs."
          : "The models differed mainly in emphasis and execution details.",
      recommendedAction:
        fallback.disagreementType === "conditional_alignment"
          ? "Choose based on the conditions or tradeoffs that matter most in your context."
          : "Use the verified synthesis as the base answer, then validate it in context.",
      finalConclusionAligned: fallback.finalConclusionAligned,
      disagreementType: fallback.disagreementType,
    };
  }
}

function sseEvent(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function sseHeaders(): HeadersInit {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };
}

function streamCachedPayload(payload: unknown) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(sseEvent(event)));
      };

      try {
        const maybePayload = payload as
          | {
              answers?: Record<string, string>;
              selectedProviders?: ProviderName[];
            }
          | undefined;

        const selectedProviders = Array.isArray(maybePayload?.selectedProviders)
          ? (maybePayload?.selectedProviders.slice(0, 2) as [
              ProviderName,
              ProviderName,
            ])
          : undefined;

        if (selectedProviders && selectedProviders.length === 2) {
          send({
            type: "selected_providers",
            selectedProviders,
          });

          for (const provider of selectedProviders) {
            const answer =
              typeof maybePayload?.answers?.[provider] === "string"
                ? maybePayload.answers[provider]
                : "";

            send({
              type: "provider_answer",
              provider,
              answer,
              duration_ms: 0,
              timed_out: false,
              used_fallback: false,
              selectedProviders,
            });
          }
        }

        send({
          type: "final",
          payload,
        });

        controller.close();
      } catch {
        send({
          type: "error",
          error: "cached_stream_error",
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: sseHeaders(),
  });
}

export async function POST(req: NextRequest) {
  try {
    const token = extractBearerToken(req);
    if (!token) return unauthorized();

    const clientIp = getClientIp(req);

    if (ENABLE_API_RATE_LIMIT) {
      const ipLimitResult = await ipRateLimit.limit(`rl:ip:${clientIp}`);
      if (!ipLimitResult.success) {
        return rateLimitResponse("ip", ipLimitResult.reset);
      }
    }

    const isMasterKey = token === process.env.DECISION_API_KEY;

    let customerKeyMeta:
      | {
          plan: string;
          callsLimit: number;
          callsUsed: number;
          callsRemaining: number;
          status: "active" | "inactive";
        }
      | undefined;

    let parsedKeyRecord: ApiKeyRecord | null = null;

    if (!isMasterKey) {
      const rawKeyData = await redis.get(`apikey:${token}`);
      parsedKeyRecord = parseApiKeyRecord(rawKeyData);
      if (!parsedKeyRecord) return unauthorized();

      if (ENABLE_API_RATE_LIMIT) {
        const keyLimitResult = await apiKeyRateLimit.limit(
          `rl:key:${hashKey(token)}`
        );
        if (!keyLimitResult.success) {
          return rateLimitResponse("api_key", keyLimitResult.reset);
        }
      }

      const keyStatus = parsedKeyRecord.status ?? "active";
      if (keyStatus !== "active") {
        return NextResponse.json(
          { ok: false, error: "subscription_inactive" },
          { status: 403 }
        );
      }

      if (parsedKeyRecord.callsUsed >= parsedKeyRecord.callsLimit) {
        return NextResponse.json(
          {
            ok: false,
            error: "rate_limit_exceeded",
            plan: parsedKeyRecord.plan,
            calls_limit: parsedKeyRecord.callsLimit,
            calls_used: parsedKeyRecord.callsUsed,
            calls_remaining: 0,
            status: keyStatus,
          },
          { status: 429 }
        );
      }
    } else if (ENABLE_API_RATE_LIMIT) {
      const masterKeyLimitResult = await apiKeyRateLimit.limit(
        `rl:key:${hashKey(token)}`
      );
      if (!masterKeyLimitResult.success) {
        return rateLimitResponse("api_key", masterKeyLimitResult.reset);
      }
    }

    const body = await req.json().catch(() => null);
    const executionPrompt = body?.prompt;
    const rawPrompt =
      typeof body?.raw_prompt === "string" && body.raw_prompt.trim()
        ? body.raw_prompt.trim()
        : executionPrompt;
    const cacheBypass = body?.cache_bypass === true;
    const streamMode = body?.stream === true;

    if (!executionPrompt || typeof executionPrompt !== "string") {
      return badRequest("missing_prompt");
    }
    if (executionPrompt.length > MAX_PROMPT_CHARS) {
      return badRequest("prompt_too_large");
    }
    if (!rawPrompt || typeof rawPrompt !== "string") {
      return badRequest("missing_prompt");
    }
    if (rawPrompt.length > MAX_PROMPT_CHARS) {
      return badRequest("prompt_too_large");
    }

    if (!isMasterKey && parsedKeyRecord) {
      const keyStatus = parsedKeyRecord.status ?? "active";
      const updatedKeyData: ApiKeyRecord = {
        ...parsedKeyRecord,
        status: keyStatus,
        callsUsed: parsedKeyRecord.callsUsed + 1,
      };
      await redis.set(`apikey:${token}`, JSON.stringify(updatedKeyData));

      customerKeyMeta = {
        plan: updatedKeyData.plan,
        callsLimit: updatedKeyData.callsLimit,
        callsUsed: updatedKeyData.callsUsed,
        callsRemaining: Math.max(
          0,
          updatedKeyData.callsLimit - updatedKeyData.callsUsed
        ),
        status: updatedKeyData.status ?? "active",
      };
    }

    const taskType = detectTaskType(rawPrompt);

    const initialPromptClassification = classifyPrompt(rawPrompt);
    const lowerPrompt = rawPrompt.toLowerCase();

    const isHttpsBestPractice =
      lowerPrompt.includes("https") ||
      lowerPrompt.includes("should i use https") ||
      lowerPrompt.includes("ssl") ||
      lowerPrompt.includes("tls");

    // "How many/how often/how [attribute]" prompts are stable factual questions
    // that isFactPrompt misses because it anchors to sentence-initial "how does".
    // Guard on domain === "unknown" so this never fires for prompts that already
    // classified into a high-stakes domain (financial, medical, legal, tradeoff, etc.).
    const isUnclassifiedQuantityFact =
      initialPromptClassification.domain === "unknown" &&
      /^how (many|often|long|far|deep|fast|old|tall|big|large|small|heavy|much|wide|hot|cold|thick|high)\b/.test(lowerPrompt);

    const promptClassification = isHttpsBestPractice
      ? {
          ...initialPromptClassification,
          risk: "low" as const,
        }
      : isUnclassifiedQuantityFact
      ? {
          ...initialPromptClassification,
          domain: "fact" as const,
          risk: "low" as const,
        }
      : initialPromptClassification;

    console.log(
      "[/api/decision] prompt_split",
      JSON.stringify({
        raw_prompt_preview: rawPrompt.slice(0, 120),
        execution_prompt_preview: executionPrompt.slice(0, 120),
        raw_prompt_chars: rawPrompt.length,
        execution_prompt_chars: executionPrompt.length,
      })
    );

    console.log(
      "[/api/decision] prompt_classification",
      JSON.stringify({
        domain: promptClassification.domain,
        drivers: promptClassification.drivers,
        stakes: promptClassification.stakes,
        risk: promptClassification.risk,
        reasons: promptClassification.reasons,
      })
    );

    const { selectedProviders, rankedProviders } =
      await adaptiveSelectProviders(rawPrompt, taskType);

    const limitedProviders = selectedProviders.slice(
      0,
      MAX_PROVIDERS
    ) as ProviderName[];

    if (limitedProviders.length < 2) {
      return NextResponse.json(
        { ok: false, error: "provider_selection_failed" },
        { status: 500 }
      );
    }

    const [providerA, providerB] = limitedProviders;

    void incrementAnalytic("arbitration:total");

    const cacheKey = generateCacheKey(rawPrompt, limitedProviders);

    try {
      const cached = !cacheBypass ? await redis.get(cacheKey) : null;
      if (cached) {
        const cachedPayload =
          typeof cached === "string" ? JSON.parse(cached) : cached;

        if (cachedPayload && typeof cachedPayload === "object") {
          (cachedPayload as Record<string, unknown>).usage =
            customerKeyMeta ?? null;
          (cachedPayload as Record<string, unknown>).cached = true;

          console.log("[/api/decision] cache_hit", { cacheKey });

          if (streamMode) {
            return streamCachedPayload(cachedPayload);
          }

          return NextResponse.json(cachedPayload);
        }
      }
    } catch (cacheErr) {
      console.warn("[/api/decision] cache_lookup_error:", cacheErr);
    }

    const [rawScoreA, rawScoreB] = await Promise.all([
      redis.get(`zorelan:score:v2:${taskType}:${providerA}`),
      redis.get(`zorelan:score:v2:${taskType}:${providerB}`),
    ]);

    let weightA = getConfidenceWeight(rawScoreA);
    let weightB = getConfidenceWeight(rawScoreB);

    const providerMap: Record<ProviderName, ProviderRunner> = {
      openai: runOpenAI,
      anthropic: runAnthropic,
      perplexity: runPerplexity,
    };

    const executionMap: Partial<Record<ProviderName, ProviderExecution>> = {};

    const runProvider = (
  provider: ProviderName,
  options?: ProviderStreamOptions
) =>
  withTimeout(
    (signal) => providerMap[provider](executionPrompt, signal, options),
    TIMEOUT_MS,
    `${provider} timed out.`
  );

    const savePayloadToCache = async (
      validatedPayload: z.infer<typeof DecisionResponseSchema>
    ) => {
      try {
        const { usage: _usage, ...payloadWithoutUsage } = validatedPayload;
        await redis.set(cacheKey, JSON.stringify(payloadWithoutUsage), {
          ex: CACHE_TTL_SECONDS,
        });
        console.log("[/api/decision] cache_write", { cacheKey });
      } catch (cacheErr) {
        console.warn("[/api/decision] cache_write_error:", cacheErr);
      }
    };

    const buildValidatedResponse = async (): Promise<
      z.infer<typeof DecisionResponseSchema>
    > => {
      const initialPair = await evaluatePair({
        prompt: rawPrompt,
        providerA,
        providerB,
        answerA: executionMap[providerA]!.answer,
        answerB: executionMap[providerB]!.answer,
      });

      let activePair = initialPair;
      let arbitrationUsed = false;
      let arbitrationProvider: ProviderName | null = null;
      let arbitrationPairStrengths: {
        initial: number;
        withAThird: number | null;
        withBThird: number | null;
      } | null = null;

      const thirdProvider = rankedProviders.find(
        (provider) => !limitedProviders.includes(provider)
      );

      const initialFallbackClassification = inferFallbackClassification({
        agreementLevel: initialPair.semantic.agreementLevel,
        likelyConflict: initialPair.semantic.likelyConflict,
      });

      const arbitrationTriggered =
        !!thirdProvider &&
        shouldTriggerArbitration({
          agreementLevel: initialPair.semantic.agreementLevel,
          likelyConflict: initialPair.semantic.likelyConflict,
          finalConclusionAligned:
            initialFallbackClassification.finalConclusionAligned,
        });

      if (arbitrationTriggered && thirdProvider) {
        void incrementAnalytic("arbitration:triggered");

        const thirdResult = await runProvider(thirdProvider);

        executionMap[thirdProvider] = {
          provider: thirdProvider,
          answer: thirdResult.value,
          durationMs: thirdResult.durationMs,
          timedOut: thirdResult.timedOut,
          usedFallback: thirdResult.usedFallback,
        };

        await updateProviderScore({
          taskType,
          provider: thirdProvider,
          durationMs: thirdResult.durationMs,
          timedOut: thirdResult.timedOut,
          usedFallback: thirdResult.usedFallback,
        });

        const [pairWithAThird, pairWithBThird] = await Promise.all([
          evaluatePair({
            prompt: rawPrompt,
            providerA,
            providerB: thirdProvider,
            answerA: executionMap[providerA]!.answer,
            answerB: executionMap[thirdProvider]!.answer,
          }),
          evaluatePair({
            prompt: rawPrompt,
            providerA: providerB,
            providerB: thirdProvider,
            answerA: executionMap[providerB]!.answer,
            answerB: executionMap[thirdProvider]!.answer,
          }),
        ]);

        const initialStrength = getPairStrength(initialPair.semantic);
        const aThirdStrength = getPairStrength(pairWithAThird.semantic);
        const bThirdStrength = getPairStrength(pairWithBThird.semantic);

        arbitrationPairStrengths = {
          initial: initialStrength,
          withAThird: aThirdStrength,
          withBThird: bThirdStrength,
        };

        if (
          aThirdStrength > initialStrength ||
          bThirdStrength > initialStrength
        ) {
          arbitrationUsed = true;
          arbitrationProvider = thirdProvider;
          void incrementAnalytic("arbitration:changed");

          if (aThirdStrength > bThirdStrength) {
            activePair = pairWithAThird;
          } else if (bThirdStrength > aThirdStrength) {
            activePair = pairWithBThird;
          } else if (aThirdStrength >= initialStrength) {
            const prefersPairWithA =
              pairWithAThird.semantic.agreementLevel === "high" &&
              pairWithBThird.semantic.agreementLevel !== "high";
            activePair = prefersPairWithA ? pairWithAThird : pairWithBThird;
          }
        }

        if (arbitrationUsed) {
          const [rawScoreActivePairA, rawScoreActivePairB] = await Promise.all([
            redis.get(`zorelan:score:v2:${taskType}:${activePair.providerA}`),
            redis.get(`zorelan:score:v2:${taskType}:${activePair.providerB}`),
          ]);
          weightA = getConfidenceWeight(rawScoreActivePairA);
          weightB = getConfidenceWeight(rawScoreActivePairB);
        }
      }

      if (arbitrationPairStrengths !== null && !arbitrationUsed) {
        void incrementAnalytic("arbitration:confirmed");
      }

      logArbitrationDiagnostic({
        prompt: rawPrompt,
        taskType,
        initialPair: [initialPair.providerA, initialPair.providerB],
        thirdProvider: thirdProvider ?? null,
        initialAgreementLevel: initialPair.semantic.agreementLevel,
        initialLikelyConflict: initialPair.semantic.likelyConflict,
        initialSemanticLabel: initialPair.semantic.label,
        initialSemanticRationale: initialPair.semantic.rationale,
        initialUsedFallback: initialPair.semantic.usedFallback,
        arbitrationTriggered,
        arbitrationUsed,
        arbitrationProvider,
        winningPair: [activePair.providerA, activePair.providerB],
        pairStrengths: arbitrationPairStrengths,
      });

      const synthesisCompletion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 400,
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content:
              "You are a synthesis engine. Combine the two AI responses into one superior final answer. " +
              "Be concise and direct. Preserve important caveats and tradeoffs. " +
              "Do not mention that you are combining two answers. " +
              "Each response carries a confidence score (1.0 = baseline, >1.0 = historically stronger on this task type). " +
              "When responses differ, consider this as a secondary weighting signal, but prioritise the quality, accuracy, and relevance of the current responses.",
          },
          {
            role: "user",
            content: [
              `Question: ${executionPrompt}`,
              "",
              `Response A (${activePair.providerA}, confidence: ${weightA.toFixed(2)}): ${activePair.answerA}`,
              "",
              `Response B (${activePair.providerB}, confidence: ${weightB.toFixed(2)}): ${activePair.answerB}`,
            ].join("\n"),
          },
        ],
      });

      const verifiedAnswerRaw = stripCodeFences(
        synthesisCompletion.choices[0]?.message?.content ?? ""
      );
      const verifiedAnswer = cleanEncoding(verifiedAnswerRaw);

      const [verdictPayloadRaw, qualityScores] = await Promise.all([
        buildDecisionVerdict({
          prompt: rawPrompt,
          answerA: activePair.answerA,
          answerB: activePair.answerB,
          weightA,
          weightB,
          agreementLevel: activePair.semantic.agreementLevel,
          likelyConflict: activePair.semantic.likelyConflict,
          verifiedAnswer,
        }),
        scoreAnswerQuality({
          answerA: activePair.answerA,
          answerB: activePair.answerB,
          providerA: activePair.providerA,
          providerB: activePair.providerB,
        }),
      ]);

      const verdictPayload = normalizeVerdictWithSemantic({
        semanticAgreementLevel: activePair.semantic.agreementLevel,
        semanticLikelyConflict: activePair.semantic.likelyConflict,
        verdictPayload: verdictPayloadRaw,
        promptClassification,
      });

      if (
        verdictPayload.finalConclusionAligned &&
        (verdictPayload.disagreementType === "none" ||
          verdictPayload.disagreementType === "additive_nuance" ||
          verdictPayload.disagreementType === "explanation_variation")
      ) {
        verdictPayload.verdict = "Models are aligned on the main conclusion";

        if (verdictPayload.disagreementType === "none") {
          verdictPayload.keyDisagreement = "No meaningful disagreement";
        } else if (verdictPayload.disagreementType === "additive_nuance") {
          verdictPayload.keyDisagreement =
            "Minor differences in supporting detail";
        } else {
          verdictPayload.keyDisagreement = "Different framing or emphasis";
        }
      }

      await Promise.all([
        updateProviderQualityScore({
          taskType,
          provider: activePair.providerA,
          qualityScore: qualityScores.scoreA,
        }),
        updateProviderQualityScore({
          taskType,
          provider: activePair.providerB,
          qualityScore: qualityScores.scoreB,
        }),
      ]);

      const invokedProviders = Object.keys(executionMap) as ProviderName[];
      const consensusProviderCount = arbitrationUsed
        ? invokedProviders.length
        : limitedProviders.length;

      // "additive_nuance" and "explanation_variation" are harmless framing
      // differences on aligned outputs and should not suppress agreement level
      // to "medium" or trigger the medium cap (≤74) on trust. Treat them the
      // same as "none" when the prompt is low-risk, models are aligned, and no
      // genuine conflict was detected. For correctly classified fact/best_practice
      // prompts the normalizer already forces disagreementType to "none" before
      // this point — this is belt-and-suspenders for any variant that exits
      // normalisation with a harmless type still set.
      const harmlessDisagreementType =
        verdictPayload.disagreementType === "none" ||
        verdictPayload.disagreementType === "additive_nuance" ||
        verdictPayload.disagreementType === "explanation_variation";

      // Truth / controversy classification — two-layer pipeline:
      //   V1 (deterministic) runs first as the baseline.
      //   V2 (semantic / model-based) refines the result using provider answers.
      //   Merged result controls SAFE eligibility and trust caps.
      const deterministicTruthClass = classifyTruthRisk(rawPrompt, promptClassification);
      console.log("[/api/decision] truth_classification_v1", JSON.stringify(deterministicTruthClass));

      const v2TruthClass = await classifyTruthRiskV2({
        prompt: rawPrompt,
        answers: [
          { provider: activePair.providerA, text: activePair.answerA },
          { provider: activePair.providerB, text: activePair.answerB },
        ],
        promptClassification,
        fallback: deterministicTruthClass,
      });
      console.log("[/api/decision] truth_classification_v2", JSON.stringify(v2TruthClass));

      const truthClass = mergeTruthClassifications({
        deterministic: deterministicTruthClass,
        v2: v2TruthClass,
        promptClassification,
        semanticAgreementLevel: activePair.semantic.agreementLevel,
        likelyConflict: activePair.semantic.likelyConflict,
      });
      console.log(
        "[/api/decision] truth_classification_final",
        JSON.stringify({
          classification: truthClass.classification,
          source: truthClass.source,
          upgraded: deterministicTruthClass.classification !== truthClass.classification,
        })
      );

      // Single source of truth for low-risk factual calibration.
      // Agreement level (A), trust floor (B), and final decision (C)
      // all derive from this one flag so they cannot drift out of sync.
      const isLowRiskFactualSafe =
        truthClass.classification === "FACTUAL_STABLE" &&
        (promptClassification.domain === "fact" ||
          promptClassification.domain === "best_practice") &&
        promptClassification.risk === "low" &&
        verdictPayload.finalConclusionAligned &&
        harmlessDisagreementType &&
        activePair.semantic.agreementLevel !== "low" &&
        !activePair.semantic.likelyConflict;

      // Second safe-lane for low-risk informational/explanatory prompts.
      // Broader than the factual lane — does not require fact/best_practice domain —
      // but requires HIGH (not just non-low) semantic agreement and explicitly
      // excludes all high-stakes and speculative domains.
      const isLowRiskInformationalSafe =
        truthClass.classification === "FACTUAL_STABLE" &&
        (promptClassification.risk === "low" ||
          (promptClassification.risk === "moderate" &&
            promptClassification.stakes === "low" &&
            promptClassification.domain === "unknown" &&
            promptClassification.drivers.length === 0)) &&
        verdictPayload.finalConclusionAligned &&
        harmlessDisagreementType &&
        (activePair.semantic.agreementLevel === "high" ||
          activePair.semantic.agreementLevel === "medium") &&
        !activePair.semantic.likelyConflict &&
        promptClassification.domain !== "tradeoff" &&
        promptClassification.domain !== "prediction" &&
        promptClassification.domain !== "financial" &&
        promptClassification.domain !== "medical" &&
        promptClassification.domain !== "legal" &&
        promptClassification.domain !== "security";

      // A. Agreement normalization: factual safe-lane always scores as high agreement.
      const effectiveAgreementLevel: AgreementLevel = isLowRiskFactualSafe
        ? "high"
        : activePair.semantic.agreementLevel;

      const modelsAligned = getModelsAligned({
        totalProviders: consensusProviderCount,
        agreementLevel: effectiveAgreementLevel,
        finalConclusionAligned: verdictPayload.finalConclusionAligned,
        disagreementType: verdictPayload.disagreementType,
      });

      const consensusLevel = getConsensusLevelFromAligned(
        modelsAligned,
        consensusProviderCount
      );

      const riskLevel = getRiskLevel({
        prompt: rawPrompt,
        agreementLevel: effectiveAgreementLevel,
        disagreementType: verdictPayload.disagreementType,
        finalConclusionAligned: verdictPayload.finalConclusionAligned,
        promptClassification,
      });

      const averageQuality = (qualityScores.scoreA + qualityScores.scoreB) / 2;

      const rawTrustScore = calculateTrustScore({
        prompt: rawPrompt,
        agreementLevel: effectiveAgreementLevel,
        disagreementType: verdictPayload.disagreementType,
        finalConclusionAligned: verdictPayload.finalConclusionAligned,
        averageQuality,
        riskLevel,
        promptClassification,
      });

      // B. Trust floors: factual safe-lane ≥92, informational safe-lane ≥88.
      // Checked in priority order so the tighter floor wins when both are true.
      // Truth classification caps are applied last so floors cannot override
      // safety signals on controversial or misinformation prompts.
      const trustScore = (() => {
        let s = rawTrustScore;
        if (isLowRiskFactualSafe && s.score < 92) {
          s = { ...s, score: 92, label: "high" as const };
        } else if (isLowRiskInformationalSafe && s.score < 88) {
          s = { ...s, score: 88, label: "high" as const };
        }
        if (truthClass.classification === "MISINFORMATION_PATTERN") {
          const capped = Math.min(s.score, 30);
          s = { ...s, score: capped, label: getTrustLabel(capped) };
        } else if (truthClass.classification === "CONTROVERSIAL") {
          const capped = Math.min(s.score, 60);
          s = { ...s, score: capped, label: getTrustLabel(capped) };
        } else if (truthClass.classification === "FACTUAL_UNCERTAIN") {
          const capped = Math.min(s.score, 74);
          s = { ...s, score: capped, label: getTrustLabel(capped) };
        }
        return s;
      })();

      // C. Decision: factual lane first, informational lane second, normal logic last.
      const { decision, decision_reason } = isLowRiskFactualSafe
        ? {
            decision: "allow" as const,
            decision_reason:
              "Factual prompt with low risk, aligned models, and no meaningful disagreement. Safe to execute.",
          }
        : isLowRiskInformationalSafe
        ? {
            decision: "allow" as const,
            decision_reason:
              "Low-risk informational prompt with aligned models and no meaningful disagreement. Safe to execute.",
          }
        : deriveDecision({
            domain: promptClassification.domain,
            risk: promptClassification.risk,
            disagreementType: verdictPayload.disagreementType,
            finalConclusionAligned: verdictPayload.finalConclusionAligned,
            trustScore: trustScore.score,
          });

      const responsePayload = {
        ok: true as const,
        verdict: verdictPayload.verdict,
        consensus: {
          level: consensusLevel,
          models_aligned: modelsAligned,
        },
        risk_level: riskLevel,
        key_disagreement: verdictPayload.keyDisagreement,
        recommended_action: verdictPayload.recommendedAction,
        analysis: verifiedAnswer,
        verified_answer: verifiedAnswer,
        confidence: (() => {
          if (riskLevel === "high") return "low" as AgreementLevel;
          if (riskLevel === "moderate" && consensusLevel === "high") {
            return "medium" as AgreementLevel;
          }
          return consensusLevel;
        })(),
        confidence_reason: getConfidenceReason({
          agreementLevel: activePair.semantic.agreementLevel,
          disagreementType: verdictPayload.disagreementType,
          finalConclusionAligned: verdictPayload.finalConclusionAligned,
        }),
        trust_score: {
          score: trustScore.score,
          label: trustScore.label,
          reason: trustScore.reason,
        },
        decision,
        decision_reason,
        answers: {
          openai: cleanEncoding(
            activePair.providerA === "openai"
              ? activePair.answerA
              : activePair.providerB === "openai"
              ? activePair.answerB
              : ""
          ),
          anthropic: cleanEncoding(
            activePair.providerA === "anthropic"
              ? activePair.answerA
              : activePair.providerB === "anthropic"
              ? activePair.answerB
              : ""
          ),
          perplexity: cleanEncoding(
            activePair.providerA === "perplexity"
              ? activePair.answerA
              : activePair.providerB === "perplexity"
              ? activePair.answerB
              : ""
          ),
        },
        selectedProviders: [activePair.providerA, activePair.providerB] as [
          ProviderName,
          ProviderName,
        ],
        providers_used: invokedProviders,
        verification: {
          final_conclusion_aligned: verdictPayload.finalConclusionAligned,
          disagreement_type: verdictPayload.disagreementType,
          semantic_label: activePair.semantic.label,
          semantic_rationale: activePair.semantic.rationale,
          semantic_judge_model: activePair.semantic.judgeModel,
          semantic_used_fallback: activePair.semantic.usedFallback,
        },
        arbitration: {
          used: arbitrationUsed,
          provider: arbitrationProvider,
          winning_pair: [activePair.providerA, activePair.providerB],
          pair_strengths: arbitrationPairStrengths,
        },
        model_diagnostics: Object.fromEntries(
          invokedProviders.map((provider) => [
            provider,
            {
              quality_score:
                provider === activePair.providerA
                  ? qualityScores.scoreA
                  : provider === activePair.providerB
                  ? qualityScores.scoreB
                  : null,
              duration_ms: executionMap[provider]!.durationMs,
              timed_out: executionMap[provider]!.timedOut,
              used_fallback: executionMap[provider]!.usedFallback,
            },
          ])
        ),
        meta: {
          task_type: taskType,
          overlap_ratio: activePair.comparison.overlapRatio,
          agreement_summary: activePair.comparison.summary,
          prompt_chars: rawPrompt.length,
          execution_prompt_chars: executionPrompt.length,
          likely_conflict: activePair.semantic.likelyConflict,
          disagreement_type: verdictPayload.disagreementType,
          initial_pair: [initialPair.providerA, initialPair.providerB],
        },
        usage: customerKeyMeta ?? null,
        cached: false,
      };

      const validation = DecisionResponseSchema.safeParse(responsePayload);

      if (!validation.success) {
        console.error(
          "[/api/decision] response_validation_failed:",
          JSON.stringify(validation.error.issues)
        );
        throw new Error("response_validation_failed");
      }

      await savePayloadToCache(validation.data);
      return validation.data;
    };

    if (streamMode) {
      const encoder = new TextEncoder();

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (event: unknown) => {
            controller.enqueue(encoder.encode(sseEvent(event)));
          };

          try {
            send({
              type: "selected_providers",
              selectedProviders: [providerA, providerB],
            });

            const pending = new Map<
  ProviderName,
  Promise<WithTimeoutResult<string>>
>([
  [
    providerA,
    runProvider(providerA, {
      onDelta: (delta) => {
        const cleaned = cleanEncoding(delta);
        if (!cleaned) return;

        send({
          type: "provider_delta",
          provider: providerA,
          delta: cleaned,
        });
      },
    }),
  ],
  [
    providerB,
    runProvider(providerB, {
      onDelta: (delta) => {
        const cleaned = cleanEncoding(delta);
        if (!cleaned) return;

        send({
          type: "provider_delta",
          provider: providerB,
          delta: cleaned,
        });
      },
    }),
  ],
]);

            while (pending.size > 0) {
              const tagged = Array.from(pending.entries()).map(
                ([provider, promise]) =>
                  promise.then((result) => ({ provider, result }))
              );

              const settled = await Promise.race(tagged);
              pending.delete(settled.provider);

              const { provider, result } = settled;

              executionMap[provider] = {
                provider,
                answer: result.value,
                durationMs: result.durationMs,
                timedOut: result.timedOut,
                usedFallback: result.usedFallback,
              };

              await updateProviderScore({
                taskType,
                provider,
                durationMs: result.durationMs,
                timedOut: result.timedOut,
                usedFallback: result.usedFallback,
              });

              send({
                type: "provider_answer",
                provider,
                answer: cleanEncoding(result.value),
                duration_ms: result.durationMs,
                timed_out: result.timedOut,
                used_fallback: result.usedFallback,
                selectedProviders: [providerA, providerB],
              });
            }

            const finalPayload = await buildValidatedResponse();

            send({
              type: "final",
              payload: finalPayload,
            });

            controller.close();
          } catch (err) {
            console.error("[/api/decision] stream_error:", err);

            const message =
              err instanceof Error && err.message === "response_validation_failed"
                ? "response_validation_failed"
                : "internal_error";

            send({
              type: "error",
              error: message,
            });

            controller.close();
          }
        },
      });

      return new Response(stream, {
        status: 200,
        headers: sseHeaders(),
      });
    }

    const [resultA, resultB] = await Promise.all([
      runProvider(providerA),
      runProvider(providerB),
    ]);

    executionMap[providerA] = {
      provider: providerA,
      answer: resultA.value,
      durationMs: resultA.durationMs,
      timedOut: resultA.timedOut,
      usedFallback: resultA.usedFallback,
    };

    executionMap[providerB] = {
      provider: providerB,
      answer: resultB.value,
      durationMs: resultB.durationMs,
      timedOut: resultB.timedOut,
      usedFallback: resultB.usedFallback,
    };

    await Promise.all([
      updateProviderScore({
        taskType,
        provider: providerA,
        durationMs: resultA.durationMs,
        timedOut: resultA.timedOut,
        usedFallback: resultA.usedFallback,
      }),
      updateProviderScore({
        taskType,
        provider: providerB,
        durationMs: resultB.durationMs,
        timedOut: resultB.timedOut,
        usedFallback: resultB.usedFallback,
      }),
    ]);

    const finalPayload = await buildValidatedResponse();
    return NextResponse.json(finalPayload);
  } catch (err) {
    console.error("[/api/decision] error:", err);
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 }
    );
  }
}