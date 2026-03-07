import type { ProviderName } from "@/lib/routing/selectProviders";
import type { TaskType } from "@/lib/routing/providerProfiles";

export type ProviderDiagnostic = {
  provider: ProviderName;
  durationMs: number;
  timedOut: boolean;
  usedFallback: boolean;
};

export type RunDiagnostic = {
  taskType: TaskType;
  selectedProviders: ProviderName[];
  providerResults: ProviderDiagnostic[];
};

export function logRunDiagnostic(diagnostic: RunDiagnostic) {
  console.log("[RUN_DIAGNOSTIC]", JSON.stringify(diagnostic));
}