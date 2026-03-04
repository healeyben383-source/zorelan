import { NextRequest, NextResponse } from "next/server";
import { runOpenAI } from "../../../lib/providers/openai";
import { runAnthropic } from "../../../lib/providers/anthropic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const prompt: string = body?.prompt ?? "";

    if (!prompt) {
      return NextResponse.json({ ok: false, error: "empty_prompt" }, { status: 400 });
    }

    const [openai, anthropic] = await Promise.all([
      runOpenAI(prompt),
      runAnthropic(prompt),
    ]);

    return NextResponse.json({ ok: true, answers: { openai, anthropic } });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown_error";
    console.error("[/api/run] error:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}