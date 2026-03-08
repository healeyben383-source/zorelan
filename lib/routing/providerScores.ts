import { Redis } from "@upstash/redis";
import type { ProviderName } from "@/lib/routing/selectProviders";
import type { TaskType } from "@/lib/routing/providerProfiles";

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

export type ProviderScore = {
  totalRuns: number;
  successes: number;
  failures: number;
  timeouts: number;
  fallbacks: number;
  totalDurationMs: number;
  totalQualityScore: number;
  qualityRatings: number;
};

const DEFAULT_PROVIDER_SCORE: ProviderScore = {
  totalRuns: 0,
  successes: 0,
  failures: 0,
  timeouts: 0,
  fallbacks: 0,
  totalDurationMs: 0,
  totalQualityScore: 0,
  qualityRatings: 0,
};

function getScoreKey(taskType: TaskType, provider: ProviderName) {
  return `zorelan:score:${taskType}:${provider}`;
}

export async function getProviderScores(
  taskType: TaskType
): Promise<Record<ProviderName, ProviderScore>> {
  const providers: ProviderName[] = ["openai", "anthropic", "perplexity"];

  const entries = await Promise.all(
    providers.map(async (provider) => {
      const score = await redis.get<ProviderScore>(
        getScoreKey(taskType, provider)
      );
      return [provider, score ?? { ...DEFAULT_PROVIDER_SCORE }] as const;
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
}) {
  const key = getScoreKey(input.taskType, input.provider);
  const existing = await redis.get<ProviderScore>(key);
  const entry: ProviderScore = existing ?? { ...DEFAULT_PROVIDER_SCORE };

  entry.totalRuns += 1;
  entry.totalDurationMs += input.durationMs;

  if (input.timedOut) {
    entry.timeouts += 1;
    entry.failures += 1;
  } else if (input.usedFallback) {
    entry.fallbacks += 1;
    entry.failures += 1;
  } else {
    entry.successes += 1;
  }

  await redis.set(key, entry);
}

export async function updateProviderQualityScore(input: {
  taskType: TaskType;
  provider: ProviderName;
  qualityScore: number;
}) {
  const key = getScoreKey(input.taskType, input.provider);
  const existing = await redis.get<ProviderScore>(key);
  const entry: ProviderScore = existing ?? { ...DEFAULT_PROVIDER_SCORE };

  entry.totalQualityScore += input.qualityScore;
  entry.qualityRatings += 1;

  await redis.set(key, entry);
}

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

export function calculateProviderRankScore(score: ProviderScore): number {
  const totalRuns = Math.max(score.totalRuns, 1);

  const reliabilityScore =
    1 - (score.failures + score.timeouts + score.fallbacks) / totalRuns;

  const successScore = score.successes / totalRuns;

  const avgDurationMs = score.totalDurationMs / totalRuns;
  const speedScore = clamp((20000 - avgDurationMs) / 18000);

  const sampleScore = clamp(totalRuns / 10);

  const avgQuality =
    score.qualityRatings > 0
      ? score.totalQualityScore / score.qualityRatings / 10
      : 0.5;

  const qualityWeight = clamp(score.qualityRatings / 5);
  const qualityScore = avgQuality * qualityWeight + 0.5 * (1 - qualityWeight);

  return (
    reliabilityScore * 0.45 +
    successScore * 0.15 +
    speedScore * 0.15 +
    sampleScore * 0.05 +
    qualityScore * 0.2
  );
}