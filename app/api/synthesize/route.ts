import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { compareAnswers } from "@/lib/synthesis/compareAnswers";
import { updateProviderQualityScore } from "@/lib/routing/providerScores";
import { detectTaskType } from "@/lib/routing/selectProviders";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TIMEOUT_MS = 30_000;

type ProviderName = "openai" | "anthropic" | "perplexity";
type AgreementLevel = "high" | "medium" | "low";
type RiskLevel = "low" | "moderate" | "high";
type TrustLabel = "high" | "moderate" | "low";
type DisagreementType =
  | "none"
  | "additive_nuance"
  | "explanation_variation"
  | "conditional_alignment"
  | "material_conflict";

type AnswersPayload = {
  openai: string;
  anthropic: string;
  perplexity: string;
};

type StructuredSynthesis = {
  finalAnswer: string;
  sharedConclusion: string;
  keyDifference: string;
  decisionRule: string;
  qualityScoreopenai?: number;
  qualityScoreanthropic?: number;
  qualityScoreperplexity?: number;
};

type DecisionVerification = {
  verdict: string;
  consensus: {
    level: AgreementLevel;
    modelsAligned: number;
  };
  riskLevel: RiskLevel;
  keyDisagreement: string;
  recommendedAction: string;
  finalConclusionAligned: boolean;
  disagreementType: DisagreementType;
};

type TrustScore = {
  score: number;
  label: TrustLabel;
  reason: string;
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
    case "perplexity":
      return "Perplexity";
    default:
      return provider;
  }
}

function isDisagreementType(value: unknown): value is DisagreementType {
  return (
    value === "none" ||
    value === "additive_nuance" ||
    value === "explanation_variation" ||
    value === "conditional_alignment" ||
    value === "material_conflict"
  );
}

function inferFallbackClassification(input: {
  agreementLevel: AgreementLevel;
  likelyConflict: boolean;
}): {
  finalConclusionAligned: boolean;
  disagreementType: DisagreementType;
} {
  if (input.agreementLevel === "high") {
    return {
      finalConclusionAligned: true,
      disagreementType: "none",
    };
  }

  if (input.agreementLevel === "medium") {
    if (input.likelyConflict) {
      return {
        finalConclusionAligned: false,
        disagreementType: "conditional_alignment",
      };
    }

    return {
      finalConclusionAligned: true,
      disagreementType: "additive_nuance",
    };
  }

  return {
    finalConclusionAligned: false,
    disagreementType: "material_conflict",
  };
}

function getModelsAligned(input: {
  totalProviders: number;
  agreementLevel: AgreementLevel;
  finalConclusionAligned: boolean;
  disagreementType: DisagreementType;
}): number {
  if (input.totalProviders <= 1) {
    return input.totalProviders;
  }

  switch (input.disagreementType) {
    case "none":
    case "additive_nuance":
    case "explanation_variation":
      return input.totalProviders;

    case "conditional_alignment":
      return Math.max(1, input.totalProviders - 1);

    case "material_conflict":
      return 0;

    default:
      if (input.finalConclusionAligned) {
        return input.totalProviders;
      }

      if (input.agreementLevel === "medium") {
        return Math.max(1, input.totalProviders - 1);
      }

      return 0;
  }
}

function getConsensusLevelFromAligned(
  modelsAligned: number,
  totalProviders: number
): AgreementLevel {
  if (modelsAligned >= totalProviders) {
    return "high";
  }

  if (modelsAligned > 0) {
    return "medium";
  }

  return "low";
}

