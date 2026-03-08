import type { ProviderName } from "@/lib/routing/selectProviders";
import type { TaskType } from "@/lib/routing/providerProfiles";

export type ProviderDiagnostic = {
  provider: ProviderName;
  durationMs: number;
  timedOut: boolean;
  usedFallback: boolean;
};

export type SelectionMode = "manual" | "adaptive" | "fallback";

export type RunDiagnostic = {
  taskType: TaskType;
  selectedProviders: ProviderName[];
  selectionMode: SelectionMode;
  providerResults: ProviderDiagnostic[];
};

export function logRunDiagnostic(diagnostic: RunDiagnostic) {
  console.log("[RUN_DIAGNOSTIC]", JSON.stringify(diagnostic));
}