import { PROVIDER_PROFILES, type TaskType } from "@/lib/routing/providerProfiles";

export type ProviderName = "openai" | "anthropic" | "perplexity";

type WeightedSignal = {
  phrase: string;
  weight: number;
};

const TECHNICAL_SIGNALS: WeightedSignal[] = [
  { phrase: "debug", weight: 4 },
  { phrase: "bug", weight: 4 },
  { phrase: "error", weight: 4 },
  { phrase: "stack trace", weight: 5 },
  { phrase: "typescript", weight: 4 },
  { phrase: "javascript", weight: 4 },
  { phrase: "next.js", weight: 4 },
  { phrase: "nextjs", weight: 4 },
  { phrase: "react", weight: 3 },
  { phrase: "api", weight: 3 },
  { phrase: "endpoint", weight: 3 },
  { phrase: "server", weight: 3 },
  { phrase: "backend", weight: 3 },
  { phrase: "frontend", weight: 3 },
  { phrase: "database", weight: 3 },
  { phrase: "sql", weight: 3 },
  { phrase: "query", weight: 2 },
  { phrase: "code", weight: 3 },
  { phrase: "coding", weight: 3 },
  { phrase: "programming", weight: 3 },
  { phrase: "developer", weight: 2 },
  { phrase: "software", weight: 2 },
  { phrase: "deploy", weight: 2 },
  { phrase: "deployment", weight: 2 },
  { phrase: "vercel", weight: 2 },
  { phrase: "redis", weight: 2 },
  { phrase: "supabase", weight: 2 },
  { phrase: "auth", weight: 2 },
  { phrase: "webhook", weight: 3 },
  { phrase: "route", weight: 2 },
  { phrase: "function", weight: 2 },
];

const STRATEGY_SIGNALS: WeightedSignal[] = [
  { phrase: "strategy", weight: 4 },
  { phrase: "plan", weight: 3 },
  { phrase: "roadmap", weight: 4 },
  { phrase: "growth", weight: 4 },
  { phrase: "positioning", weight: 4 },
  { phrase: "marketing", weight: 3 },
  { phrase: "business", weight: 3 },
  { phrase: "pricing", weight: 4 },
  { phrase: "profit", weight: 3 },
  { phrase: "monetization", weight: 4 },
  { phrase: "monetisation", weight: 4 },
  { phrase: "decision", weight: 3 },
  { phrase: "compare", weight: 2 },
  { phrase: "tradeoff", weight: 3 },
  { phrase: "trade-off", weight: 3 },
  { phrase: "framework", weight: 3 },
  { phrase: "prioritization", weight: 4 },
  { phrase: "prioritisation", weight: 4 },
  { phrase: "go to market", weight: 4 },
  { phrase: "go-to-market", weight: 4 },
  { phrase: "gtm", weight: 3 },
  { phrase: "acquisition", weight: 3 },
  { phrase: "retention", weight: 3 },
  { phrase: "audience", weight: 2 },
  { phrase: "offer", weight: 2 },
];

const CREATIVE_SIGNALS: WeightedSignal[] = [
  { phrase: "write", weight: 3 },
  { phrase: "rewrite", weight: 4 },
  { phrase: "story", weight: 4 },
  { phrase: "creative", weight: 3 },
  { phrase: "script", weight: 4 },
  { phrase: "headline", weight: 4 },
  { phrase: "brand name", weight: 4 },
  { phrase: "name ideas", weight: 4 },
  { phrase: "name", weight: 2 },
  { phrase: "slogan", weight: 4 },
  { phrase: "tagline", weight: 4 },
  { phrase: "caption", weight: 4 },
  { phrase: "copy", weight: 3 },
  { phrase: "poem", weight: 4 },
  { phrase: "lyrics", weight: 4 },
  { phrase: "draft", weight: 3 },
];

