import { NextRequest, NextResponse } from "next/server";
import { runOpenAI } from "@/lib/providers/openai";
import { runAnthropic } from "@/lib/providers/anthropic";

export const runtime = "nodejs";

const PROVIDER_TIMEOUT_MS = 20000;

type ProviderName = "openai" | "anthropic";

type RunRequest = {
  prompt: string;
  providers?: ProviderName[];
};

type RunResponse = {
  openai: string;
  anthropic: string;
};

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallbackValue: T
): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallbackValue), ms);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(fallbackValue);
      });
  });
}

function selectProvidersFromPrompt(prompt: string): ProviderName[] {
  const text = prompt.toLowerCase();

  const technicalKeywords = [
    "code",
    "debug",
    "typescript",
    "javascript",
    "next.js",
    "nextjs",
    "react",
    "api",
    "bug",
    "error",
    "server",
    "programming",
    "developer",
    "software",
  ];

  const strategyKeywords = [
    "strategy",
    "plan",
    "growth",
    "positioning",
    "marketing",
    "business",
    "pricing",
    "profit",
    "decision",
    "compare",
    "tradeoff",
    "framework",
  ];

  const creativeKeywords = [
    "write",
    "story",
    "creative",
    "script",
    "headline",
    "brand",
    "name",
    "slogan",
    "caption",
  ];

  const isTechnical = technicalKeywords.some((keyword) => text.includes(keyword));
  const isStrategy = strategyKeywords.some((keyword) => text.includes(keyword));
  const isCreative = creativeKeywords.some((keyword) => text.includes(keyword));

  // For now both providers still run.
  // These branches exist to establish routing structure safely.
  if (isTechnical) {
    return ["openai", "anthropic"];
  }

  if (isStrategy) {
    return ["anthropic", "openai"];
  }

  if (isCreative) {
    return ["anthropic", "openai"];
  }

  return ["openai", "anthropic"];
}

async function routeProviders(
  prompt: string,
  providers?: ProviderName[]
): Promise<RunResponse> {
  const useProviders = providers ?? selectProvidersFromPrompt(prompt);

  const results: RunResponse = {
    openai: "",
    anthropic: "",
  };

  const tasks: Promise<void>[] = [];

  if (useProviders.includes("openai")) {
    tasks.push(
      withTimeout(
        runOpenAI(prompt),
        PROVIDER_TIMEOUT_MS,
        "OpenAI timed out or failed to respond."
      ).then((res) => {
        results.openai = res;
      })
    );
  }

  if (useProviders.includes("anthropic")) {
    tasks.push(
      withTimeout(
        runAnthropic(prompt),
        PROVIDER_TIMEOUT_MS,
        "Anthropic timed out or failed to respond."
      ).then((res) => {
        results.anthropic = res;
      })
    );
  }

  await Promise.all(tasks);
  return results;
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

    const results = await routeProviders(body.prompt, body.providers);

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