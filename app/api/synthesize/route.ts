import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("synthesize_timeout")), ms)
    ),
  ]);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { prompt, openai: openaiAnswer, anthropic } = body;

    if (!prompt || !openaiAnswer || !anthropic) {
      return NextResponse.json({ ok: false, error: "missing_fields" }, { status: 400 });
    }

    const completion = await withTimeout(
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 1024,
        messages: [
          {
            role: "system",
            content: "You are a synthesis engine. You will be given a question and two AI responses to it. Your job is to combine the best insights from both into a single, superior answer. Be concise and direct. Do not mention that you are combining two answers. Just give the best possible answer.",
          },
          {
            role: "user",
            content: `Question: ${prompt}\n\nResponse A:\n${openaiAnswer}\n\nResponse B:\n${anthropic}`,
          },
        ],
      }),
      TIMEOUT_MS
    );

    const result = completion.choices[0]?.message?.content ?? "";

    if (!result) {
      return NextResponse.json({ ok: false, error: "empty_synthesis" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, synthesis: result });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown_error";
    console.error("[/api/synthesize] error:", message);

    const knownErrors: Record<string, number> = {
      missing_fields: 400,
      synthesize_timeout: 504,
      empty_synthesis: 500,
    };

    const status = knownErrors[message] ?? 500;
    const errorCode = knownErrors[message] ? message : "internal_error";

    return NextResponse.json({ ok: false, error: errorCode }, { status });
  }
}
