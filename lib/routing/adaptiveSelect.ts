import type { TaskType } from "@/lib/routing/providerProfiles";
import {
  selectProvidersFromPrompt,
  type ProviderName,
} from "@/lib/routing/selectProviders";
import {
  calculateProviderRankScore,
  getProviderScores,
} from "@/lib/routing/providerScores";
import type { SelectionMode } from "@/lib/routing/runDiagnostics";

const MIN_SAMPLE_SIZE = 3;

type RankedProvider = {
  provider: ProviderName;
  score: number;
  totalRuns: number;
};

export function adaptiveSelectProviders(
  prompt: string,
  taskType: TaskType
): {
  selectedProviders: ProviderName[];
  selectionMode: SelectionMode;
} {
  const fallbackProviders = selectProvidersFromPrompt(prompt);
  const taskScores = getProviderScores(taskType);

  const rankedProviders: RankedProvider[] = (Object.entries(taskScores) as Array<
    [ProviderName, (typeof taskScores)[ProviderName]]
  >)
    .map(([provider, metrics]) => ({
      provider,
      score: calculateProviderRankScore(metrics),
      totalRuns: metrics.totalRuns,
    }))
    .sort((a, b) => b.score - a.score);

  const hasEnoughHistory = rankedProviders.every(
    (entry) => entry.totalRuns >= MIN_SAMPLE_SIZE
  );

  if (!hasEnoughHistory) {
    return {
      selectedProviders: fallbackProviders,
      selectionMode: "fallback",
    };
  }

  const adaptiveProviders = rankedProviders
    .map((entry) => entry.provider)
    .slice(0, 2);

  if (adaptiveProviders.length < 2) {
    return {
      selectedProviders: fallbackProviders,
      selectionMode: "fallback",
    };
  }

  return {
    selectedProviders: adaptiveProviders,
    selectionMode: "adaptive",
  };
}