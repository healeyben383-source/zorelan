import { NextRequest, NextResponse } from "next/server";
import { runOpenAI } from "@/lib/providers/openai";
import { runAnthropic } from "@/lib/providers/anthropic";
import { runPerplexity } from "@/lib/providers/perplexity";
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
  perplexity: string;
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
    perplexity: "",
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
        diagnostics.push({
          provider: "openai",
          durationMs: res.durationMs,
          timedOut: res.timedOut,
          usedFallback: res.usedFallback,
        });
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
        diagnostics.push({
          provider: "anthropic",
          durationMs: res.durationMs,
          timedOut: res.timedOut,
          usedFallback: res.usedFallback,
        });
      })
    );
  }

  if (selectedProviders.includes("perplexity")) {
    tasks.push(
      withTimeout(
        runPerplexity(prompt),
        PROVIDER_TIMEOUT_MS,
        "Perplexity timed out or failed to respond."
      ).then((res) => {
        results.perplexity = res.value;
        if (res.errorMessage) {
          console.error("[RUN_API] Perplexity failed", {
            error: res.errorMessage,
            durationMs: res.durationMs,
            timedOut: res.timedOut,
          });
        }
        diagnostics.push({
          provider: "perplexity",
          durationMs: res.durationMs,
          timedOut: res.timedOut,
          usedFallback: res.usedFallback,
        });
      })
    );
  }

  await Promise.all(tasks);
  return { results, diagnostics };
}

export async function POST(req: NextRequest) {
  try {
    const body: RunRequest = await req.json();

    if (!body.prompt || typeof body.prompt !== "string") {
      return NextResponse.json(
        {
          ok: false,
          error: "missing_prompt",
          answers: { openai: "", anthropic: "", perplexity: "" },
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
      const adaptiveSelection = await adaptiveSelectProviders(body.prompt, taskType);
      selectedProviders = adaptiveSelection.selectedProviders;
      selectionMode = adaptiveSelection.selectionMode;
    }

    const { results, diagnostics } = await routeProviders(
      body.prompt,
      selectedProviders
    );

    await Promise.all(
      diagnostics.map((diagnostic) =>
        updateProviderScore({
          taskType,
          provider: diagnostic.provider,
          durationMs: diagnostic.durationMs,
          timedOut: diagnostic.timedOut,
          usedFallback: diagnostic.usedFallback,
        })
      )
    );

    logRunDiagnostic({
      taskType,
      selectedProviders,
      selectionMode,
      providerResults: diagnostics,
    });

    const scores = await getProviderScores(taskType);
    console.log(
      "[PROVIDER_SCORES_UPDATED]",
      JSON.stringify({ taskType, selectedProviders, scores })
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
        answers: { openai: "", anthropic: "", perplexity: "" },
        selectedProviders: [] as ProviderName[],
      },
      { status: 500 }
    );
  }
}