import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { compareAnswers } from "@/lib/synthesis/compareAnswers";
import { updateProviderQualityScore } from "@/lib/routing/providerScores";
import { detectTaskType } from "@/lib/routing/selectProviders";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TIMEOUT_MS = 30_000;

type ProviderName = "openai" | "anthropic" | "gemini";
type AgreementLevel = "high" | "medium" | "low";

type AnswersPayload = {
  openai: string;
  anthropic: string;
  gemini: string;
};

type StructuredSynthesis = {
  finalAnswer: string;
  sharedConclusion: string;
  keyDifference: string;
  decisionRule: string;
  qualityScoreopenai?: number;
  qualityScoreanthropic?: number;
  qualityScoregemini?: number;
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("synthesize_timeout")), ms)
    ),
  ]);
}

function stripCodeFences(text: string): string {
  return text
    .replace(/```plaintext\s*/gi, "")
    .replace(/```json\s*/gi, "")
    .replace(/```markdown\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
}

function getProviderLabel(provider: ProviderName): string {
  switch (provider) {
    case "openai":
      return "OpenAI";
    case "anthropic":
      return "Anthropic";
    case "gemini":
      return "Gemini";
    default:
      return provider;
  }
}

function buildSynthesisSystemPrompt(input: {
  agreementLevel: AgreementLevel;
  likelyConflict: boolean;
}) {
  if (input.agreementLevel === "high") {
    return [
      "You are a synthesis engine.",
      "You will be given a question and two AI responses.",
      "The responses are broadly aligned.",
      "Your job is to combine the best insights from both into a single, superior answer.",
      "Write one strong final answer that is clear, useful, and well integrated.",
      "Remove duplication and keep the strongest reasoning.",
      "Be concise but complete.",
      "Do not mention that you are combining two answers.",
      "Do not mention agreement level.",
      "Just give the best possible final answer.",
    ].join(" ");
  }

  if (input.agreementLevel === "medium") {
    return [
      "You are a synthesis engine.",
      "You will be given a question and two AI responses.",
      "The responses partially align but differ in emphasis.",
      "Your job is to produce one strong final answer that captures the shared core insight while preserving important nuance, caveats, or tradeoffs.",
      "Write one integrated answer, not bullet fragments.",
      "Be concise but complete.",
      "Do not mention that you are combining two answers.",
      "Do not mention agreement level.",
      "Just give the best possible final answer.",
    ].join(" ");
  }

  return [
    "You are a synthesis engine.",
    "You will be given a question and two AI responses.",
    "The responses diverge or may conflict.",
    "Do not force a false consensus.",
    "Write one strong final answer that identifies the strongest shared ground, preserves the key disagreement or tradeoff, and gives the user a useful decision-oriented conclusion.",
    "If the best answer depends on context, say so plainly.",
    "Write one integrated answer, not bullet fragments.",
    "Be concise but complete.",
    "Do not mention that you are combining two answers.",
    "Do not mention agreement level.",
    "Just give the best possible final answer.",
  ].join(" ");
}

function buildStructuringSystemPrompt() {
  return [
    "You are a synthesis formatter.",
    "You will be given a question, a final synthesized answer, and a comparison summary.",
    "Your job is to extract a structured decision summary from the synthesis.",
    "Also rate the quality of each AI response from 1-10.",
    "Return valid JSON only.",
  ].join(" ");
}

function buildStructuringUserPrompt(input: {
  prompt: string;
  synthesis: string;
  agreementSummary: string;
  agreementLevel: AgreementLevel;
  likelyConflict: boolean;
  providerA: ProviderName;
  providerB: ProviderName;
}) {
  return [
    `Question: ${input.prompt}`,
    "",
    `Agreement summary: ${input.agreementSummary}`,
    `Agreement level: ${input.agreementLevel}`,
    `Likely conflict: ${input.likelyConflict ? "yes" : "no"}`,
    "",
    "Final synthesized answer:",
    input.synthesis,
    "",
    "Return JSON with exactly these keys:",
    "{",
    '  "finalAnswer": string,',
    '  "sharedConclusion": string,',
    '  "keyDifference": string,',
    '  "decisionRule": string,',
    `  "qualityScore${input.providerA}": number,`,
    `  "qualityScore${input.providerB}": number`,
    "}",
    "",
    "Rules:",
    "- finalAnswer should be the best concise direct answer to the question.",
    "- sharedConclusion should state what both model responses broadly agree on.",
    "- keyDifference should state the most important difference in emphasis or recommendation.",
    "- decisionRule should tell the user how to decide, or what context changes the answer.",
    `- qualityScore${input.providerA} should rate Response A's quality from 1-10 based on accuracy, depth, and usefulness.`,
    `- qualityScore${input.providerB} should rate Response B's quality from 1-10 based on accuracy, depth, and usefulness.`,
    "- Keep each field useful and concise.",
    "- Return JSON only with no markdown fences.",
  ].join("\n");
}

