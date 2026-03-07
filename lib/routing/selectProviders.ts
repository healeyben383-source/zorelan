export type ProviderName = "openai" | "anthropic";

export function selectProvidersFromPrompt(prompt: string): ProviderName[] {
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

  // For now both providers still run.
  // These branches establish a scalable routing structure.
  if (isTechnical) {
    return ["openai", "anthropic"];
  }

  if (isStrategy) {
    return ["anthropic", "openai"];
  }

  if (isCreative) {
    return ["anthropic", "openai"];
  }

  return ["openai", "anthropic"];
}