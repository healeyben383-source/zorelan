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
const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

const TIMEOUT_MS = 30_000;

type ProviderName = "openai" | "anthropic" | "perplexity";

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T
): Promise<{ value: T; durationMs: number; timedOut: boolean; usedFallback: boolean }> {
  return new Promise((resolve) => {
    const start = Date.now();
    const timer = setTimeout(() => {
      resolve({ value: fallback, durationMs: Date.now() - start, timedOut: true, usedFallback: true });
    }, ms);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve({ value, durationMs: Date.now() - start, timedOut: false, usedFallback: false });
      })
      .catch((err) => {
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

function getConfidenceReason(agreementLevel: "high" | "medium" | "low", likelyConflict: boolean): string {
  if (agreementLevel === "high") return "Both models independently reached the same conclusion.";
  if (agreementLevel === "medium") return "Models partially agreed but differed in emphasis or approach.";
  return likelyConflict
    ? "Models produced conflicting recommendations — review both perspectives before deciding."
    : "Models diverged in their reasoning or conclusions.";
}

export async function POST(req: NextRequest) {
  try {
    // API key auth
    const authHeader = req.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 }
      );
    }

    // Check master key first (for internal use)
    const isMasterKey = token === process.env.DECISION_API_KEY;

    if (!isMasterKey) {
      // Look up in Redis
      const keyData = await redis.get<string>(`apikey:${token}`);
      if (!keyData) {
        return NextResponse.json(
          { ok: false, error: "unauthorized" },
          { status: 401 }
        );
      }

      const parsed = typeof keyData === "string" ? JSON.parse(keyData) : keyData;

      // Check usage limits
      if (parsed.callsUsed >= parsed.callsLimit) {
        return NextResponse.json(
          { ok: false, error: "rate_limit_exceeded" },
          { status: 429 }
        );
      }

      // Increment usage
      await redis.set(`apikey:${token}`, JSON.stringify({
        ...parsed,
        callsUsed: parsed.callsUsed + 1,
      }));
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

    // Run both providers in parallel
    const providerMap: Record<ProviderName, (p: string) => Promise<string>> = {
      openai: runOpenAI,
      anthropic: runAnthropic,
      perplexity: runPerplexity,
    };

    const [resultA, resultB] = await Promise.all([
      withTimeout(providerMap[providerA](prompt), TIMEOUT_MS, `${providerA} timed out.`),
      withTimeout(providerMap[providerB](prompt), TIMEOUT_MS, `${providerB} timed out.`),
    ]);

    const answerA = resultA.value;
    const answerB = resultB.value;

    // Update provider scores
    await Promise.all([
      updateProviderScore({ taskType, provider: providerA, durationMs: resultA.durationMs, timedOut: resultA.timedOut, usedFallback: resultA.usedFallback }),
      updateProviderScore({ taskType, provider: providerB, durationMs: resultB.durationMs, timedOut: resultB.timedOut, usedFallback: resultB.usedFallback }),
    ]);

    // Compare answers
    const comparison = compareAnswers(answerA, answerB);

    // Synthesize
    const synthesisCompletion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 1024,
      messages: [
        {
          role: "system",
          content: "You are a synthesis engine. Combine the two AI responses into one superior final answer. Be concise and direct. Do not mention that you are combining two answers.",
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

    const verifiedAnswer = synthesisCompletion.choices[0]?.message?.content?.trim() ?? "";

    // Score quality
    const qualityCompletion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 100,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: `Rate these two AI responses from 1-10 for quality, accuracy and usefulness. Return JSON only: {"scoreA": number, "scoreB": number}\n\nResponse A: ${answerA}\n\nResponse B: ${answerB}`,
        },
      ],
    });

    let scoreA = 7;
    let scoreB = 7;

    try {
      const parsed = JSON.parse(qualityCompletion.choices[0]?.message?.content ?? "{}");
      scoreA = parsed.scoreA ?? 7;
      scoreB = parsed.scoreB ?? 7;
    } catch {}

    await Promise.all([
      updateProviderQualityScore({ taskType, provider: providerA, qualityScore: scoreA }),
      updateProviderQualityScore({ taskType, provider: providerB, qualityScore: scoreB }),
    ]);

    return NextResponse.json({
      ok: true,
      verified_answer: verifiedAnswer,
      confidence: comparison.agreementLevel,
      confidence_reason: getConfidenceReason(comparison.agreementLevel, comparison.likelyConflict),
      providers_used: selectedProviders,
      model_diagnostics: {
        [providerA]: { quality_score: scoreA, duration_ms: resultA.durationMs },
        [providerB]: { quality_score: scoreB, duration_ms: resultB.durationMs },
      },
      meta: {
        task_type: taskType,
        overlap_ratio: comparison.overlapRatio,
        agreement_summary: comparison.summary,
      },
    });
  } catch (err) {
    console.error("[/api/decision] error:", err);
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 }
    );
  }
}