import type { TaskType } from "@/lib/routing/providerProfiles";
import {
  selectProvidersFromPrompt,
  type ProviderName,
} from "@/lib/routing/selectProviders";
import {
  getProviderScores,
  calculateProviderRankScore,
  type ProviderScore,
} from "@/lib/routing/providerScores";
import type { SelectionMode } from "@/lib/routing/runDiagnostics";

const MIN_SAMPLE_SIZE = 2;

type RankedProvider = {
  provider: ProviderName;
  score: number;
  totalRuns: number;
};

function isProviderEligible(totalRuns: number): boolean {
  return totalRuns >= MIN_SAMPLE_SIZE;
}

export async function adaptiveSelectProviders(
  prompt: string,
  taskType: TaskType
): Promise<{
  selectedProviders: ProviderName[];
  selectionMode: SelectionMode;
}> {
  const fallbackProviders = selectProvidersFromPrompt(prompt);

  try {
    const taskScores = await getProviderScores(taskType);

    const rankedProviders: RankedProvider[] = Object.entries(taskScores)
      .map(([provider, score]) => ({
        provider: provider as ProviderName,
        score: calculateProviderRankScore(score as ProviderScore),
        totalRuns: (score as ProviderScore).totalRuns,
      }))
      .sort((a, b) => b.score - a.score);

    if (rankedProviders.length < 2) {
      return { selectedProviders: fallbackProviders, selectionMode: "fallback" };
    }

    const eligibleProviders = rankedProviders.filter((entry) =>
      isProviderEligible(entry.totalRuns)
    );

    if (eligibleProviders.length < 2) {
      return { selectedProviders: fallbackProviders, selectionMode: "fallback" };
    }

    const adaptiveProviders = eligibleProviders
      .slice(0, 2)
      .map((entry) => entry.provider);

    return { selectedProviders: adaptiveProviders, selectionMode: "adaptive" };
  } catch {
    return { selectedProviders: fallbackProviders, selectionMode: "fallback" };
  }
}