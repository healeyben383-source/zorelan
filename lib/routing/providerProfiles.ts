import type { ProviderName } from "@/lib/routing/selectProviders";

export type TaskType = "technical" | "strategy" | "creative" | "general";

export type ProviderProfile = {
  name: ProviderName;
  label: string;
  strengths: TaskType[];
  speedTier: "fast" | "medium" | "slow";
  costTier: "low" | "medium" | "high";
};

export const PROVIDER_PROFILES: ProviderProfile[] = [
  {
    name: "anthropic",
    label: "Anthropic Claude Sonnet",
    strengths: ["strategy", "creative", "general"],
    speedTier: "fast",
    costTier: "low",
  },
  {
    name: "perplexity",
    label: "Perplexity Sonar",
    strengths: ["technical", "strategy", "general"],
    speedTier: "fast",
    costTier: "low",
  },
  {
    name: "openai",
    label: "OpenAI GPT-4o mini",
    strengths: ["technical", "general"],
    speedTier: "fast",
    costTier: "low",
  },
];