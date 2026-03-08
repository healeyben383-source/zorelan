import { NextRequest, NextResponse } from "next/server";
import { runOpenAI } from "@/lib/providers/openai";
import { runAnthropic } from "@/lib/providers/anthropic";
import { runGemini } from "@/lib/providers/gemini";
import {
  detectTaskType,
  type ProviderName,
} from "@/lib/routing/selectProviders";
import { adaptiveSelectProviders } from "@/lib/routing/adaptiveSelect";
import {
  logRunDiagnostic,
  type ProviderDiagnostic,
  type SelectionMode,
} from "@/lib/routing/runDiagnostics";
import {
  updateProviderScore,
  getProviderScores,
} from "@/lib/routing/providerScores";

export const runtime = "nodejs";

const PROVIDER_TIMEOUT_MS = 30000;

type RunRequest = {
  prompt: string;
  providers?: ProviderName[];
};

type RunResponse = {
  openai: string;
  anthropic: string;
  gemini: string;
};

type TimedResult<T> = {
  value: T;
  durationMs: number;
  timedOut: boolean;
  usedFallback: boolean;
  errorMessage?: string;
};

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallbackValue: T
): Promise<TimedResult<T>> {
  return new Promise((resolve) => {
    const startedAt = Date.now();

    const timer = setTimeout(() => {
      resolve({
        value: fallbackValue,
        durationMs: Date.now() - startedAt,
        timedOut: true,
        usedFallback: true,
        errorMessage: "timeout",
      });
    }, ms);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve({
          value,
          durationMs: Date.now() - startedAt,
          timedOut: false,
          usedFallback: false,
        });
      })
      .catch((error) => {
        clearTimeout(timer);

        const errorMessage =
          error instanceof Error ? error.message : "Unknown provider error";

        resolve({
          value: fallbackValue,
          durationMs: Date.now() - startedAt,
          timedOut: false,
          usedFallback: true,
          errorMessage,
        });
      });
  });
}

async function routeProviders(
  prompt: string,
  selectedProviders: ProviderName[]
): Promise<{
  results: RunResponse;
  diagnostics: ProviderDiagnostic[];
}> {
  const results: RunResponse = {
    openai: "",
    anthropic: "",
    gemini: "",
  };

  const diagnostics: ProviderDiagnostic[] = [];
  const tasks: Promise<void>[] = [];

  if (selectedProviders.includes("openai")) {
    tasks.push(
      withTimeout(
        runOpenAI(prompt),
        PROVIDER_TIMEOUT_MS,
        "OpenAI timed out or failed to respond."
      ).then((res) => {
        results.openai = res.value;

        if (res.errorMessage) {
          console.error("[RUN_API] OpenAI failed", {
            error: res.errorMessage,
            durationMs: res.durationMs,
            timedOut: res.timedOut,
          });
        }

        const diagnostic: ProviderDiagnostic = {
          provider: "openai",
          durationMs: res.durationMs,
          timedOut: res.timedOut,
          usedFallback: res.usedFallback,
        };

        diagnostics.push(diagnostic);
      })
    );
  }

  if (selectedProviders.includes("anthropic")) {
    tasks.push(
      withTimeout(
        runAnthropic(prompt),
        PROVIDER_TIMEOUT_MS,
        "Anthropic timed out or failed to respond."
      ).then((res) => {
        results.anthropic = res.value;

        if (res.errorMessage) {
          console.error("[RUN_API] Anthropic failed", {
            error: res.errorMessage,
            durationMs: res.durationMs,
            timedOut: res.timedOut,
          });
        }

        const diagnostic: ProviderDiagnostic = {
          provider: "anthropic",
          durationMs: res.durationMs,
          timedOut: res.timedOut,
          usedFallback: res.usedFallback,
        };

        diagnostics.push(diagnostic);
      })
    );
  }

  if (selectedProviders.includes("gemini")) {
    tasks.push(
      withTimeout(
        runGemini({ prompt }),
        PROVIDER_TIMEOUT_MS,
        "Gemini timed out or failed to respond."
      ).then((res) => {
        results.gemini = res.value;

        if (res.errorMessage) {
          console.error("[RUN_API] Gemini failed", {
            error: res.errorMessage,
            durationMs: res.durationMs,
            timedOut: res.timedOut,
          });
        }

        const diagnostic: ProviderDiagnostic = {
          provider: "gemini",
          durationMs: res.durationMs,
          timedOut: res.timedOut,
          usedFallback: res.usedFallback,
        };

        diagnostics.push(diagnostic);
      })
    );
  }

  await Promise.all(tasks);

  return {
    results,
    diagnostics,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body: RunRequest = await req.json();

    if (!body.prompt || typeof body.prompt !== "string") {
      return NextResponse.json(
        {
          ok: false,
          error: "missing_prompt",
          answers: {
            openai: "",
            anthropic: "",
            gemini: "",
          },
          selectedProviders: [] as ProviderName[],
        },
        { status: 400 }
      );
    }

    const taskType = detectTaskType(body.prompt);

    let selectedProviders: ProviderName[];
    let selectionMode: SelectionMode;

    if (body.providers && body.providers.length > 0) {
      selectedProviders = body.providers;
      selectionMode = "manual";
    } else {
      const adaptiveSelection = adaptiveSelectProviders(body.prompt, taskType);
      selectedProviders = adaptiveSelection.selectedProviders;
      selectionMode = adaptiveSelection.selectionMode;
    }

    const { results, diagnostics } = await routeProviders(
      body.prompt,
      selectedProviders
    );

    for (const diagnostic of diagnostics) {
      updateProviderScore({
        taskType,
        provider: diagnostic.provider,
        durationMs: diagnostic.durationMs,
        timedOut: diagnostic.timedOut,
        usedFallback: diagnostic.usedFallback,
      });
    }

    logRunDiagnostic({
      taskType,
      selectedProviders,
      selectionMode,
      providerResults: diagnostics,
    });

    console.log(
      "[PROVIDER_SCORES_UPDATED]",
      JSON.stringify({
        taskType,
        selectedProviders,
        scores: getProviderScores(taskType),
      })
    );

    return NextResponse.json({
      ok: true,
      answers: results,
      selectedProviders,
    });
  } catch (error) {
    console.error("RUN API ERROR:", error);

    return NextResponse.json(
      {
        ok: false,
        error: "server_error",
        answers: {
          openai: "",
          anthropic: "",
          gemini: "",
        },
        selectedProviders: [] as ProviderName[],
      },
      { status: 500 }
    );
  }
}