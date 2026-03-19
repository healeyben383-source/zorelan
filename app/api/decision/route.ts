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
const CACHE_VERSION = "v2-calibration-2026-03-19";

const QUALITY_JUDGE_MODEL = "claude-haiku-4-5-20251001";

const ENABLE_API_RATE_LIMIT = process.env.ENABLE_API_RATE_LIMIT === "true";

// ── Confidence weighting constants ────────────────────────────────────────────
// Threshold is 20 rather than 10 — early over-learning is a bigger risk than
// slow learning for a system where miscalibrated weights affect verdict quality.
// DEFAULT_QUALITY of 7.0 is a starting calibration point, not a fixed truth —
// revisit after a real prompt-set review once data has accumulated.
const MINIMUM_SAMPLES_FOR_WEIGHTING = 20;
const DEFAULT_WEIGHT = 1.0;
const DEFAULT_QUALITY = 7.0;
// ─────────────────────────────────────────────────────────────────────────────

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

type ProviderRunner = (
  prompt: string,
  signal?: AbortSignal
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

// ─── Zod output schemas ───────────────────────────────────────────────────────

const AgreementLevelSchema = z.enum(["high", "medium", "low"]);
const RiskLevelSchema = z.enum(["low", "moderate", "high"]);
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

// ─────────────────────────────────────────────────────────────────────────────

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
}): VerdictPayload {
  const normalized: VerdictPayload = { ...input.verdictPayload };

  if (input.semanticAgreementLevel === "high") {
  // Semantic judge is authoritative for alignment
  normalized.finalConclusionAligned = true;

  // Prevent over-penalisation from verdict LLM
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
      // Even if the verdict engine classified disagreement as minor, the
      // semantic judge's agreement level is the more reliable signal.
      // If the judge said medium, consensus should not report high.
      if (input.agreementLevel === "low") return 0;
      if (input.agreementLevel === "medium")
        return Math.max(1, input.totalProviders - 1);
      return input.totalProviders;
    case "conditional_alignment":
      return Math.max(1, input.totalProviders - 1);
    case "material_conflict":
      return 0;
    default:
      if (input.finalConclusionAligned) return input.totalProviders;
      if (input.agreementLevel === "medium")
        return Math.max(1, input.totalProviders - 1);
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

/**
 * Detects whether a prompt is inherently uncertain — i.e. a tradeoff decision,
 * speculative forecast, or investment question — where high provider agreement
 * does not mean the answer is objectively certain.
 *
 * Deliberately narrow: "should I use HTTPS?" does NOT trigger this because
 * there is no genuine tradeoff. Only fires on explicit tradeoff structure,
 * speculative/investment language, or startup choice signals.
 */

// ONLY showing modified sections clearly — everything else remains EXACTLY the same

// ─────────────────────────────────────────────────────────────────────────────

function getRiskLevel(input: {
  prompt: string;
  agreementLevel: AgreementLevel;
  disagreementType: DisagreementType;
  finalConclusionAligned: boolean;
  promptClassification: PromptClassification;
}): RiskLevel {
  const { risk: classifiedRisk } = input.promptClassification;
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

  if (input.disagreementType === "material_conflict") return "high";

  // Full alignment with no meaningful disagreement should be low risk
  // before prompt-classification floors are applied.
  const isFactualLike =
  input.promptClassification.risk === "low";

if (
  isFactualLike &&
  input.finalConclusionAligned &&
  (input.disagreementType === "none" ||
    input.disagreementType === "additive_nuance" ||
    input.disagreementType === "explanation_variation")
) {
  return "low";
}

  if (input.disagreementType === "conditional_alignment") {
    if (classifiedRisk === "high") return "high";
    return "moderate";
  }

  if (!input.finalConclusionAligned && input.agreementLevel === "low") {
    return "high";
  }

  if (classifiedRisk === "high") return "high";
  if (classifiedRisk === "moderate") return "moderate";

  // Explicit tradeoff prompts should never be treated as low-risk certainty
  if (explicitTradeoff) return "moderate";

  return "low";
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

// ─────────────────────────────────────────────────────────────────────────────
// 🔁 MODIFY calculateTrustScore (ONLY THIS SECTION CHANGES)
// ─────────────────────────────────────────────────────────────────────────────

function calculateTrustScore(input: {
  agreementLevel: AgreementLevel;
  disagreementType: DisagreementType;
  finalConclusionAligned: boolean;
  averageQuality: number;
  riskLevel: RiskLevel;
  prompt: string;
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

  if (input.disagreementType === "explanation_variation") score -= 4;
  else if (input.disagreementType === "conditional_alignment") score -= 12;
  else if (input.disagreementType === "material_conflict") score -= 20;

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

  // Only factual-style certainty gets the 95 floor.
  if (
    input.disagreementType === "none" &&
    input.agreementLevel === "high" &&
    input.riskLevel === "low" &&
    !explicitTradeoff &&
    !speculativeHighRisk
  ) {
    score = Math.max(score, 95);
  }

  // Tradeoff / choice prompts should not score like objective facts
  if (explicitTradeoff) {
    score = Math.min(score, 90);
  }

  // Speculative financial questions should never receive factual-grade trust
  if (speculativeHighRisk || input.riskLevel === "high") {
    score = Math.min(score, 70);
  }

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

// ── Confidence weighting ──────────────────────────────────────────────────────

/**
 * Derives a confidence weight for a provider from its raw Redis score record.
 *
 * Raw weight = avgQuality / DEFAULT_QUALITY, normalised around 7.0.
 * Final weight is clamped to keep the signal light:
 *   0.9 ≤ weight ≤ 1.1
 *
 * Returns DEFAULT_WEIGHT (1.0) when:
 *   - no score record exists
 *   - totalRuns < MINIMUM_SAMPLES_FOR_WEIGHTING (avoids miscalibrated early weights)
 *   - qualityRatings is 0 (no quality data yet)
 */
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
  // Clamped to ±10% of baseline — keeps this as a nudge, not a steering wheel.
  // A provider scoring 9.3 avg gets weight 1.10, not 1.33.
  return clamp(avgQuality / DEFAULT_QUALITY, 0.9, 1.1);
}

// ─────────────────────────────────────────────────────────────────────────────

async function incrementAnalytic(key: string): Promise<void> {
  try {
    await redis.incr(`zorelan:analytics:${key}`);
  } catch {
    // Analytics errors are non-fatal
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
  if (semantic.agreementLevel === "medium" && !semantic.likelyConflict)
    return 2;
  if (semantic.agreementLevel === "medium" && semantic.likelyConflict) return 1;
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
          'You are a decision-verification engine. Return JSON only with this exact shape: {"verdict":"string","keyDisagreement":"string","recommendedAction":"string","finalConclusionAligned":boolean,"disagreementType":"none|additive_nuance|explanation_variation|conditional_alignment|material_conflict"}. Judge alignment from the ORIGINAL model responses first. The verified synthesis can help summarize the situation, but it is not evidence that the original answers aligned. finalConclusionAligned should be true only when both responses support the same main conclusion. Use none when both responses reach the same conclusion and any additional detail is purely reinforcing — extra facts, examples, or context that strengthen rather than qualify the conclusion. This includes cases where one response provides more scientific, technical, or contextual detail than the other — detail difference alone is never grounds for explanation_variation or additive_nuance. When both responses describe the same core physical, biological, or factual outcome but differ in emphasis — for example, one focusing on rapid harm and another on a brief survivability window — treat these as none or additive_nuance, not as disagreement. Descriptions of different time horizons or severity framings within the same factual event are complementary, not contradictory. Use additive_nuance only when one response introduces conditions, tradeoffs, or qualifications that are absent from the other and that affect how or when the conclusion should be applied. Use explanation_variation only when both responses support the same conclusion but frame it in meaningfully different ways that could lead a reader to apply it differently. Use explanation_variation when both responses support the same conclusion but differ in framing, emphasis, or supporting reasoning. Use conditional_alignment when both responses support the same primary recommendation but one adds meaningful caveats, conditions, or tradeoffs that qualify when or how to apply it — this is NOT material_conflict. Use material_conflict ONLY when the two responses give genuinely opposing primary recommendations where following one would contradict the other — for example, one says "always use X" and the other says "use Y instead". A softened or qualified version of the same recommendation is never material_conflict. If one response says "use X" and the other says "use X in most cases, but Y may work under specific conditions", that is conditional_alignment, not material_conflict. If both responses recommend the same main action, material_conflict is usually incorrect. When responses share the same strategic direction — for example, both recommend caution, diversification, limited exposure, or a conditional approach — but differ only in specific parameters such as percentages, timing, thresholds, or emphasis, do NOT classify as material_conflict. Treat these as explanation_variation or additive_nuance. material_conflict requires fundamentally opposed recommendations where following one would contradict the other, not merely different calibrations of the same recommendation. When both responses present conditional recommendations that follow the same decision logic — for example, both say "use A for structured data, use B for flexible data" or "choose X for this context, Y for that context" — treat this as agreement (none or additive_nuance), not disagreement. Tradeoff answers that converge on "it depends on context" are aligned, not conflicted. Each response carries a confidence score (1.0 = baseline, >1.0 = historically stronger on this task type). Treat this as a light secondary signal, not as a substitute for evaluating the actual content of the responses. Do not let it override a clearly stronger current response.',
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
    const prompt = body?.prompt;
    const cacheBypass = body?.cache_bypass === true;

    if (!prompt || typeof prompt !== "string") {
      return badRequest("missing_prompt");
    }
    if (prompt.length > MAX_PROMPT_CHARS) {
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

    const taskType = detectTaskType(prompt);

    // Classify the prompt once — feeds risk floor and diagnostic logging.
    const initialPromptClassification = classifyPrompt(prompt);
const lowerPrompt = prompt.toLowerCase();

const isHttpsBestPractice =
  lowerPrompt.includes("https") ||
  lowerPrompt.includes("should i use https") ||
  lowerPrompt.includes("ssl") ||
  lowerPrompt.includes("tls");

const promptClassification = isHttpsBestPractice
  ? {
      ...initialPromptClassification,
      risk: "low" as const,
    }
  : initialPromptClassification;
    console.log("[/api/decision] prompt_classification", JSON.stringify({
      domain: promptClassification.domain,
      drivers: promptClassification.drivers,
      stakes: promptClassification.stakes,
      risk: promptClassification.risk,
      reasons: promptClassification.reasons,
    }));
    const { selectedProviders, rankedProviders } =
      await adaptiveSelectProviders(prompt, taskType);

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

    // ── Cache lookup ──────────────────────────────────────────────────────
    const cacheKey = generateCacheKey(prompt, limitedProviders);
    try {
      const cached = !cacheBypass ? await redis.get(cacheKey) : null;
      if (cached) {
        const cachedPayload =
          typeof cached === "string" ? JSON.parse(cached) : cached;
        if (cachedPayload && typeof cachedPayload === "object") {
          cachedPayload.usage = customerKeyMeta ?? null;
          cachedPayload.cached = true;
          console.log("[/api/decision] cache_hit", { cacheKey });
          return NextResponse.json(cachedPayload);
        }
      }
    } catch (cacheErr) {
      console.warn("[/api/decision] cache_lookup_error:", cacheErr);
    }
    // ─────────────────────────────────────────────────────────────────────

    // ── Confidence weight fetch (initial pair) ────────────────────────────
    // Weights are fetched here for the initially selected pair. If arbitration
    // later changes the active pair, weights are re-fetched below to match.
    const [rawScoreA, rawScoreB] = await Promise.all([
      redis.get(`zorelan:score:v2:${taskType}:${providerA}`),
      redis.get(`zorelan:score:v2:${taskType}:${providerB}`),
    ]);
    let weightA = getConfidenceWeight(rawScoreA);
    let weightB = getConfidenceWeight(rawScoreB);
    // ─────────────────────────────────────────────────────────────────────

    const providerMap: Record<ProviderName, ProviderRunner> = {
      openai: runOpenAI,
      anthropic: runAnthropic,
      perplexity: runPerplexity,
    };

    const executionMap: Partial<Record<ProviderName, ProviderExecution>> = {};

    const [resultA, resultB] = await Promise.all([
      withTimeout(
        (signal) => providerMap[providerA](prompt, signal),
        TIMEOUT_MS,
        `${providerA} timed out.`
      ),
      withTimeout(
        (signal) => providerMap[providerB](prompt, signal),
        TIMEOUT_MS,
        `${providerB} timed out.`
      ),
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

    const initialPair = await evaluatePair({
      prompt,
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

      const thirdResult = await withTimeout(
        (signal) => providerMap[thirdProvider](prompt, signal),
        TIMEOUT_MS,
        `${thirdProvider} timed out.`
      );

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
          prompt,
          providerA,
          providerB: thirdProvider,
          answerA: executionMap[providerA]!.answer,
          answerB: executionMap[thirdProvider]!.answer,
        }),
        evaluatePair({
          prompt,
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

      // ── Re-fetch confidence weights if arbitration changed the active pair ──
      // The winning pair may include the third provider, so weights from the
      // initial fetch may no longer apply. Always re-fetch when arbitration ran.
      if (arbitrationUsed) {
        const [rawScoreActivePairA, rawScoreActivePairB] = await Promise.all([
          redis.get(`zorelan:score:v2:${taskType}:${activePair.providerA}`),
          redis.get(`zorelan:score:v2:${taskType}:${activePair.providerB}`),
        ]);
        weightA = getConfidenceWeight(rawScoreActivePairA);
        weightB = getConfidenceWeight(rawScoreActivePairB);
      }
      // ───────────────────────────────────────────────────────────────────────
    }

    if (arbitrationPairStrengths !== null && !arbitrationUsed) {
      void incrementAnalytic("arbitration:confirmed");
    }

    logArbitrationDiagnostic({
      prompt,
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

    // ── Synthesis (confidence-weighted) ──────────────────────────────────────
    // Responses are labelled with their historical confidence scores so the
    // synthesis model receives historical confidence scores as a light secondary signal.
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
            `Question: ${prompt}`,
            "",
            `Response A (${activePair.providerA}, confidence: ${weightA.toFixed(2)}): ${activePair.answerA}`,
            "",
            `Response B (${activePair.providerB}, confidence: ${weightB.toFixed(2)}): ${activePair.answerB}`,
          ].join("\n"),
        },
      ],
    });
    // ─────────────────────────────────────────────────────────────────────────

    const verifiedAnswer = stripCodeFences(
      synthesisCompletion.choices[0]?.message?.content ?? ""
    );

    // ── Verdict + quality scoring ─────────────────────────────────────────────
    // buildDecisionVerdict depends on verifiedAnswer, so it runs after synthesis.
    // scoreAnswerQuality is independent and runs in parallel with verdict generation.
    const [verdictPayloadRaw, qualityScores] = await Promise.all([
      buildDecisionVerdict({
        prompt,
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
    // ─────────────────────────────────────────────────────────────────────────

    const verdictPayload = normalizeVerdictWithSemantic({
      semanticAgreementLevel: activePair.semantic.agreementLevel,
      semanticLikelyConflict: activePair.semantic.likelyConflict,
      verdictPayload: verdictPayloadRaw,
    });

    if (
  verdictPayload.finalConclusionAligned &&
  (verdictPayload.disagreementType === "none" ||
    verdictPayload.disagreementType === "additive_nuance" ||
    verdictPayload.disagreementType === "explanation_variation")
) {
  verdictPayload.verdict = "aligned";
  verdictPayload.keyDisagreement = "none";
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

    const modelsAligned = getModelsAligned({
      totalProviders: consensusProviderCount,
      agreementLevel: activePair.semantic.agreementLevel,
      finalConclusionAligned: verdictPayload.finalConclusionAligned,
      disagreementType: verdictPayload.disagreementType,
    });

    const consensusLevel = getConsensusLevelFromAligned(
      modelsAligned,
      consensusProviderCount
    );

    const riskLevel = getRiskLevel({
  prompt,
  agreementLevel: activePair.semantic.agreementLevel,
  disagreementType: verdictPayload.disagreementType,
  finalConclusionAligned: verdictPayload.finalConclusionAligned,
  promptClassification,
});

    const averageQuality = (qualityScores.scoreA + qualityScores.scoreB) / 2;

    const trustScore = calculateTrustScore({
  prompt,
  agreementLevel: activePair.semantic.agreementLevel,
  disagreementType: verdictPayload.disagreementType,
  finalConclusionAligned: verdictPayload.finalConclusionAligned,
  averageQuality,
  riskLevel,
});

    const responsePayload = {
      ok: true as const,
      verdict: verdictPayload.verdict,
      consensus: { level: consensusLevel, models_aligned: modelsAligned },
      risk_level: riskLevel,
      key_disagreement: verdictPayload.keyDisagreement,
      recommended_action: verdictPayload.recommendedAction,
      analysis: verifiedAnswer,
      verified_answer: verifiedAnswer,
      confidence: (() => {
        // Confidence should reflect domain risk, not just provider agreement.
        // High agreement in an uncertain domain is not the same as certainty.
        if (riskLevel === "high") return "low" as AgreementLevel;
        if (riskLevel === "moderate") {
          // Cap at medium — never report high confidence in a moderate-risk domain
          if (consensusLevel === "high") return "medium" as AgreementLevel;
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
        prompt_chars: prompt.length,
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
      return NextResponse.json(
        { ok: false, error: "response_validation_failed" },
        { status: 500 }
      );
    }

    // ── Cache write ───────────────────────────────────────────────────────
    try {
      const { usage: _usage, ...payloadWithoutUsage } = validation.data;
      await redis.set(cacheKey, JSON.stringify(payloadWithoutUsage), {
        ex: CACHE_TTL_SECONDS,
      });
      console.log("[/api/decision] cache_write", { cacheKey });
    } catch (cacheErr) {
      console.warn("[/api/decision] cache_write_error:", cacheErr);
    }
    // ─────────────────────────────────────────────────────────────────────

    return NextResponse.json(validation.data);
  } catch (err) {
    console.error("[/api/decision] error:", err);
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 }
    );
  }
}