function getRiskLevel(input: {
  agreementLevel: AgreementLevel;
  disagreementType: DisagreementType;
  finalConclusionAligned: boolean;
}): RiskLevel {
  if (input.disagreementType === "material_conflict") {
    return "high";
  }

  if (input.disagreementType === "conditional_alignment") {
    return "moderate";
  }

  if (!input.finalConclusionAligned && input.agreementLevel === "low") {
    return "high";
  }

  if (!input.finalConclusionAligned) {
    return "moderate";
  }

  if (input.agreementLevel === "low") {
    return "moderate";
  }

  return "low";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function averageQualityScore(
  structuredSynthesis: StructuredSynthesis,
  selectedProviders: ProviderName[]
): number {
  const scores = selectedProviders
    .map((provider) => {
      const key = `qualityScore${provider}` as keyof StructuredSynthesis;
      const value = structuredSynthesis[key];
      return typeof value === "number" ? value : null;
    })
    .filter((value): value is number => value !== null);

  if (scores.length === 0) {
    return 7;
  }

  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}

function getAgreementBaseScore(agreementLevel: AgreementLevel): number {
  if (agreementLevel === "high") return 90;
  if (agreementLevel === "medium") return 74;
  return 42;
}

function getTrustLabel(score: number): TrustLabel {
  if (score >= 80) return "high";
  if (score >= 60) return "moderate";
  return "low";
}

function buildTrustReason(input: {
  agreementLevel: AgreementLevel;
  disagreementType: DisagreementType;
  finalConclusionAligned: boolean;
  averageQuality: number;
  riskLevel: RiskLevel;
}): string {
  const agreementText =
    input.agreementLevel === "high"
      ? "Models strongly agree on the core conclusion"
      : input.agreementLevel === "medium"
      ? "Models partially align on the core conclusion"
      : "Models diverge on the core conclusion";

  const qualityText =
    input.averageQuality >= 8
      ? "provider output quality is strong"
      : input.averageQuality >= 6.5
      ? "provider output quality is solid"
      : "provider output quality is mixed";

  const disagreementText =
    input.disagreementType === "none"
      ? "with no meaningful disagreement"
      : input.disagreementType === "additive_nuance"
      ? "with only additive nuance"
      : input.disagreementType === "explanation_variation"
      ? "with variation in explanation"
      : input.disagreementType === "conditional_alignment"
      ? "with context-dependent conditional alignment"
      : "with material conflict between responses";

  const riskText =
    input.riskLevel === "low"
      ? "overall risk is low."
      : input.riskLevel === "moderate"
      ? "overall risk is moderate."
      : "overall risk is elevated.";

  const alignmentText = input.finalConclusionAligned
    ? "The original answers support the same main conclusion,"
    : "The original answers do not cleanly support the same main conclusion,";

  return `${alignmentText} ${agreementText}, ${qualityText}, ${disagreementText}; ${riskText}`;
}

function calculateTrustScore(input: {
  agreementLevel: AgreementLevel;
  disagreementType: DisagreementType;
  finalConclusionAligned: boolean;
  averageQuality: number;
  riskLevel: RiskLevel;
}): TrustScore {
  const agreementBase = getAgreementBaseScore(input.agreementLevel);
  const qualityNormalized = input.averageQuality * 10;

  let score = agreementBase * 0.55 + qualityNormalized * 0.3 + 100 * 0.15;

  if (!input.finalConclusionAligned) {
    score -= 12;
  }

  if (input.disagreementType === "explanation_variation") {
    score -= 4;
  } else if (input.disagreementType === "conditional_alignment") {
    score -= 10;
  } else if (input.disagreementType === "material_conflict") {
    score -= 18;
  }

  if (input.riskLevel === "moderate") {
    score -= 4;
  } else if (input.riskLevel === "high") {
    score -= 12;
  }

  const isStrongAlignedCase =
    input.finalConclusionAligned &&
    input.agreementLevel === "high" &&
    input.riskLevel === "low" &&
    input.averageQuality >= 7 &&
    (input.disagreementType === "none" ||
      input.disagreementType === "additive_nuance" ||
      input.disagreementType === "explanation_variation");

  if (isStrongAlignedCase) {
    score = Math.max(score, 84);
  }

  const finalScore = Math.round(clamp(score, 0, 100));

  return {
    score: finalScore,
    label: getTrustLabel(finalScore),
    reason: buildTrustReason({
      agreementLevel: input.agreementLevel,
      disagreementType: input.disagreementType,
      finalConclusionAligned: input.finalConclusionAligned,
      averageQuality: input.averageQuality,
      riskLevel: input.riskLevel,
    }),
  };
}

function buildSynthesisSystemPrompt(input: {
  agreementLevel: AgreementLevel;
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

function buildVerificationSystemPrompt() {
  return [
    "You are a decision-verification engine.",
    "You will be given a question, the two original model responses, a synthesized answer, and a structured summary.",
    "Judge alignment from the original responses first.",
    "The synthesized answer is a summary aid, not proof that the original responses aligned.",
    "Return valid JSON only.",
    "Use this exact shape:",
    '{"verdict":"string","keyDisagreement":"string","recommendedAction":"string","finalConclusionAligned":boolean,"disagreementType":"none|additive_nuance|explanation_variation|conditional_alignment|material_conflict"}',
    "Rules:",
    "- verdict should be a concise decision-oriented conclusion.",
    "- keyDisagreement should capture the main tension, tradeoff, or area of nuance between the two responses.",
    "- recommendedAction should be a practical next step.",
    "- finalConclusionAligned should be true only when both original responses support the same main conclusion.",
    "- disagreementType must be one of: none, additive_nuance, explanation_variation, conditional_alignment, material_conflict.",
    "- Use additive_nuance when one response mostly adds correct detail without changing the core conclusion.",
    "- Use explanation_variation when both responses support the same conclusion but differ in framing, emphasis, or supporting reasoning.",
    "- Use conditional_alignment when a usable combined takeaway exists only by adding conditions, context, or tradeoffs, but the original responses do not cleanly support the same main conclusion.",
    "- Use material_conflict only when the main recommendation, conclusion, or decision materially differs.",
    "- Keep all fields concise and useful.",
  ].join(" ");
}

function buildVerificationUserPrompt(input: {
  prompt: string;
  answerA: string;
  answerB: string;
  providerA: ProviderName;
  providerB: ProviderName;
  synthesis: string;
  structuredSynthesis: StructuredSynthesis;
  agreementLevel: AgreementLevel;
  likelyConflict: boolean;
}) {
  return [
    `Question: ${input.prompt}`,
    "",
    `Agreement level: ${input.agreementLevel}`,
    `Likely conflict: ${input.likelyConflict ? "yes" : "no"}`,
    "",
    `Response A (${getProviderLabel(input.providerA)}):`,
    input.answerA,
    "",
    `Response B (${getProviderLabel(input.providerB)}):`,
    input.answerB,
    "",
    "Synthesized answer:",
    input.synthesis,
    "",
    "Structured summary:",
    JSON.stringify(
      {
        finalAnswer: input.structuredSynthesis.finalAnswer,
        sharedConclusion: input.structuredSynthesis.sharedConclusion,
        keyDifference: input.structuredSynthesis.keyDifference,
        decisionRule: input.structuredSynthesis.decisionRule,
      },
      null,
      2
    ),
    "",
    "Classify whether the two original model responses align on the main conclusion.",
    "Do not let a good merged synthesis upgrade disagreement into agreement.",
    "Do not treat minor supporting detail or added context as material conflict.",
    "",
    "Return JSON only.",
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

function tryParseDecisionVerification(raw: string): {
  verdict: string;
  keyDisagreement: string;
  recommendedAction: string;
  finalConclusionAligned: boolean;
  disagreementType: DisagreementType;
} | null {
  try {
    const cleaned = stripCodeFences(raw);
    const parsed = JSON.parse(cleaned);

    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.verdict !== "string" ||
      typeof parsed.keyDisagreement !== "string" ||
      typeof parsed.recommendedAction !== "string" ||
      typeof parsed.finalConclusionAligned !== "boolean" ||
      !isDisagreementType(parsed.disagreementType)
    ) {
      return null;
    }

    return {
      verdict: parsed.verdict.trim(),
      keyDisagreement: parsed.keyDisagreement.trim(),
      recommendedAction: parsed.recommendedAction.trim(),
      finalConclusionAligned: parsed.finalConclusionAligned,
      disagreementType: parsed.disagreementType,
    };
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

function buildFallbackDecisionVerification(input: {
  structuredSynthesis: StructuredSynthesis;
  agreementLevel: AgreementLevel;
  likelyConflict: boolean;
  totalProviders: number;
}): DecisionVerification {
  const fallback = inferFallbackClassification({
    agreementLevel: input.agreementLevel,
    likelyConflict: input.likelyConflict,
  });

  const modelsAligned = getModelsAligned({
    totalProviders: input.totalProviders,
    agreementLevel: input.agreementLevel,
    finalConclusionAligned: fallback.finalConclusionAligned,
    disagreementType: fallback.disagreementType,
  });

  const consensusLevel = getConsensusLevelFromAligned(
    modelsAligned,
    input.totalProviders
  );

  return {
    verdict: input.structuredSynthesis.finalAnswer,
    consensus: {
      level: consensusLevel,
      modelsAligned,
    },
    riskLevel: getRiskLevel({
      agreementLevel: input.agreementLevel,
      disagreementType: fallback.disagreementType,
      finalConclusionAligned: fallback.finalConclusionAligned,
    }),
    keyDisagreement:
      fallback.disagreementType === "conditional_alignment"
        ? "A usable answer depends on context, conditions, or tradeoffs."
        : input.structuredSynthesis.keyDifference,
    recommendedAction:
      fallback.disagreementType === "conditional_alignment"
        ? "Choose based on the conditions or tradeoffs that matter most in your context."
        : input.structuredSynthesis.decisionRule,
    finalConclusionAligned: fallback.finalConclusionAligned,
    disagreementType: fallback.disagreementType,
  };
}

async function buildDecisionVerification(input: {
  prompt: string;
  answerA: string;
  answerB: string;
  providerA: ProviderName;
  providerB: ProviderName;
  synthesis: string;
  structuredSynthesis: StructuredSynthesis;
  agreementLevel: AgreementLevel;
  likelyConflict: boolean;
  totalProviders: number;
}): Promise<DecisionVerification> {
  try {
    const verificationCompletion = await withTimeout(
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 240,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: buildVerificationSystemPrompt(),
          },
          {
            role: "user",
            content: buildVerificationUserPrompt(input),
          },
        ],
      }),
      TIMEOUT_MS
    );

    const raw = verificationCompletion.choices[0]?.message?.content ?? "{}";
    const parsed = tryParseDecisionVerification(raw);

    if (parsed) {
      const modelsAligned = getModelsAligned({
        totalProviders: input.totalProviders,
        agreementLevel: input.agreementLevel,
        finalConclusionAligned: parsed.finalConclusionAligned,
        disagreementType: parsed.disagreementType,
      });

      const consensusLevel = getConsensusLevelFromAligned(
        modelsAligned,
        input.totalProviders
      );

      return {
        verdict: parsed.verdict || input.structuredSynthesis.finalAnswer,
        consensus: {
          level: consensusLevel,
          modelsAligned,
        },
        riskLevel: getRiskLevel({
          agreementLevel: input.agreementLevel,
          disagreementType: parsed.disagreementType,
          finalConclusionAligned: parsed.finalConclusionAligned,
        }),
        keyDisagreement:
          parsed.keyDisagreement ||
          (parsed.disagreementType === "conditional_alignment"
            ? "A usable answer depends on context, conditions, or tradeoffs."
            : input.structuredSynthesis.keyDifference),
        recommendedAction:
          parsed.recommendedAction ||
          (parsed.disagreementType === "conditional_alignment"
            ? "Choose based on the conditions or tradeoffs that matter most in your context."
            : input.structuredSynthesis.decisionRule),
        finalConclusionAligned: parsed.finalConclusionAligned,
        disagreementType: parsed.disagreementType,
      };
    }
  } catch (error) {
    console.error("[/api/synthesize] verification_error:", error);
  }

  return buildFallbackDecisionVerification({
    structuredSynthesis: input.structuredSynthesis,
    agreementLevel: input.agreementLevel,
    likelyConflict: input.likelyConflict,
    totalProviders: input.totalProviders,
  });
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
        max_tokens: 400,
        messages: [
          {
            role: "system",
            content: buildSynthesisSystemPrompt({
              agreementLevel: comparison.agreementLevel,
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

    const decisionVerification = await buildDecisionVerification({
      prompt,
      answerA,
      answerB,
      providerA,
      providerB,
      synthesis,
      structuredSynthesis,
      agreementLevel: comparison.agreementLevel,
      likelyConflict: comparison.likelyConflict,
      totalProviders: selectedProviders.length,
    });

    const taskType = detectTaskType(prompt);

    await Promise.all(
      selectedProviders.map(async (provider) => {
        const key = `qualityScore${provider}` as keyof typeof structuredSynthesis;
        const score = structuredSynthesis[key];
        if (typeof score === "number") {
          await updateProviderQualityScore({
            taskType,
            provider,
            qualityScore: score,
          });
          console.log("[QUALITY_SCORE]", { provider, taskType, score });
        }
      })
    );

    const trustScore = calculateTrustScore({
      agreementLevel: comparison.agreementLevel,
      disagreementType: decisionVerification.disagreementType,
      finalConclusionAligned: decisionVerification.finalConclusionAligned,
      averageQuality: averageQualityScore(
        structuredSynthesis,
        selectedProviders
      ),
      riskLevel: decisionVerification.riskLevel,
    });

    return NextResponse.json({
      ok: true,
      synthesis,
      structuredSynthesis,
      decisionVerification: {
        verdict: decisionVerification.verdict,
        consensus: {
          level: decisionVerification.consensus.level,
          modelsAligned: decisionVerification.consensus.modelsAligned,
        },
        riskLevel: decisionVerification.riskLevel,
        keyDisagreement: decisionVerification.keyDisagreement,
        recommendedAction: decisionVerification.recommendedAction,
        finalConclusionAligned: decisionVerification.finalConclusionAligned,
        disagreementType: decisionVerification.disagreementType,
      },
      trustScore: {
        score: trustScore.score,
        label: trustScore.label,
        reason: trustScore.reason,
      },
      comparison: {
        selectedProviders,
        agreementLevel: comparison.agreementLevel,
        likelyConflict: comparison.likelyConflict,
        summary: comparison.summary,
        finalConclusionAligned: decisionVerification.finalConclusionAligned,
        disagreementType: decisionVerification.disagreementType,
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