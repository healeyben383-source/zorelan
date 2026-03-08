import type { TaskType } from "@/lib/routing/providerProfiles";
import {
  selectProvidersFromPrompt,
  type ProviderName,
} from "@/lib/routing/selectProviders";
import { getProviderScoresForTask } from "@/lib/routing/providerMemory";
import type { SelectionMode } from "@/lib/routing/runDiagnostics";

const MIN_SAMPLE_SIZE = 2;

type RankedProvider = {
  provider: ProviderName;
  score: number;
  totalRuns: number;
};

function calculateAdaptiveRankScore(metrics: {
  totalRuns: number;
  successRate: number;
  failureRate: number;
  timeoutRate: number;
  fallbackRate: number;
  averageDurationMs: number;
}) {
  const reliabilityScore =
    metrics.successRate * 100 -
    metrics.failureRate * 40 -
    metrics.timeoutRate * 60 -
    metrics.fallbackRate * 20;

  const speedScore =
    metrics.averageDurationMs > 0
      ? Math.max(0, 20_000 - metrics.averageDurationMs) / 1000
      : 0;

  return reliabilityScore + speedScore;
}

export function adaptiveSelectProviders(
  prompt: string,
  taskType: TaskType
): {
  selectedProviders: ProviderName[];
  selectionMode: SelectionMode;
} {
  const fallbackProviders = selectProvidersFromPrompt(prompt);
  const taskScores = getProviderScoresForTask(taskType);

  const rankedProviders: RankedProvider[] = (Object.entries(taskScores) as Array<
    [
      ProviderName,
      {
        totalRuns: number;
        successRate: number;
        failureRate: number;
        timeoutRate: number;
        fallbackRate: number;
        averageDurationMs: number;
      }
    ]
  >)
    .map(([provider, metrics]) => ({
      provider,
      score: calculateAdaptiveRankScore(metrics),
      totalRuns: metrics.totalRuns,
    }))
    .sort((a, b) => b.score - a.score);

  if (rankedProviders.length < 2) {
    return {
      selectedProviders: fallbackProviders,
      selectionMode: "fallback",
    };
  }

  const hasEnoughHistory = rankedProviders
    .slice(0, 2)
    .every((entry) => entry.totalRuns >= MIN_SAMPLE_SIZE);

  if (!hasEnoughHistory) {
    return {
      selectedProviders: fallbackProviders,
      selectionMode: "fallback",
    };
  }

  const adaptiveProviders = rankedProviders
    .slice(0, 2)
    .map((entry) => entry.provider);

  return {
    selectedProviders: adaptiveProviders,
    selectionMode: "adaptive",
  };
}