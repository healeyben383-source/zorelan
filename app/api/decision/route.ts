import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import OpenAI from "openai";
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

import { runOpenAI } from "@/lib/providers/openai";
import { runAnthropic } from "@/lib/providers/anthropic";
import { runPerplexity } from "@/lib/providers/perplexity";
import { detectTaskType } from "@/lib/routing/selectProviders";
import { adaptiveSelectProviders } from "@/lib/routing/adaptiveSelect";
import { compareAnswers } from "@/lib/synthesis/compareAnswers";
import {
  updateProviderScore,
  updateProviderQualityScore,
} from "@/lib/routing/providerScores";

export const runtime = "nodejs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const redisUrl = process.env.KV_REST_API_URL;
const redisToken = process.env.KV_REST_API_TOKEN;

if (!redisUrl || !redisToken) {
  throw new Error("Missing Upstash Redis environment variables");
}

const redis = new Redis({
  url: redisUrl,
  token: redisToken,
});

const TIMEOUT_MS = 30_000;
const MAX_PROMPT_CHARS = 10_000;
const MAX_PROVIDERS = 2;

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

  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7).trim();
  return token || null;
}

function getClientIp(req: NextRequest): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

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
    {
      ok: false,
      error: "too_many_requests",
      scope,
      retry_after: retryAfter,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
      },
    }
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
}): {
  finalConclusionAligned: boolean;
  disagreementType: DisagreementType;
} {
  if (input.agreementLevel === "high") {
    return {
      finalConclusionAligned: true,
      disagreementType: "none",
    };
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

function getModelsAligned(input: {
  totalProviders: number;
  agreementLevel: AgreementLevel;
  finalConclusionAligned: boolean;
  disagreementType: DisagreementType;
}): number {
  if (input.totalProviders <= 1) {
    return input.totalProviders;
  }

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
      if (input.finalConclusionAligned) {
        return input.totalProviders;
      }

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
  if (modelsAligned >= totalProviders) {
    return "high";
  }

  if (modelsAligned > 0) {
    return "medium";
  }

  return "low";
}

function getRiskLevel(input: {
  agreementLevel: AgreementLevel;
  disagreementType: DisagreementType;
  finalConclusionAligned: boolean;
}): RiskLevel {
  if (input.disagreementType === "material_conflict") {
    return "high";
  }

  if (input.disagreementType === "conditional_alignment") {
    return "moderate";
  }

  if (!input.finalConclusionAligned && input.agreementLevel === "low") {
    return "high";
  }

  if (!input.finalConclusionAligned) {
    return "moderate";
  }

  if (input.agreementLevel === "low") {
    return "moderate";
  }

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
        typeof parsed.keyDisagreement === "string" && parsed.keyDisagreement.trim()
          ? parsed.keyDisagreement.trim()
          : disagreementType === "material_conflict"
          ? "The models differed on the main recommendation."
          : disagreementType === "conditional_alignment"
          ? "A usable answer depends on context, conditions, or tradeoffs."
          : "The models differed mainly in emphasis or supporting detail.",
      recommendedAction:
        typeof parsed.recommendedAction === "string" && parsed.recommendedAction.trim()
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

    if (!token) {
      return unauthorized();
    }

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

      if (!parsedKeyRecord) {
        return unauthorized();
      }

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
          {
            ok: false,
            error: "subscription_inactive",
          },
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
    const { selectedProviders } = await adaptiveSelectProviders(prompt, taskType);

    const limitedProviders = selectedProviders.slice(
      0,
      MAX_PROVIDERS
    ) as ProviderName[];

    if (limitedProviders.length < 2) {
      return NextResponse.json(
        {
          ok: false,
          error: "provider_selection_failed",
        },
        { status: 500 }
      );
    }

    const [providerA, providerB] = limitedProviders;

    const providerMap: Record<ProviderName, ProviderRunner> = {
      openai: runOpenAI,
      anthropic: runAnthropic,
      perplexity: runPerplexity,
    };

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

    const answerA = resultA.value;
    const answerB = resultB.value;

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

    const comparison = compareAnswers(answerA, answerB);

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
            `Response A: ${answerA}`,
            "",
            `Response B: ${answerB}`,
          ].join("\n"),
        },
      ],
    });

    const verifiedAnswer =
      stripCodeFences(synthesisCompletion.choices[0]?.message?.content ?? "");

    let verdictPayload = await buildDecisionVerdict({
      prompt,
      answerA,
      answerB,
      agreementLevel: comparison.agreementLevel,
      likelyConflict: comparison.likelyConflict,
      verifiedAnswer,
    });

        if (comparison.agreementLevel === "high") {
      verdictPayload.finalConclusionAligned = true;

      if (
        verdictPayload.disagreementType === "material_conflict" ||
        verdictPayload.disagreementType === "conditional_alignment"
      ) {
        verdictPayload.disagreementType = "explanation_variation";
      }
    }

    const qualityCompletion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 100,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content:
            `Rate these two AI responses from 1-10 for quality, accuracy and usefulness. ` +
            `Return JSON only: {"scoreA": number, "scoreB": number}\n\n` +
            `Response A: ${answerA}\n\nResponse B: ${answerB}`,
        },
      ],
    });

    let scoreA = 7;
    let scoreB = 7;

    try {
      const parsed = JSON.parse(
        stripCodeFences(qualityCompletion.choices[0]?.message?.content ?? "{}")
      );
      scoreA = parsed.scoreA ?? 7;
      scoreB = parsed.scoreB ?? 7;
    } catch {
      // Keep defaults
    }

    await Promise.all([
      updateProviderQualityScore({
        taskType,
        provider: providerA,
        qualityScore: scoreA,
      }),
      updateProviderQualityScore({
        taskType,
        provider: providerB,
        qualityScore: scoreB,
      }),
    ]);

    const modelsAligned = getModelsAligned({
      totalProviders: limitedProviders.length,
      agreementLevel: comparison.agreementLevel,
      finalConclusionAligned: verdictPayload.finalConclusionAligned,
      disagreementType: verdictPayload.disagreementType,
    });

    const consensusLevel = getConsensusLevelFromAligned(
      modelsAligned,
      limitedProviders.length
    );

    const riskLevel = getRiskLevel({
      agreementLevel: comparison.agreementLevel,
      disagreementType: verdictPayload.disagreementType,
      finalConclusionAligned: verdictPayload.finalConclusionAligned,
    });

    return NextResponse.json({
      ok: true,
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
      confidence: consensusLevel,
      confidence_reason: getConfidenceReason({
        agreementLevel: comparison.agreementLevel,
        disagreementType: verdictPayload.disagreementType,
        finalConclusionAligned: verdictPayload.finalConclusionAligned,
      }),
      providers_used: limitedProviders,
      verification: {
        final_conclusion_aligned: verdictPayload.finalConclusionAligned,
        disagreement_type: verdictPayload.disagreementType,
      },
      model_diagnostics: {
        [providerA]: {
          quality_score: scoreA,
          duration_ms: resultA.durationMs,
        },
        [providerB]: {
          quality_score: scoreB,
          duration_ms: resultB.durationMs,
        },
      },
      meta: {
        task_type: taskType,
        overlap_ratio: comparison.overlapRatio,
        agreement_summary: comparison.summary,
        prompt_chars: prompt.length,
        likely_conflict: comparison.likelyConflict,
        disagreement_type: verdictPayload.disagreementType,
      },
      usage: customerKeyMeta ?? null,
    });
  } catch (err) {
    console.error("[/api/decision] error:", err);
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 }
    );
  }
}