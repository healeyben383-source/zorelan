import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { buildSystemPrompt } from "../../../lib/prompts/builder";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function stripMarkdownFences(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function safeParseJSON(text: string): Record<string, unknown> {
  try {
    return JSON.parse(stripMarkdownFences(text));
  } catch {
    // fall through
  }
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {
      // fall through
    }
  }
  throw new Error("model_returned_invalid_json");
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const userInput: string = body?.input?.trim() ?? "";
    const mode: string = body?.mode ?? "execution";
    const context: string = body?.context ?? "general";

    if (!userInput) {
      return NextResponse.json({ ok: false, error: "empty_input" }, { status: 400 });
    }

    const systemPrompt = buildSystemPrompt(mode, context);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      max_tokens: 512,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userInput },
      ],
    });

    const choice = completion.choices[0];
    const finishReason = choice?.finish_reason;

    console.log("[/api/intent] finish_reason:", finishReason);

    if (finishReason === "length") {
      return NextResponse.json({ ok: false, error: "response_truncated" }, { status: 500 });
    }

    const raw = choice?.message?.content ?? "";
    console.log("[/api/intent] raw:", raw);

    if (!raw) {
      return NextResponse.json({ ok: false, error: "empty_output" }, { status: 500 });
    }

    const parsed = safeParseJSON(raw);
    return NextResponse.json({ ok: true, data: parsed });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown_error";
    console.error("[/api/intent] error:", message);
    const errorCode = message === "model_returned_invalid_json" ? "model_returned_invalid_json" : "internal_error";
    return NextResponse.json({ ok: false, error: errorCode }, { status: 500 });
  }
}