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

const QUALITY_JUDGE_MODEL = "claude-haiku-4-5-20251001";

const ENABLE_API_RATE_LIMIT = process.env.ENABLE_API_RATE_LIMIT === "true";

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
    normalized.finalConclusionAligned = true;
    if (
      normalized.disagreementType === "material_conflict" ||
      normalized.disagreementType === "conditional_alignment"
    ) {
      normalized.disagreementType = "explanation_variation";
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

function getRiskLevel(input: {
  agreementLevel: AgreementLevel;
  disagreementType: DisagreementType;
  finalConclusionAligned: boolean;
}): RiskLevel {
  if (input.disagreementType === "material_conflict") return "high";
  if (input.disagreementType === "conditional_alignment") return "moderate";
  if (!input.finalConclusionAligned && input.agreementLevel === "low")
    return "high";
  if (!input.finalConclusionAligned) return "moderate";
  if (input.agreementLevel === "low") return "moderate";
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

function calculateTrustScore(input: {
  agreementLevel: AgreementLevel;
  disagreementType: DisagreementType;
  finalConclusionAligned: boolean;
  averageQuality: number;
  riskLevel: RiskLevel;
}): { score: number; label: "high" | "moderate" | "low"; reason: string } {
  const agreementBase = getAgreementBaseScore(input.agreementLevel);
  const qualityNormalized = input.averageQuality * 10;
  let score = agreementBase * 0.65 + qualityNormalized * 0.35;

  if (input.disagreementType === "explanation_variation") score -= 4;
  else if (input.disagreementType === "conditional_alignment") score -= 12;
  else if (input.disagreementType === "material_conflict") score -= 20;

  if (!input.finalConclusionAligned) score -= 10;
  if (input.riskLevel === "moderate") score -= 5;
  else if (input.riskLevel === "high") score -= 15;

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
  )
    return true;
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
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          'You are a decision-verification engine. Return JSON only with this exact shape: {"verdict":"string","keyDisagreement":"string","recommendedAction":"string","finalConclusionAligned":boolean,"disagreementType":"none|additive_nuance|explanation_variation|conditional_alignment|material_conflict"}. Judge alignment from the ORIGINAL model responses first. The verified synthesis can help summarize the situation, but it is not evidence that the original answers aligned. finalConclusionAligned should be true only when both responses support the same main conclusion. Use additive_nuance when one response mostly adds correct detail without changing the core conclusion. Use explanation_variation when both responses support the same conclusion but differ in framing, emphasis, or supporting reasoning. Use conditional_alignment when a usable combined takeaway exists only by adding conditions, context, or tradeoffs, but the original responses do not cleanly support the same main conclusion. Use material_conflict only when the main recommendation, conclusion, or decision materially differs.',
      },
      {
        role: "user",
        content: [
          `Question: ${params.prompt}`,
          "",
          `Agreement level: ${params.agreementLevel}`,
          `Likely conflict: ${params.likelyConflict ? "yes" : "no"}`,
          "",
          `Response A: ${params.answerA}`,
          "",
          `Response B: ${params.answerB}`,
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

    if (!prompt || typeof prompt !== "string")
      return badRequest("missing_prompt");
    if (prompt.length > MAX_PROMPT_CHARS) return badRequest("prompt_too_large");

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

    if (
      thirdProvider &&
      shouldTriggerArbitration({
        agreementLevel: initialPair.semantic.agreementLevel,
        likelyConflict: initialPair.semantic.likelyConflict,
        finalConclusionAligned:
          initialFallbackClassification.finalConclusionAligned,
      })
    ) {
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
    }

    const synthesisCompletion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 400,
      messages: [
        {
          role: "system",
          content:
            "You are a synthesis engine. Combine the two AI responses into one superior final answer. " +
            "Be concise and direct. Preserve important caveats and tradeoffs. " +
            "Do not mention that you are combining two answers.",
        },
        {
          role: "user",
          content: [
            `Question: ${prompt}`,
            "",
            `Response A (${activePair.providerA}): ${activePair.answerA}`,
            "",
            `Response B (${activePair.providerB}): ${activePair.answerB}`,
          ].join("\n"),
        },
      ],
    });

    const verifiedAnswer = stripCodeFences(
      synthesisCompletion.choices[0]?.message?.content ?? ""
    );

    const [verdictPayloadRaw, qualityScores] = await Promise.all([
      buildDecisionVerdict({
        prompt,
        answerA: activePair.answerA,
        answerB: activePair.answerB,
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
    });

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
      agreementLevel: activePair.semantic.agreementLevel,
      disagreementType: verdictPayload.disagreementType,
      finalConclusionAligned: verdictPayload.finalConclusionAligned,
    });

    const averageQuality = (qualityScores.scoreA + qualityScores.scoreB) / 2;

    const trustScore = calculateTrustScore({
      agreementLevel: activePair.semantic.agreementLevel,
      disagreementType: verdictPayload.disagreementType,
      finalConclusionAligned: verdictPayload.finalConclusionAligned,
      averageQuality,
      riskLevel,
    });

    // Build response payload
    const responsePayload = {
      ok: true as const,
      verdict: verdictPayload.verdict,
      consensus: { level: consensusLevel, models_aligned: modelsAligned },
      risk_level: riskLevel,
      key_disagreement: verdictPayload.keyDisagreement,
      recommended_action: verdictPayload.recommendedAction,
      analysis: verifiedAnswer,
      verified_answer: verifiedAnswer,
      confidence: consensusLevel,
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
    };

    // Validate response shape before sending
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

    return NextResponse.json(validation.data);
  } catch (err) {
    console.error("[/api/decision] error:", err);
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 }
    );
  }
}