function isStructuredSynthesis(value: unknown): value is StructuredSynthesis {
  if (!value || typeof value !== "object") return false;

  const v = value as Record<string, unknown>;

  return (
    typeof v.finalAnswer === "string" &&
    typeof v.sharedConclusion === "string" &&
    typeof v.keyDifference === "string" &&
    typeof v.decisionRule === "string"
  );
}

function tryParseStructuredJson(raw: string): StructuredSynthesis | null {
  try {
    const cleaned = stripCodeFences(raw);
    const parsed = JSON.parse(cleaned);
    return isStructuredSynthesis(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function buildFallbackStructuredSynthesis(
  synthesis: string,
  comparison: {
    summary: string;
    agreementLevel: AgreementLevel;
  }
): StructuredSynthesis {
  return {
    finalAnswer: stripCodeFences(synthesis),
    sharedConclusion: comparison.summary,
    keyDifference:
      comparison.agreementLevel === "high"
        ? "The two responses were broadly aligned, with only minor differences in emphasis."
        : comparison.agreementLevel === "medium"
        ? "The two responses overlapped substantially but differed in emphasis, caveats, or framing."
        : "The two responses diverged meaningfully in recommendation or framing.",
    decisionRule:
      comparison.agreementLevel === "low"
        ? "Choose based on your context, constraints, and risk tolerance, because the strongest answer depends on which tradeoff matters most."
        : "Use the shared conclusion as the base answer, then adjust based on your specific context and constraints.",
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const prompt = body?.prompt;
    const selectedProviders = body?.selectedProviders as ProviderName[] | undefined;
    const answers = body?.answers as AnswersPayload | undefined;

    if (
      !prompt ||
      typeof prompt !== "string" ||
      !Array.isArray(selectedProviders) ||
      selectedProviders.length !== 2 ||
      !answers
    ) {
      return NextResponse.json(
        { ok: false, error: "missing_fields" },
        { status: 400 }
      );
    }

    const [providerA, providerB] = selectedProviders;
    const answerA = answers[providerA];
    const answerB = answers[providerB];

    if (!answerA || !answerB) {
      return NextResponse.json(
        { ok: false, error: "missing_fields" },
        { status: 400 }
      );
    }

    const comparison = compareAnswers(answerA, answerB);

    console.log(
      "[SYNTHESIS_COMPARISON]",
      JSON.stringify({
        selectedProviders,
        agreementLevel: comparison.agreementLevel,
        likelyConflict: comparison.likelyConflict,
        overlapRatio: comparison.overlapRatio,
        summary: comparison.summary,
      })
    );

    const synthesisCompletion = await withTimeout(
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 1024,
        messages: [
          {
            role: "system",
            content: buildSynthesisSystemPrompt({
              agreementLevel: comparison.agreementLevel,
              likelyConflict: comparison.likelyConflict,
            }),
          },
          {
            role: "user",
            content: [
              `Question: ${prompt}`,
              "",
              `Agreement summary: ${comparison.summary}`,
              `Likely conflict: ${comparison.likelyConflict ? "yes" : "no"}`,
              "",
              `Response A (${getProviderLabel(providerA)}):`,
              answerA,
              "",
              `Response B (${getProviderLabel(providerB)}):`,
              answerB,
            ].join("\n"),
          },
        ],
      }),
      TIMEOUT_MS
    );

    const rawSynthesis =
      synthesisCompletion.choices[0]?.message?.content?.trim() ?? "";

    const synthesis = stripCodeFences(rawSynthesis);

    if (!synthesis) {
      return NextResponse.json(
        { ok: false, error: "empty_synthesis" },
        { status: 500 }
      );
    }

    let structuredSynthesis: StructuredSynthesis | null = null;

    try {
      const structuringCompletion = await withTimeout(
        openai.chat.completions.create({
          model: "gpt-4o-mini",
          max_tokens: 600,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: buildStructuringSystemPrompt(),
            },
            {
              role: "user",
              content: buildStructuringUserPrompt({
                prompt,
                synthesis,
                agreementSummary: comparison.summary,
                agreementLevel: comparison.agreementLevel,
                likelyConflict: comparison.likelyConflict,
                providerA,
                providerB,
              }),
            },
          ],
        }),
        TIMEOUT_MS
      );

      const rawStructured =
        structuringCompletion.choices[0]?.message?.content ?? "";

      structuredSynthesis = tryParseStructuredJson(rawStructured);
    } catch (error) {
      console.error("[/api/synthesize] structuring_error:", error);
    }

    if (!structuredSynthesis) {
      structuredSynthesis = buildFallbackStructuredSynthesis(synthesis, {
        summary: comparison.summary,
        agreementLevel: comparison.agreementLevel,
      });
    }

    // Feed quality scores back into provider learning
    const taskType = detectTaskType(prompt);
    for (const provider of selectedProviders) {
      const key = `qualityScore${provider}` as keyof typeof structuredSynthesis;
      const score = structuredSynthesis[key];
      if (typeof score === "number") {
        updateProviderQualityScore({ taskType, provider, qualityScore: score });
        console.log("[QUALITY_SCORE]", { provider, taskType, score });
      }
    }

    return NextResponse.json({
      ok: true,
      synthesis,
      structuredSynthesis,
      comparison: {
        selectedProviders,
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
