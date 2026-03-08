import type { TaskType } from "@/lib/routing/providerProfiles";
import {
  selectProvidersFromPrompt,
  type ProviderName,
} from "@/lib/routing/selectProviders";
import { getProviderScoresForTask } from "@/lib/routing/providerMemory";
import type { SelectionMode } from "@/lib/routing/runDiagnostics";

const MIN_SAMPLE_SIZE = 2;
const GEMINI_MIN_SAMPLE_SIZE = 3;

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

function isProviderEligible(provider: ProviderName, totalRuns: number) {
  if (provider === "gemini") {
    return totalRuns >= GEMINI_MIN_SAMPLE_SIZE;
  }

  return totalRuns >= MIN_SAMPLE_SIZE;
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

  const eligibleProviders = rankedProviders.filter((entry) =>
    isProviderEligible(entry.provider, entry.totalRuns)
  );

  if (eligibleProviders.length < 2) {
    return {
      selectedProviders: fallbackProviders,
      selectionMode: "fallback",
    };
  }

  const adaptiveProviders = eligibleProviders
    .slice(0, 2)
    .map((entry) => entry.provider);

  return {
    selectedProviders: adaptiveProviders,
    selectionMode: "adaptive",
  };
}