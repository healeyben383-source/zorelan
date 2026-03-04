import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { prompt, openai: openaiAnswer, anthropic } = body;

    if (!prompt || !openaiAnswer || !anthropic) {
      return NextResponse.json({ ok: false, error: "missing_fields" }, { status: 400 });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 1024,
      messages: [
        {
          role: "system",
          content: `You are a synthesis engine. You will be given a question and two AI responses to it. Your job is to combine the best insights from both into a single, superior answer. Be concise and direct. Do not mention that you are combining two answers. Just give the best possible answer.`,
        },
        {
          role: "user",
          content: `Question: ${prompt}\n\nResponse A:\n${openaiAnswer}\n\nResponse B:\n${anthropic}`,
        },
      ],
    });

    const result = completion.choices[0]?.message?.content ?? "";
    return NextResponse.json({ ok: true, synthesis: result });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown_error";
    console.error("[/api/synthesize] error:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}