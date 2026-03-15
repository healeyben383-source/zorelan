import { Redis } from "@upstash/redis";
import type { ProviderName } from "@/lib/routing/selectProviders";
import type { TaskType } from "@/lib/routing/providerProfiles";

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

export type ProviderScore = {
  totalRuns: number;
  timeouts: number;
  fallbacks: number;
  reliabilityEma: number;
  speedEma: number;
  totalQualityScore: number;
  qualityRatings: number;
};

const DEFAULT_PROVIDER_SCORE: ProviderScore = {
  totalRuns: 0,
  timeouts: 0,
  fallbacks: 0,
  reliabilityEma: 1.0,
  speedEma: 5000,
  totalQualityScore: 0,
  qualityRatings: 0,
};

// How quickly old data fades. 0.92 means ~12 runs to halve the
// influence of historical data. Raise toward 1.0 to make routing
// more conservative; lower toward 0.8 to make it react faster.
const EMA_DECAY = 0.92;

function getScoreKey(taskType: TaskType, provider: ProviderName): string {
  return `zorelan:score:v2:${taskType}:${provider}`;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function parseScore(raw: unknown): ProviderScore {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_PROVIDER_SCORE };
  }

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

export async function getProviderScores(
  taskType: TaskType
): Promise<Record<ProviderName, ProviderScore>> {
  const providers: ProviderName[] = ["openai", "anthropic", "perplexity"];

  const entries = await Promise.all(
    providers.map(async (provider) => {
      const raw = await redis.get(getScoreKey(taskType, provider));
      return [provider, parseScore(raw)] as const;
    })
  );

  return Object.fromEntries(entries) as Record<ProviderName, ProviderScore>;
}

export async function updateProviderScore(input: {
  taskType: TaskType;
  provider: ProviderName;
  durationMs: number;
  timedOut: boolean;
  usedFallback: boolean;
}): Promise<void> {
  const key = getScoreKey(input.taskType, input.provider);
  const raw = await redis.get(key);
  const existing = parseScore(raw);

  const isSuccess = !input.timedOut && !input.usedFallback;

  const updated: ProviderScore = {
    totalRuns: existing.totalRuns + 1,
    timeouts: existing.timeouts + (input.timedOut ? 1 : 0),
    fallbacks:
      existing.fallbacks + (input.usedFallback && !input.timedOut ? 1 : 0),
    reliabilityEma:
      existing.reliabilityEma * EMA_DECAY +
      (isSuccess ? 1 : 0) * (1 - EMA_DECAY),
    speedEma:
      existing.speedEma * EMA_DECAY + input.durationMs * (1 - EMA_DECAY),
    totalQualityScore: existing.totalQualityScore,
    qualityRatings: existing.qualityRatings,
  };

  await redis.set(key, JSON.stringify(updated));
}

export async function updateProviderQualityScore(input: {
  taskType: TaskType;
  provider: ProviderName;
  qualityScore: number;
}): Promise<void> {
  const key = getScoreKey(input.taskType, input.provider);
  const raw = await redis.get(key);
  const existing = parseScore(raw);

  const updated: ProviderScore = {
    ...existing,
    totalQualityScore: existing.totalQualityScore + input.qualityScore,
    qualityRatings: existing.qualityRatings + 1,
  };

  await redis.set(key, JSON.stringify(updated));
}

export function calculateProviderRankScore(score: ProviderScore): number {
  // Reliability: EMA of success rate, 0-1
  const reliabilityScore = clamp(score.reliabilityEma ?? 1.0);

  // Speed: normalised against a 15s ceiling.
  // A provider averaging 1s scores ~0.93; one averaging 10s scores ~0.33
  const speedEma = score.speedEma ?? 5000;
  const speedScore = clamp((15000 - speedEma) / 13000);

  // Quality: average rating from neutral cross-model judge, normalised 0-1.
  // Ramps up as more quality ratings accumulate (qualityWeight reaches 1.0
  // after 5 ratings). New providers start at 0.7 — optimistic, not punitive.
  const avgQuality =
    score.qualityRatings > 0
      ? score.totalQualityScore / score.qualityRatings / 10
      : 0.7;

  const qualityWeight = clamp(score.qualityRatings / 5);
  const qualityScore =
    avgQuality * qualityWeight + 0.7 * (1 - qualityWeight);

  // Weights: reliability is the most important signal.
  // Quality weighted higher than speed because it directly
  // reflects output value, not just infrastructure performance.
  return (
    reliabilityScore * 0.5 +
    speedScore       * 0.2 +
    qualityScore     * 0.3
  );
}