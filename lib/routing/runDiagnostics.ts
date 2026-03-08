import type { ProviderName } from "@/lib/routing/selectProviders";
import type { TaskType } from "@/lib/routing/providerProfiles";
import {
  recordProviderOutcome,
  getProviderScoresForTask,
} from "@/lib/routing/providerMemory";

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

  for (const result of diagnostic.providerResults) {
    recordProviderOutcome({
      provider: result.provider,
      taskType: diagnostic.taskType,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      usedFallback: result.usedFallback,
    });
  }

  console.log(
    "[PROVIDER_SCORES_UPDATED]",
    JSON.stringify({
      taskType: diagnostic.taskType,
      scores: getProviderScoresForTask(diagnostic.taskType),
    })
  );
}