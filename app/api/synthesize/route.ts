import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { compareAnswers } from "@/lib/synthesis/compareAnswers";
import {
  judgeSemanticAgreementOrFallback,
  selectJudgeForProviders,
} from "@/lib/synthesis/semanticAgreement";
import { updateProviderQualityScore } from "@/lib/routing/providerScores";
import { detectTaskType } from "@/lib/routing/selectProviders";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const TIMEOUT_MS = 30_000;

const QUALITY_JUDGE_MODEL = "claude-haiku-4-5-20251001";

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

// ─── Zod output schemas ───────────────────────────────────────────────────────

const AgreementLevelSchema = z.enum(["high", "medium", "low"]);
const RiskLevelSchema = z.enum(["low", "moderate", "high"]);
const DisagreementTypeSchema = z.enum([
  "none",
  "additive_nuance",
  "explanation_variation",
  "conditional_alignment",
  "material_conflict",
]);

const SynthesizeResponseSchema = z.object({
  ok: z.literal(true),
  synthesis: z.string(),
  structuredSynthesis: z.object({
    finalAnswer: z.string(),
    sharedConclusion: z.string(),
    keyDifference: z.string(),
    decisionRule: z.string(),
  }),
  decisionVerification: z.object({
    verdict: z.string(),
    consensus: z.object({
      level: AgreementLevelSchema,
      modelsAligned: z.number().int().min(0),
    }),
    riskLevel: RiskLevelSchema,
    keyDisagreement: z.string(),
    recommendedAction: z.string(),
    finalConclusionAligned: z.boolean(),
    disagreementType: DisagreementTypeSchema,
  }),
  trustScore: z.object({
    score: z.number().int().min(0).max(100),
    label: z.enum(["high", "moderate", "low"]),
    reason: z.string(),
  }),
  comparison: z.object({
    selectedProviders: z.array(z.string()),
    agreementLevel: AgreementLevelSchema,
    likelyConflict: z.boolean(),
    summary: z.string(),
    finalConclusionAligned: z.boolean(),
    disagreementType: DisagreementTypeSchema,
    semanticLabel: z.string(),
    semanticRationale: z.string(),
    semanticUsedFallback: z.boolean(),
    semanticJudgeModel: z.string(),
  }),
});

// ─────────────────────────────────────────────────────────────────────────────

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
    return { finalConclusionAligned: true, disagreementType: "none" };
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
  if (input.totalProviders <= 1) return input.totalProviders;

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
      if (input.finalConclusionAligned) return input.totalProviders;
      if (input.agreementLevel === "medium")
        return Math.max(1, input.totalProviders - 1);
      return 0;
  }
}

function getConsensusLevelFromAligned(
  modelsAligned: number,
  totalProviders: number
): AgreementLevel {
  if (modelsAligned >= totalProviders) return "high";
  if (modelsAligned > 0) return "medium";
  return "low";
}

function getRiskLevel(input: {
  agreementLevel: AgreementLevel;
  disagreementType: DisagreementType;
  finalConclusionAligned: boolean;
}): RiskLevel {
  if (input.disagreementType === "material_conflict") return "high";
  if (input.disagreementType === "conditional_alignment") return "moderate";
  if (!input.finalConclusionAligned && input.agreementLevel === "low")
    return "high";
  if (!input.finalConclusionAligned) return "moderate";
  if (input.agreementLevel === "low") return "moderate";
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

  if (scores.length === 0) return 7;

  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}

function getAgreementBaseScore(agreementLevel: AgreementLevel): number {
  if (agreementLevel === "high") return 85;
  if (agreementLevel === "medium") return 65;
  return 35;
}

function getTrustLabel(score: number): TrustLabel {
  if (score >= 75) return "high";
  if (score >= 55) return "moderate";
  return "low";
}

function isCleanHighAgreementCase(input: {
  agreementLevel: AgreementLevel;
  finalConclusionAligned: boolean;
  disagreementType: DisagreementType;
  riskLevel: RiskLevel;
}): boolean {
  return (
    input.agreementLevel === "high" &&
    input.finalConclusionAligned &&
    input.riskLevel === "low" &&
    (input.disagreementType === "none" ||
      input.disagreementType === "additive_nuance" ||
      input.disagreementType === "explanation_variation")
  );
}