const TECHNICAL_HARD_TRIGGERS = [
  "debug",
  "bug",
  "error",
  "stack trace",
  "typescript",
  "javascript",
  "next.js",
  "nextjs",
  "react",
  "api",
  "database",
  "sql",
  "webhook",
  "redis",
  "supabase",
];

const STRATEGY_HARD_TRIGGERS = [
  "strategy",
  "pricing",
  "positioning",
  "roadmap",
  "growth",
  "monetization",
  "monetisation",
  "go-to-market",
  "go to market",
  "business model",
  "prioritization",
  "prioritisation",
];

const CREATIVE_HARD_TRIGGERS = [
  "rewrite",
  "story",
  "script",
  "headline",
  "brand name",
  "name ideas",
  "slogan",
  "tagline",
  "caption",
  "poem",
  "lyrics",
];

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasPhrase(text: string, phrase: string): boolean {
  const escaped = escapeRegex(phrase);

  if (/^[a-z0-9]+$/i.test(phrase)) {
    return new RegExp(`\\b${escaped}\\b`, "i").test(text);
  }

  return new RegExp(escaped, "i").test(text);
}

function scoreSignals(text: string, signals: WeightedSignal[]): number {
  return signals.reduce((total, signal) => {
    return total + (hasPhrase(text, signal.phrase) ? signal.weight : 0);
  }, 0);
}

function hasAnyPhrase(text: string, phrases: string[]): boolean {
  return phrases.some((phrase) => hasPhrase(text, phrase));
}

function rankTaskScores(scores: Record<TaskType, number>): Array<{
  taskType: TaskType;
  score: number;
}> {
  return (Object.entries(scores) as Array<[TaskType, number]>).sort((a, b) => {
    if (b[1] !== a[1]) {
      return b[1] - a[1];
    }

    const priority: TaskType[] = ["technical", "strategy", "creative", "general"];
    return priority.indexOf(a[0]) - priority.indexOf(b[0]);
  }).map(([taskType, score]) => ({ taskType, score }));
}

export function detectTaskType(prompt: string): TaskType {
  const text = normalizeText(prompt);

  if (!text) {
    return "general";
  }

  const scores: Record<TaskType, number> = {
    technical: scoreSignals(text, TECHNICAL_SIGNALS),
    strategy: scoreSignals(text, STRATEGY_SIGNALS),
    creative: scoreSignals(text, CREATIVE_SIGNALS),
    general: 0,
  };

  if (hasPhrase(text, "write code") || hasPhrase(text, "fix this code")) {
    scores.technical += 4;
  }

  if (hasPhrase(text, "business model") || hasPhrase(text, "pricing strategy")) {
    scores.strategy += 4;
  }

  if (
    hasPhrase(text, "write a headline") ||
    hasPhrase(text, "write a caption") ||
    hasPhrase(text, "brand name") ||
    hasPhrase(text, "name ideas")
  ) {
    scores.creative += 4;
  }

  const ranked = rankTaskScores(scores);
  const best = ranked[0];
  const second = ranked[1];

  if (!best || best.score === 0) {
    return "general";
  }

  const technicalHard = hasAnyPhrase(text, TECHNICAL_HARD_TRIGGERS);
  const strategyHard = hasAnyPhrase(text, STRATEGY_HARD_TRIGGERS);
  const creativeHard = hasAnyPhrase(text, CREATIVE_HARD_TRIGGERS);

  if (
    technicalHard &&
    scores.technical >= scores.strategy + 2 &&
    scores.technical >= scores.creative + 2
  ) {
    return "technical";
  }

  if (
    strategyHard &&
    scores.strategy >= scores.technical + 1 &&
    scores.strategy >= scores.creative + 1
  ) {
    return "strategy";
  }

  if (
    creativeHard &&
    scores.creative >= scores.technical &&
    scores.creative >= scores.strategy
  ) {
    return "creative";
  }

  if (best.score < 3) {
    return "general";
  }

  if (second && best.score - second.score <= 1 && best.score < 6) {
    return "general";
  }

  return best.taskType;
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