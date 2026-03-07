import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { compareAnswers } from "@/lib/synthesis/compareAnswers";

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

function buildSystemPrompt(input: {
  agreementLevel: "high" | "medium" | "low";
  likelyConflict: boolean;
}) {
  if (input.agreementLevel === "high") {
    return [
      "You are a synthesis engine.",
      "You will be given a question and two AI responses.",
      "The responses are broadly aligned.",
      "Combine the best insights into a single superior answer.",
      "Be concise, direct, and remove duplication.",
      "Do not mention that you are combining two answers.",
      "Do not mention agreement level.",
      "Just give the best final answer.",
    ].join(" ");
  }

  if (input.agreementLevel === "medium") {
    return [
      "You are a synthesis engine.",
      "You will be given a question and two AI responses.",
      "The responses partially align but differ in emphasis.",
      "Produce a single strong answer that captures the shared core insight while preserving meaningful nuance.",
      "If one response adds an important caveat or tradeoff, retain it.",
      "Be concise and direct.",
      "Do not mention that you are combining two answers.",
      "Do not mention agreement level.",
      "Just give the best final answer.",
    ].join(" ");
  }

  return [
    "You are a synthesis engine.",
    "You will be given a question and two AI responses.",
    "The responses diverge or may conflict.",
    "Do not force a false consensus.",
    "Write a clear final answer that identifies the strongest shared ground, then preserves the key decision tradeoff or disagreement in a useful way.",
    "If the best answer depends on context, say so plainly.",
    "Be concise and direct.",
    "Do not mention that you are combining two answers.",
    "Do not mention agreement level.",
    "Just give the best final answer.",
  ].join(" ");
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { prompt, openai: openaiAnswer, anthropic } = body;

    if (!prompt || !openaiAnswer || !anthropic) {
      return NextResponse.json(
        { ok: false, error: "missing_fields" },
        { status: 400 }
      );
    }

    const comparison = compareAnswers(openaiAnswer, anthropic);

    console.log(
      "[SYNTHESIS_COMPARISON]",
      JSON.stringify({
        agreementLevel: comparison.agreementLevel,
        likelyConflict: comparison.likelyConflict,
        overlapRatio: comparison.overlapRatio,
        summary: comparison.summary,
      })
    );

    const systemPrompt = buildSystemPrompt({
      agreementLevel: comparison.agreementLevel,
      likelyConflict: comparison.likelyConflict,
    });

    const completion = await withTimeout(
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 1024,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: [
              `Question: ${prompt}`,
              "",
              `Agreement summary: ${comparison.summary}`,
              `Likely conflict: ${comparison.likelyConflict ? "yes" : "no"}`,
              "",
              "Response A:",
              openaiAnswer,
              "",
              "Response B:",
              anthropic,
            ].join("\n"),
          },
        ],
      }),
      TIMEOUT_MS
    );

    const result = completion.choices[0]?.message?.content ?? "";

    if (!result) {
      return NextResponse.json(
        { ok: false, error: "empty_synthesis" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      synthesis: result,
      comparison: {
        agreementLevel: comparison.agreementLevel,
        likelyConflict: comparison.likelyConflict,
        summary: comparison.summary,
      },
    });
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