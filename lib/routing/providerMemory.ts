import type { ProviderName } from "@/lib/routing/selectProviders";
import type { TaskType } from "@/lib/routing/providerProfiles";

export type ProviderMemoryRecord = {
  provider: ProviderName;
  taskType: TaskType;
  totalRuns: number;
  successes: number;
  failures: number;
  timeouts: number;
  fallbacks: number;
  totalDurationMs: number;
};

type ProviderMemoryStore = Record<string, ProviderMemoryRecord>;

const memoryStore: ProviderMemoryStore = {};

function getKey(taskType: TaskType, provider: ProviderName) {
  return `${taskType}:${provider}`;
}

export function recordProviderOutcome(input: {
  provider: ProviderName;
  taskType: TaskType;
  durationMs: number;
  timedOut: boolean;
  usedFallback: boolean;
}) {
  const key = getKey(input.taskType, input.provider);

  if (!memoryStore[key]) {
    memoryStore[key] = {
      provider: input.provider,
      taskType: input.taskType,
      totalRuns: 0,
      successes: 0,
      failures: 0,
      timeouts: 0,
      fallbacks: 0,
      totalDurationMs: 0,
    };
  }

  const record = memoryStore[key];

  record.totalRuns += 1;
  record.totalDurationMs += input.durationMs;

  if (input.timedOut) {
    record.timeouts += 1;
    record.failures += 1;
  } else {
    record.successes += 1;
  }

  if (input.usedFallback) {
    record.fallbacks += 1;
  }
}

export function getProviderMemory(taskType?: TaskType) {
  const records = Object.values(memoryStore);

  if (!taskType) return records;

  return records.filter((r) => r.taskType === taskType);
}

export function getProviderScoresForTask(taskType: TaskType) {
  const records = getProviderMemory(taskType);

  return records.reduce<Record<ProviderName, {
    totalRuns: number;
    successRate: number;
    failureRate: number;
    timeoutRate: number;
    fallbackRate: number;
    averageDurationMs: number;
  }>>((acc, record) => {
    const total = Math.max(record.totalRuns, 1);

    acc[record.provider] = {
      totalRuns: record.totalRuns,
      successRate: record.successes / total,
      failureRate: record.failures / total,
      timeoutRate: record.timeouts / total,
      fallbackRate: record.fallbacks / total,
      averageDurationMs: Math.round(record.totalDurationMs / total),
    };

    return acc;
  }, {} as Record<ProviderName, {
    totalRuns: number;
    successRate: number;
    failureRate: number;
    timeoutRate: number;
    fallbackRate: number;
    averageDurationMs: number;
  }>);
}

export function resetProviderMemory() {
  for (const key of Object.keys(memoryStore)) {
    delete memoryStore[key];
  }
}