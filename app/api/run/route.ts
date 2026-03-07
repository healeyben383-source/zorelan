import { NextRequest, NextResponse } from "next/server";
import { runOpenAI } from "@/lib/providers/openai";
import { runAnthropic } from "@/lib/providers/anthropic";
import {
  selectProvidersFromPrompt,
  detectTaskType,
  type ProviderName,
} from "@/lib/routing/selectProviders";
import { logRunDiagnostic, type ProviderDiagnostic } from "@/lib/routing/runDiagnostics";

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
  providers?: ProviderName[]
): Promise<{ results: RunResponse; diagnostics: ProviderDiagnostic[]; selectedProviders: ProviderName[] }> {
  const selectedProviders = providers ?? selectProvidersFromPrompt(prompt);

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
        diagnostics.push({
          provider: "anthropic",
          durationMs: res.durationMs,
          timedOut: res.timedOut,
          usedFallback: res.usedFallback,
        });
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

    const { results, diagnostics, selectedProviders } = await routeProviders(
      body.prompt,
      body.providers
    );

    logRunDiagnostic({
      taskType,
      selectedProviders,
      providerResults: diagnostics,
    });

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