function getAgreementText(
  agreementLevel: AgreementLevel,
  finalConclusionAligned: boolean,
  disagreementType: DisagreementType,
  riskLevel: RiskLevel
): string {
  if (
    isCleanHighAgreementCase({
      agreementLevel,
      finalConclusionAligned,
      disagreementType,
      riskLevel,
    })
  ) {
    return "Models strongly agree on the core conclusion";
  }

  if (agreementLevel === "medium" && finalConclusionAligned) {
    return "Models partially align on the core conclusion";
  }

  if (agreementLevel === "high" && !finalConclusionAligned) {
    return "Models broadly align in wording, but the main conclusion still requires review";
  }

  if (agreementLevel === "medium" && !finalConclusionAligned) {
    return "Models only partially align on the core conclusion";
  }

  return "Models diverge on the core conclusion";
}

function buildTrustReason(input: {
  agreementLevel: AgreementLevel;
  disagreementType: DisagreementType;
  finalConclusionAligned: boolean;
  averageQuality: number;
  riskLevel: RiskLevel;
}): string {
  const agreementText = getAgreementText(
    input.agreementLevel,
    input.finalConclusionAligned,
    input.disagreementType,
    input.riskLevel
  );

  const qualityText =
    input.averageQuality >= 8
      ? "provider output quality is strong"
      : input.averageQuality >= 6.5
      ? "provider output quality is solid"
      : "provider output quality is mixed";

  const disagreementText = isCleanHighAgreementCase({
    agreementLevel: input.agreementLevel,
    finalConclusionAligned: input.finalConclusionAligned,
    disagreementType: input.disagreementType,
    riskLevel: input.riskLevel,
  })
    ? "with no meaningful disagreement"
    : input.disagreementType === "none"
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
  let score = agreementBase * 0.65 + qualityNormalized * 0.35;

  if (input.disagreementType === "explanation_variation") score -= 4;
  else if (input.disagreementType === "conditional_alignment") score -= 12;
  else if (input.disagreementType === "material_conflict") score -= 20;

  if (!input.finalConclusionAligned) score -= 10;
  if (input.riskLevel === "moderate") score -= 5;
  else if (input.riskLevel === "high") score -= 15;

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

async function scoreQualityWithNeutralJudge(input: {
  answerA: string;
  answerB: string;
  providerA: ProviderName;
  providerB: ProviderName;
}): Promise<{ scoreA: number; scoreB: number }> {
  try {
    const prompt =
      `Rate these two AI responses from 1-10 for quality, accuracy, and usefulness. ` +
      `Return JSON only with no other text: {"scoreA": number, "scoreB": number}\n\n` +
      `Response A: ${input.answerA}\n\nResponse B: ${input.answerB}`;

    const response = await Promise.race([
      anthropic.messages.create({
        model: QUALITY_JUDGE_MODEL,
        max_tokens: 60,
        messages: [{ role: "user", content: prompt }],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("quality_timeout")), TIMEOUT_MS)
      ),
    ]);

    const raw =
      response.content[0]?.type === "text" ? response.content[0].text : "";
    const cleaned = stripCodeFences(raw);
    const parsed = JSON.parse(cleaned);

    return {
      scoreA:
        typeof parsed.scoreA === "number" ? clamp(parsed.scoreA, 1, 10) : 7,
      scoreB:
        typeof parsed.scoreB === "number" ? clamp(parsed.scoreB, 1, 10) : 7,
    };
  } catch (error) {
    console.error("[/api/synthesize] quality_judge_error:", error);
    return { scoreA: 7, scoreB: 7 };
  }
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
  const noMeaningfulDifferenceRule =
    input.agreementLevel === "high"
      ? '- If the responses are clearly aligned, set "keyDifference" to: "No meaningful difference in conclusion; differences are limited to phrasing or supporting detail." unless there is a clear direct contradiction.'
      : '- keyDifference should state the most important difference in emphasis or recommendation.';

  const directDecisionRule =
    input.agreementLevel === "high"
      ? '- If the responses are clearly aligned, set "decisionRule" to: "Use the shared conclusion as the answer." unless the question genuinely requires a context-dependent decision.'
      : '- decisionRule should tell the user how to decide, or what context changes the answer.';

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
    '  "decisionRule": string',
    "}",
    "",
    "Rules:",
    "- finalAnswer should be the best concise direct answer to the question.",
    "- sharedConclusion should state what both model responses broadly agree on.",
    noMeaningfulDifferenceRule,
    directDecisionRule,
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
    "- When the comparison evidence already indicates high agreement, do not invent major disagreement. In those cases, disagreementType should normally be none or explanation_variation.",
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
  const highAgreementGuardrail =
    input.agreementLevel === "high"
      ? [
          "Important guardrail:",
          "- The comparison layer already found high agreement between the original responses.",
          "- Do not invent disagreement in the main conclusion.",
          '- If there is any difference, treat it as "none" or "explanation_variation" unless there is a clear direct contradiction.',
          '- For clearly aligned factual cases, recommendedAction should usually be "Use the shared conclusion as the answer."',
          '- For clearly aligned factual cases, keyDisagreement should usually state that there is no meaningful difference in conclusion.',
        ].join("\n")
      : "";

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
    highAgreementGuardrail,
    "",
    "Return JSON only.",
  ]
    .filter(Boolean)
    .join("\n");
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
  comparison: { summary: string; agreementLevel: AgreementLevel }
): StructuredSynthesis {
  const highAgreement = comparison.agreementLevel === "high";

  return {
    finalAnswer: stripCodeFences(synthesis),
    sharedConclusion: comparison.summary,
    keyDifference: highAgreement
      ? "No meaningful difference in conclusion; differences are limited to phrasing or supporting detail."
      : comparison.agreementLevel === "medium"
      ? "The two responses overlapped substantially but differed in emphasis, caveats, or framing."
      : "The two responses diverged meaningfully in recommendation or framing.",
    decisionRule: highAgreement
      ? "Use the shared conclusion as the answer."
      : comparison.agreementLevel === "low"
      ? "Choose based on your context, constraints, and risk tolerance, because the strongest answer depends on which tradeoff matters most."
      : "Use the shared conclusion as the base answer, then adjust based on your specific context and constraints.",
  };
}

