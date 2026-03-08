import { PROVIDER_PROFILES, type TaskType } from "@/lib/routing/providerProfiles";

export type ProviderName = "openai" | "anthropic" | "perplexity";

export function detectTaskType(prompt: string): TaskType {
  const text = prompt.toLowerCase();

  const technicalKeywords = [
    "code",
    "debug",
    "typescript",
    "javascript",
    "next.js",
    "nextjs",
    "react",
    "api",
    "bug",
    "error",
    "server",
    "programming",
    "developer",
    "software",
  ];

  const strategyKeywords = [
    "strategy",
    "plan",
    "growth",
    "positioning",
    "marketing",
    "business",
    "pricing",
    "profit",
    "decision",
    "compare",
    "tradeoff",
    "framework",
  ];

  const creativeKeywords = [
    "write",
    "story",
    "creative",
    "script",
    "headline",
    "brand",
    "name",
    "slogan",
    "caption",
  ];

  const isTechnical = technicalKeywords.some((keyword) => text.includes(keyword));
  const isStrategy = strategyKeywords.some((keyword) => text.includes(keyword));
  const isCreative = creativeKeywords.some((keyword) => text.includes(keyword));

  if (isTechnical) return "technical";
  if (isStrategy) return "strategy";
  if (isCreative) return "creative";
  return "general";
}

export function selectProvidersFromPrompt(prompt: string): ProviderName[] {
  const taskType = detectTaskType(prompt);

  const matchedProviders = PROVIDER_PROFILES
    .filter((profile) => profile.strengths.includes(taskType))
    .map((profile) => profile.name as ProviderName);

  if (matchedProviders.length >= 2) {
    return matchedProviders.slice(0, 2);
  }

  if (matchedProviders.length === 1) {
    const fallbackProviders = PROVIDER_PROFILES
      .map((profile) => profile.name as ProviderName)
      .filter((name) => name !== matchedProviders[0]);

    return [matchedProviders[0], ...fallbackProviders].slice(0, 2);
  }

  return ["openai", "anthropic"];
}