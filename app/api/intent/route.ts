import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { buildSystemPrompt } from "../../../lib/prompts/builder";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("intent_timeout")), ms)
    ),
  ]);
}

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

    const completion = await withTimeout(
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.4,
        max_tokens: 512,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userInput },
        ],
      }),
      TIMEOUT_MS
    );

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

    // Scope-escalation guard: if the model reframed a simple explanatory prompt
    // into an evaluation/comparison task, override the goal with a category-aware
    // normalization derived from the raw user input.
    const SCOPE_ESCALATION_TOKENS = [
      "evaluate", "compare", "comparison", "model selection",
      "framework", "benchmark", "optimize", "tradeoff", "effectiveness of",
      "two different", "two models", "between two",
    ];
    const inputLower = userInput.toLowerCase();
    const userRequestedComparison = SCOPE_ESCALATION_TOKENS.some((t) => inputLower.includes(t));

    if (!userRequestedComparison) {
      const intentObj =
        typeof parsed.intent === "object" && parsed.intent !== null
          ? (parsed.intent as Record<string, unknown>)
          : null;
      if (intentObj && typeof intentObj.goal === "string") {
        const goalLower = intentObj.goal.toLowerCase();
        if (SCOPE_ESCALATION_TOKENS.some((t) => goalLower.includes(t))) {
          console.warn("[/api/intent] scope_escalation_detected — goal overridden:", intentObj.goal);
          const normalized = userInput.trim().toLowerCase().replace(/\?$/, "").trim();
          if (normalized.startsWith("why ") || normalized.startsWith("how ")) {
            intentObj.goal = `Explain ${normalized}`;
          } else if (normalized.startsWith("what is ")) {
            intentObj.goal = `Describe ${normalized.replace(/^what is\s+/, "")}`;
          } else if (normalized.startsWith("what are ")) {
            intentObj.goal = `Describe ${normalized.replace(/^what are\s+/, "")}`;
          } else {
            intentObj.goal = normalized.charAt(0).toUpperCase() + normalized.slice(1);
          }
        }
      }
    }

    return NextResponse.json({ ok: true, data: parsed });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown_error";
    console.error("[/api/intent] error:", message);

    const knownErrors: Record<string, number> = {
      empty_input: 400,
      intent_timeout: 504,
      model_returned_invalid_json: 500,
    };

    const status = knownErrors[message] ?? 500;
    const errorCode = knownErrors[message] ? message : "internal_error";

    return NextResponse.json({ ok: false, error: errorCode }, { status });
  }
}