function normalizeStructuredSynthesisForAgreement(
  structuredSynthesis: StructuredSynthesis,
  comparison: { agreementLevel: AgreementLevel; likelyConflict: boolean }
): StructuredSynthesis {
  if (comparison.agreementLevel !== "high") return structuredSynthesis;

  const cleanedFinalAnswer = structuredSynthesis.finalAnswer.trim();
  const sharedConclusion = structuredSynthesis.sharedConclusion.trim();
  const keyDifference = structuredSynthesis.keyDifference.trim();
  const decisionRule = structuredSynthesis.decisionRule.trim();

  return {
    ...structuredSynthesis,
    finalAnswer: cleanedFinalAnswer || sharedConclusion,
    sharedConclusion:
      sharedConclusion || "Both responses support the same main conclusion.",
    keyDifference:
      keyDifference &&
      !/diverge|conflict|oppos|disagree materially|one response emphasizes/i.test(
        keyDifference
      )
        ? keyDifference
        : "No meaningful difference in conclusion; differences are limited to phrasing or supporting detail.",
    decisionRule:
      decisionRule &&
      !/choose based on|depends on your context|tradeoff|clarify the discussion|highlight both/i.test(
        decisionRule
      )
        ? decisionRule
        : "Use the shared conclusion as the answer.",
  };
}

function buildCleanAlignedVerdict(
  structuredSynthesis: StructuredSynthesis
): string {
  const candidate =
    structuredSynthesis.finalAnswer.trim() ||
    structuredSynthesis.sharedConclusion.trim();

  if (!candidate) return "Use the shared conclusion as the answer.";
  if (/^aligned$/i.test(candidate))
    return structuredSynthesis.sharedConclusion.trim() || "Aligned";
  return candidate;
}

