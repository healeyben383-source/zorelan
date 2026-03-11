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

function getConfidenceReason(
  agreementLevel: "high" | "medium" | "low",
  likelyConflict: boolean
): string {
  if (agreementLevel === "high") {
    return "Both models independently reached the same conclusion.";
  }

  if (agreementLevel === "medium") {
    return "Models partially agreed but differed in emphasis or approach.";
  }

  return likelyConflict
    ? "Models produced conflicting recommendations — review both perspectives before deciding."
    : "Models diverged in their reasoning or conclusions.";
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
            "You are a synthesis engine. Combine the two AI responses into one superior final answer. Be concise and direct. Do not mention that you are combining two answers.",
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
      synthesisCompletion.choices[0]?.message?.content?.trim() ?? "";

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
        qualityCompletion.choices[0]?.message?.content ?? "{}"
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

    return NextResponse.json({
      ok: true,
      verified_answer: verifiedAnswer,
      confidence: comparison.agreementLevel,
      confidence_reason: getConfidenceReason(
        comparison.agreementLevel,
        comparison.likelyConflict
      ),
      providers_used: limitedProviders,
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