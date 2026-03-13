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
const SECOND_PROVIDER_EXPLORATION_RATE = 0.2;
const LOW_SAMPLE_EXPLORATION_RATE = 0.15;
const LOW_SAMPLE_THRESHOLD = 3;

type RankedProvider = {
  provider: ProviderName;
  score: number;
  totalRuns: number;
};

function isProviderEligible(totalRuns: number): boolean {
  return totalRuns >= MIN_SAMPLE_SIZE;
}

function chooseLowestSampleUndertrainedProvider(input: {
  rankedProviders: RankedProvider[];
  firstProvider: ProviderName;
}): RankedProvider | null {
  const candidates = input.rankedProviders
    .filter(
      (entry) =>
        entry.provider !== input.firstProvider &&
        entry.totalRuns < LOW_SAMPLE_THRESHOLD
    )
    .sort((a, b) => {
      if (a.totalRuns !== b.totalRuns) {
        return a.totalRuns - b.totalRuns;
      }

      return b.score - a.score;
    });

  return candidates[0] ?? null;
}

function chooseSecondProvider(input: {
  rankedEligibleProviders: RankedProvider[];
  rankedProviders: RankedProvider[];
  firstProvider: ProviderName;
}): ProviderName {
  const { rankedEligibleProviders, rankedProviders, firstProvider } = input;

  const second = rankedEligibleProviders[1];
  const third = rankedEligibleProviders[2];

  const undertrainedProvider = chooseLowestSampleUndertrainedProvider({
    rankedProviders,
    firstProvider,
  });

  if (undertrainedProvider && Math.random() < LOW_SAMPLE_EXPLORATION_RATE) {
    return undertrainedProvider.provider;
  }

  if (!second) {
    return rankedEligibleProviders[0]!.provider;
  }

  if (!third) {
    return second.provider;
  }

  const shouldExplore = Math.random() < SECOND_PROVIDER_EXPLORATION_RATE;

  return shouldExplore ? third.provider : second.provider;
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

    const firstProvider = eligibleProviders[0]!.provider;
    const secondProvider = chooseSecondProvider({
      rankedEligibleProviders: eligibleProviders,
      rankedProviders,
      firstProvider,
    });

    const selectedProviders =
      firstProvider === secondProvider
        ? eligibleProviders.slice(0, 2).map((entry) => entry.provider)
        : [firstProvider, secondProvider];

    return { selectedProviders, selectionMode: "adaptive" };
  } catch {
    return { selectedProviders: fallbackProviders, selectionMode: "fallback" };
  }
}