function applyVerificationGuardrails(input: {
  verification: DecisionVerification;
  comparison: { agreementLevel: AgreementLevel; likelyConflict: boolean };
  structuredSynthesis: StructuredSynthesis;
  totalProviders: number;
}): DecisionVerification {
  const guarded = { ...input.verification };

  if (input.comparison.agreementLevel === "high") {
    guarded.finalConclusionAligned = true;

    if (
      guarded.disagreementType === "material_conflict" ||
      guarded.disagreementType === "conditional_alignment" ||
      guarded.disagreementType === "additive_nuance" ||
      guarded.disagreementType === "explanation_variation"
    ) {
      guarded.disagreementType = "none";
    }

    guarded.keyDisagreement =
      "No meaningful difference in conclusion; differences are limited to phrasing or supporting detail.";
    guarded.recommendedAction = "Use the shared conclusion as the answer.";
    guarded.verdict = buildCleanAlignedVerdict(input.structuredSynthesis);
    guarded.consensus = { level: "high", modelsAligned: input.totalProviders };
    guarded.riskLevel = "low";
  }

  return guarded;
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
    verdict:
      input.agreementLevel === "high"
        ? buildCleanAlignedVerdict(input.structuredSynthesis)
        : input.structuredSynthesis.finalAnswer,
    consensus: { level: consensusLevel, modelsAligned },
    riskLevel: getRiskLevel({
      agreementLevel: input.agreementLevel,
      disagreementType: fallback.disagreementType,
      finalConclusionAligned: fallback.finalConclusionAligned,
    }),
    keyDisagreement:
      input.agreementLevel === "high"
        ? "No meaningful difference in conclusion; differences are limited to phrasing or supporting detail."
        : fallback.disagreementType === "conditional_alignment"
        ? "A usable answer depends on context, conditions, or tradeoffs."
        : input.structuredSynthesis.keyDifference,
    recommendedAction:
      input.agreementLevel === "high"
        ? "Use the shared conclusion as the answer."
        : fallback.disagreementType === "conditional_alignment"
        ? "Choose based on the conditions or tradeoffs that matter most in your context."
        : input.structuredSynthesis.decisionRule,
    finalConclusionAligned:
      input.agreementLevel === "high" ? true : fallback.finalConclusionAligned,
    disagreementType:
      input.agreementLevel === "high" ? "none" : fallback.disagreementType,
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
          { role: "system", content: buildVerificationSystemPrompt() },
          { role: "user", content: buildVerificationUserPrompt(input) },
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

      const initialVerification: DecisionVerification = {
        verdict: parsed.verdict || input.structuredSynthesis.finalAnswer,
        consensus: { level: consensusLevel, modelsAligned },
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

      return applyVerificationGuardrails({
        verification: initialVerification,
        comparison: {
          agreementLevel: input.agreementLevel,
          likelyConflict: input.likelyConflict,
        },
        structuredSynthesis: input.structuredSynthesis,
        totalProviders: input.totalProviders,
      });
    }
  } catch (error) {
    console.error("[/api/synthesize] verification_error:", error);
  }

  const fallbackVerification = buildFallbackDecisionVerification({
    structuredSynthesis: input.structuredSynthesis,
    agreementLevel: input.agreementLevel,
    likelyConflict: input.likelyConflict,
    totalProviders: input.totalProviders,
  });

  return applyVerificationGuardrails({
    verification: fallbackVerification,
    comparison: {
      agreementLevel: input.agreementLevel,
      likelyConflict: input.likelyConflict,
    },
    structuredSynthesis: input.structuredSynthesis,
    totalProviders: input.totalProviders,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const prompt = body?.prompt;
    const selectedProviders = body?.selectedProviders as
      | ProviderName[]
      | undefined;
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

    const heuristicComparison = compareAnswers(answerA, answerB);

    const judgeProvider = selectJudgeForProviders(providerA, providerB);

    const semantic = await judgeSemanticAgreementOrFallback(
      { question: prompt, answerA, answerB },
      () => ({
        agreementLevel: heuristicComparison.agreementLevel,
        likelyConflict: heuristicComparison.likelyConflict,
      }),
      { judgeProvider }
    );

    const semanticSummary =
      semantic.agreementLevel === "high"
        ? "The two model outputs support the same main conclusion."
        : semantic.agreementLevel === "medium"
        ? "The two model outputs broadly align but differ in emphasis, caveats, or framing."
        : semantic.likelyConflict
        ? "The two model outputs materially conflict on the main conclusion."
        : "The two model outputs show weak alignment on the main conclusion.";

    const comparison = {
      ...heuristicComparison,
      agreementLevel: semantic.agreementLevel,
      likelyConflict: semantic.likelyConflict,
      summary: semanticSummary,
    };

    console.log(
      "[SYNTHESIS_COMPARISON]",
      JSON.stringify({
        selectedProviders,
        judgeProvider,
        agreementLevel: comparison.agreementLevel,
        likelyConflict: comparison.likelyConflict,
        overlapRatio: heuristicComparison.overlapRatio,
        summary: comparison.summary,
        semanticLabel: semantic.label,
        semanticRationale: semantic.rationale,
        semanticUsedFallback: semantic.usedFallback,
        semanticJudgeModel: semantic.judgeModel,
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

    const [structuringResult, qualityScores] = await Promise.all([
      withTimeout(
        openai.chat.completions.create({
          model: "gpt-4o-mini",
          max_tokens: 400,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: buildStructuringSystemPrompt() },
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
      ).catch((error) => {
        console.error("[/api/synthesize] structuring_error:", error);
        return null;
      }),
      scoreQualityWithNeutralJudge({
        answerA,
        answerB,
        providerA,
        providerB,
      }),
    ]);

    if (structuringResult) {
      const rawStructured =
        structuringResult.choices[0]?.message?.content ?? "";
      structuredSynthesis = tryParseStructuredJson(rawStructured);
    }

    if (!structuredSynthesis) {
      structuredSynthesis = buildFallbackStructuredSynthesis(synthesis, {
        summary: comparison.summary,
        agreementLevel: comparison.agreementLevel,
      });
    }

    structuredSynthesis = normalizeStructuredSynthesisForAgreement(
      structuredSynthesis,
      {
        agreementLevel: comparison.agreementLevel,
        likelyConflict: comparison.likelyConflict,
      }
    );

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

    await Promise.all([
      updateProviderQualityScore({
        taskType,
        provider: providerA,
        qualityScore: qualityScores.scoreA,
      }),
      updateProviderQualityScore({
        taskType,
        provider: providerB,
        qualityScore: qualityScores.scoreB,
      }),
    ]);

    console.log("[QUALITY_SCORE]", {
      providerA,
      providerB,
      taskType,
      scoreA: qualityScores.scoreA,
      scoreB: qualityScores.scoreB,
    });

    const averageQuality =
      (qualityScores.scoreA + qualityScores.scoreB) / 2;

    const trustScore = calculateTrustScore({
      agreementLevel: comparison.agreementLevel,
      disagreementType: decisionVerification.disagreementType,
      finalConclusionAligned: decisionVerification.finalConclusionAligned,
      averageQuality,
      riskLevel: decisionVerification.riskLevel,
    });

    // Build response payload
    const responsePayload = {
      ok: true as const,
      synthesis,
      structuredSynthesis: {
        finalAnswer: structuredSynthesis.finalAnswer,
        sharedConclusion: structuredSynthesis.sharedConclusion,
        keyDifference: structuredSynthesis.keyDifference,
        decisionRule: structuredSynthesis.decisionRule,
      },
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
        semanticLabel: semantic.label,
        semanticRationale: semantic.rationale,
        semanticUsedFallback: semantic.usedFallback,
        semanticJudgeModel: semantic.judgeModel,
      },
    };

    // Validate response shape before sending
    const validation = SynthesizeResponseSchema.safeParse(responsePayload);

    if (!validation.success) {
      console.error(
        "[/api/synthesize] response_validation_failed:",
        JSON.stringify(validation.error.issues)
      );
      return NextResponse.json(
        { ok: false, error: "response_validation_failed" },
        { status: 500 }
      );
    }

    return NextResponse.json(validation.data);
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