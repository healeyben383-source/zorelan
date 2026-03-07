import { NextRequest, NextResponse } from "next/server";
import { runOpenAI } from "@/lib/providers/openai";
import { runAnthropic } from "@/lib/providers/anthropic";
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

const PROVIDER_TIMEOUT_MS = 20000;

type RunRequest = {
  prompt: string;
  providers?: ProviderName[];
};

type RunResponse = {
  openai: string;
  anthropic: string;
};

type TimedResult<T> = {
  value: T;
  durationMs: number;
  timedOut: boolean;
  usedFallback: boolean;
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
      .catch(() => {
        clearTimeout(timer);
        resolve({
          value: fallbackValue,
          durationMs: Date.now() - startedAt,
          timedOut: false,
          usedFallback: true,
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
  selectedProviders: ProviderName[];
}> {
  const results: RunResponse = {
    openai: "",
    anthropic: "",
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

  await Promise.all(tasks);

  return {
    results,
    diagnostics,
    selectedProviders,
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
          },
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
        scores: getProviderScores(taskType),
      })
    );

    return NextResponse.json({
      ok: true,
      answers: results,
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
        },
      },
      { status: 500 }
    );
  }
}