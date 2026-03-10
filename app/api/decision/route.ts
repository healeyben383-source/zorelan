import { NextRequest, NextResponse } from "next/server";
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
import OpenAI from "openai";
import { Redis } from "@upstash/redis";

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

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T
): Promise<{
  value: T;
  durationMs: number;
  timedOut: boolean;
  usedFallback: boolean;
}> {
  return new Promise((resolve) => {
    const start = Date.now();

    const timer = setTimeout(() => {
      resolve({
        value: fallback,
        durationMs: Date.now() - start,
        timedOut: true,
        usedFallback: true,
      });
    }, ms);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve({
          value,
          durationMs: Date.now() - start,
          timedOut: false,
          usedFallback: false,
        });
      })
      .catch(() => {
        clearTimeout(timer);
        resolve({
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

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : null;

    if (!token) {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 }
      );
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

    if (!isMasterKey) {
      const rawKeyData = await redis.get(`apikey:${token}`);
      const parsed = parseApiKeyRecord(rawKeyData);

      if (!parsed) {
        return NextResponse.json(
          { ok: false, error: "unauthorized" },
          { status: 401 }
        );
      }

      const keyStatus = parsed.status ?? "active";

      if (keyStatus !== "active") {
        return NextResponse.json(
          {
            ok: false,
            error: "subscription_inactive",
          },
          { status: 403 }
        );
      }

      if (parsed.callsUsed >= parsed.callsLimit) {
        return NextResponse.json(
          {
            ok: false,
            error: "rate_limit_exceeded",
            plan: parsed.plan,
            calls_limit: parsed.callsLimit,
            calls_used: parsed.callsUsed,
            calls_remaining: 0,
            status: keyStatus,
          },
          { status: 429 }
        );
      }

      const updatedKeyData: ApiKeyRecord = {
        ...parsed,
        status: keyStatus,
        callsUsed: parsed.callsUsed + 1,
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

    const body = await req.json();
    const prompt = body?.prompt;

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json(
        { ok: false, error: "missing_prompt" },
        { status: 400 }
      );
    }

    const taskType = detectTaskType(prompt);
    const { selectedProviders } = await adaptiveSelectProviders(prompt, taskType);
    const [providerA, providerB] = selectedProviders;

    const providerMap: Record<ProviderName, (p: string) => Promise<string>> = {
      openai: runOpenAI,
      anthropic: runAnthropic,
      perplexity: runPerplexity,
    };

    const [resultA, resultB] = await Promise.all([
      withTimeout(
        providerMap[providerA](prompt),
        TIMEOUT_MS,
        `${providerA} timed out.`
      ),
      withTimeout(
        providerMap[providerB](prompt),
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
      max_tokens: 1024,
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
    } catch {}

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
      providers_used: selectedProviders,
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