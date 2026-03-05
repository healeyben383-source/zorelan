import { NextRequest, NextResponse } from "next/server";
import { runOpenAI } from "../../../lib/providers/openai";
import { runAnthropic } from "../../../lib/providers/anthropic";

const TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label}_timeout`)), ms)
    ),
  ]);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const prompt: string = body?.prompt ?? "";

    if (!prompt) {
      return NextResponse.json({ ok: false, error: "empty_prompt" }, { status: 400 });
    }

    const [openaiResult, anthropicResult] = await Promise.allSettled([
      withTimeout(runOpenAI(prompt), TIMEOUT_MS, "openai"),
      withTimeout(runAnthropic(prompt), TIMEOUT_MS, "anthropic"),
    ]);

    const openai =
      openaiResult.status === "fulfilled"
        ? openaiResult.value
        : `[OpenAI error: ${openaiResult.reason?.message ?? "unknown"}]`;

    const anthropic =
      anthropicResult.status === "fulfilled"
        ? anthropicResult.value
        : `[Anthropic error: ${anthropicResult.reason?.message ?? "unknown"}]`;

    if (openaiResult.status === "rejected" && anthropicResult.status === "rejected") {
      console.error("[/api/run] both models failed:", openaiResult.reason, anthropicResult.reason);
      return NextResponse.json({ ok: false, error: "both_models_failed" }, { status: 500 });
    }

    const partial = openaiResult.status === "rejected" || anthropicResult.status === "rejected";
    if (partial) {
      console.warn("[/api/run] one model failed — returning partial result");
    }

    return NextResponse.json({ ok: true, partial, answers: { openai, anthropic } });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown_error";
    console.error("[/api/run] error:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}