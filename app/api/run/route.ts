import { NextRequest, NextResponse } from "next/server";
import { runOpenAI } from "@/lib/providers/openai";
import { runAnthropic } from "@/lib/providers/anthropic";

export const runtime = "nodejs";

type RunRequest = {
  prompt: string;
  providers?: ("openai" | "anthropic")[];
};

type RunResponse = {
  openai: string;
  anthropic: string;
};

/**
 * Provider router
 * Default = both providers
 */
async function routeProviders(
  prompt: string,
  providers?: ("openai" | "anthropic")[]
): Promise<RunResponse> {
  const useProviders = providers ?? ["openai", "anthropic"];

  const results: RunResponse = {
    openai: "",
    anthropic: "",
  };

  const tasks: Promise<void>[] = [];

  if (useProviders.includes("openai")) {
    tasks.push(
      runOpenAI(prompt)
        .then((res) => {
          results.openai = res;
        })
        .catch(() => {
          results.openai = "OpenAI failed to respond.";
        })
    );
  }

  if (useProviders.includes("anthropic")) {
    tasks.push(
      runAnthropic(prompt)
        .then((res) => {
          results.anthropic = res;
        })
        .catch(() => {
          results.anthropic = "Anthropic failed to respond.";
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