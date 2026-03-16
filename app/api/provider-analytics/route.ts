import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import {
  calculateProviderRankScore,
  type ProviderScore,
} from "@/lib/routing/providerScores";

export const runtime = "nodejs";

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

const PROVIDERS = ["openai", "anthropic", "perplexity"] as const;
const TASK_TYPES = ["technical", "strategy", "creative", "general"] as const;

type ProviderName = (typeof PROVIDERS)[number];
type TaskType = (typeof TASK_TYPES)[number];

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "unauthorized" },
    { status: 401 }
  );
}

function parseScore(raw: unknown): ProviderScore {
  const defaults: ProviderScore = {
    totalRuns: 0,
    timeouts: 0,
    fallbacks: 0,
    reliabilityEma: 1.0,
    speedEma: 5000,
    totalQualityScore: 0,
    qualityRatings: 0,
  };

  if (!raw || typeof raw !== "object") return defaults;
  const r = raw as Record<string, unknown>;

  return {
    totalRuns: typeof r.totalRuns === "number" ? r.totalRuns : 0,
    timeouts: typeof r.timeouts === "number" ? r.timeouts : 0,
    fallbacks: typeof r.fallbacks === "number" ? r.fallbacks : 0,
    reliabilityEma:
      typeof r.reliabilityEma === "number" ? r.reliabilityEma : 1.0,
    speedEma: typeof r.speedEma === "number" ? r.speedEma : 5000,
    totalQualityScore:
      typeof r.totalQualityScore === "number" ? r.totalQualityScore : 0,
    qualityRatings:
      typeof r.qualityRatings === "number" ? r.qualityRatings : 0,
  };
}

function deriveMetrics(score: ProviderScore) {
  const avgQuality =
    score.qualityRatings > 0
      ? Math.round((score.totalQualityScore / score.qualityRatings) * 10) / 10
      : null;

  const timeoutRate =
    score.totalRuns > 0
      ? Math.round((score.timeouts / score.totalRuns) * 1000) / 1000
      : 0;

  const fallbackRate =
    score.totalRuns > 0
      ? Math.round((score.fallbacks / score.totalRuns) * 1000) / 1000
      : 0;

  return {
    score: Math.round(calculateProviderRankScore(score) * 1000) / 1000,
    avgQuality,
    avgLatencyMs: Math.round(score.speedEma),
    reliabilityEma: Math.round(score.reliabilityEma * 1000) / 1000,
    timeoutRate,
    fallbackRate,
    sampleCount: score.totalRuns,
  };
}

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return unauthorized();
    const token = authHeader.slice(7).trim();
    if (token !== process.env.DECISION_API_KEY) return unauthorized();

    // Fetch all scores in parallel
    const keys: string[] = [];
    for (const taskType of TASK_TYPES) {
      for (const provider of PROVIDERS) {
        keys.push(`zorelan:score:v2:${taskType}:${provider}`);
      }
    }

    const rawValues = await Promise.all(keys.map((key) => redis.get(key)));

    // Build result map
    type ProviderMetrics = ReturnType<typeof deriveMetrics>;
    const taskTypes: { [key: string]: { [key: string]: ProviderMetrics } } = {};

    let keyIndex = 0;
    for (const taskType of TASK_TYPES) {
      taskTypes[taskType] = {};
      for (const provider of PROVIDERS) {
        const raw = rawValues[keyIndex++];
        const score = parseScore(raw);
        taskTypes[taskType][provider] = deriveMetrics(score);
      }
    }

    // Find top provider per task type
    const topProviders = {} as Record<string, string>;
    for (const taskType of TASK_TYPES) {
      let topProvider: ProviderName = "openai";
      let topScore = -1;
      for (const provider of PROVIDERS) {
        const s = taskTypes[taskType][provider].score;
        if (s > topScore) {
          topScore = s;
          topProvider = provider;
        }
      }
      topProviders[taskType] = topProvider;
    }

    return NextResponse.json({
      ok: true,
      taskTypes,
      topProviders,
    });
  } catch (err) {
    console.error("[/api/provider-analytics] error:", err);
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 }
    );
  }
}