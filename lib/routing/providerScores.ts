import type { ProviderName } from "@/lib/routing/selectProviders";
import type { TaskType } from "@/lib/routing/providerProfiles";

export type ProviderScore = {
  totalRuns: number;
  successes: number;
  failures: number;
  timeouts: number;
  fallbacks: number;
  totalDurationMs: number;
};

type TaskScoreMap = Record<ProviderName, ProviderScore>;

const DEFAULT_PROVIDER_SCORE: ProviderScore = {
  totalRuns: 0,
  successes: 0,
  failures: 0,
  timeouts: 0,
  fallbacks: 0,
  totalDurationMs: 0,
};

const DEFAULT_TASK_SCORE_MAP: TaskScoreMap = {
  openai: { ...DEFAULT_PROVIDER_SCORE },
  anthropic: { ...DEFAULT_PROVIDER_SCORE },
};

const scoreStore: Record<TaskType, TaskScoreMap> = {
  technical: {
    openai: { ...DEFAULT_PROVIDER_SCORE },
    anthropic: { ...DEFAULT_PROVIDER_SCORE },
  },
  strategy: {
    openai: { ...DEFAULT_PROVIDER_SCORE },
    anthropic: { ...DEFAULT_PROVIDER_SCORE },
  },
  creative: {
    openai: { ...DEFAULT_PROVIDER_SCORE },
    anthropic: { ...DEFAULT_PROVIDER_SCORE },
  },
  general: {
    openai: { ...DEFAULT_PROVIDER_SCORE },
    anthropic: { ...DEFAULT_PROVIDER_SCORE },
  },
};

export function getProviderScores(taskType: TaskType): TaskScoreMap {
  return scoreStore[taskType] ?? { ...DEFAULT_TASK_SCORE_MAP };
}

export function updateProviderScore(input: {
  taskType: TaskType;
  provider: ProviderName;
  durationMs: number;
  timedOut: boolean;
  usedFallback: boolean;
}) {
  const entry = scoreStore[input.taskType][input.provider];

  entry.totalRuns += 1;
  entry.totalDurationMs += input.durationMs;

  if (input.timedOut) {
    entry.timeouts += 1;
    entry.failures += 1;
    return;
  }

  if (input.usedFallback) {
    entry.fallbacks += 1;
    entry.failures += 1;
    return;
  }

  entry.successes += 1;
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

  // 2s = excellent, 20s = poor
  const speedScore = clamp((20000 - avgDurationMs) / 18000);

  // prevents tiny sample sizes from dominating
  const sampleScore = clamp(totalRuns / 10);

  return (
    reliabilityScore * 0.55 +
    successScore * 0.2 +
    speedScore * 0.2 +
    sampleScore * 0.05
  );
}