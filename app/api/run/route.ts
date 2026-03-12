import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

import { runOpenAI } from "@/lib/providers/openai";
import { runAnthropic } from "@/lib/providers/anthropic";
import { runPerplexity } from "@/lib/providers/perplexity";
import {
  detectTaskType,
  type ProviderName,
} from "@/lib/routing/selectProviders";
import { adaptiveSelectProviders } from "@/lib/routing/adaptiveSelect";
import {
  logRunDiagnostic,
  type ProviderDiagnostic,
  type SelectionMode,
} from "@/lib/routing/runDiagnostics";
import {
  updateProviderScore,
  getProviderScores,
} from "@/lib/routing/providerScores";
import { compareAnswers } from "@/lib/synthesis/compareAnswers";

export const runtime = "nodejs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const PROVIDER_TIMEOUT_MS = 30_000;
const VERIFICATION_TIMEOUT_MS = 20_000;
const MAX_PROVIDERS = 2;

type AgreementLevel = "high" | "medium" | "low";
type RiskLevel = "low" | "moderate" | "high";
type TrustLabel = "high" | "moderate" | "low";
type DisagreementType =
  | "none"
  | "additive_nuance"
  | "explanation_variation"
  | "conditional_alignment"
  | "material_conflict";

type RunRequest = {
  prompt: string;
  providers?: ProviderName[];
};

type RunResponse = {
  openai: string;
  anthropic: string;
  perplexity: string;
};

type TimedResult<T> = {
  value: T;
  durationMs: number;
  timedOut: boolean;
  usedFallback: boolean;
  errorMessage?: string;
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

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallbackValue: T
): Promise<TimedResult<T>> {
  return new Promise((resolve) => {
    const startedAt = Date.now();

    const timer = setTimeout(() => {
      resolve({
        value: fallbackValue,
        durationMs: Date.now() - startedAt,
        timedOut: true,
        usedFallback: true,
        errorMessage: "timeout",
      });
    }, ms);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve({
          value,
          durationMs: Date.now() - startedAt,
          timedOut: false,
          usedFallback: false,
        });
      })
      .catch((error) => {
        clearTimeout(timer);
        const errorMessage =
          error instanceof Error ? error.message : "Unknown provider error";
        resolve({
          value: fallbackValue,
          durationMs: Date.now() - startedAt,
          timedOut: false,
          usedFallback: true,
          errorMessage,
        });
      });
  });
}

function stripCodeFences(text: string): string {
  return text
    .replace(/```plaintext\s*/gi, "")
    .replace(/```json\s*/gi, "")
    .replace(/```markdown\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
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
    reason: buildTrustReason(input),
  };
}

async function routeProviders(
  prompt: string,
  selectedProviders: ProviderName[]
): Promise<{
  results: RunResponse;
  diagnostics: ProviderDiagnostic[];
}> {
  const results: RunResponse = {
    openai: "",
    anthropic: "",
    perplexity: "",
  };

  const diagnostics: ProviderDiagnostic[] = [];
  const tasks: Promise<void>[] = [];

  if (selectedProviders.includes("openai")) {
    tasks.push(
      withTimeout(
        runOpenAI(prompt),
        PROVIDER_TIMEOUT_MS,
        "OpenAI timed out or failed to respond."
      ).then((res) => {
        results.openai = res.value;
        if (res.errorMessage) {
          console.error("[RUN_API] OpenAI failed", {
            error: res.errorMessage,
            durationMs: res.durationMs,
            timedOut: res.timedOut,
          });
        }
        diagnostics.push({
          provider: "openai",
          durationMs: res.durationMs,
          timedOut: res.timedOut,
          usedFallback: res.usedFallback,
        });
      })
    );
  }

  if (selectedProviders.includes("anthropic")) {
    tasks.push(
      withTimeout(
        runAnthropic(prompt),
        PROVIDER_TIMEOUT_MS,
        "Anthropic timed out or failed to respond."
      ).then((res) => {
        results.anthropic = res.value;
        if (res.errorMessage) {
          console.error("[RUN_API] Anthropic failed", {
            error: res.errorMessage,
            durationMs: res.durationMs,
            timedOut: res.timedOut,
          });
        }
        diagnostics.push({
          provider: "anthropic",
          durationMs: res.durationMs,
          timedOut: res.timedOut,
          usedFallback: res.usedFallback,
        });
      })
    );
  }

  if (selectedProviders.includes("perplexity")) {
    tasks.push(
      withTimeout(
        runPerplexity(prompt),
        PROVIDER_TIMEOUT_MS,
        "Perplexity timed out or failed to respond."
      ).then((res) => {
        results.perplexity = res.value;
        if (res.errorMessage) {
          console.error("[RUN_API] Perplexity failed", {
            error: res.errorMessage,
            durationMs: res.durationMs,
            timedOut: res.timedOut,
          });
        }
        diagnostics.push({
          provider: "perplexity",
          durationMs: res.durationMs,
          timedOut: res.timedOut,
          usedFallback: res.usedFallback,
        });
      })
    );
  }

  await Promise.all(tasks);
  return { results, diagnostics };
}

async function buildDecisionVerification(input: {
  prompt: string;
  answerA: string;
  answerB: string;
  agreementLevel: AgreementLevel;
  likelyConflict: boolean;
  totalProviders: number;
}): Promise<DecisionVerification> {
  const fallback = inferFallbackClassification({
    agreementLevel: input.agreementLevel,
    likelyConflict: input.likelyConflict,
  });

  try {
    const completion = await Promise.race([
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 260,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              'You are a decision-verification engine. Return JSON only with this exact shape: {"verdict":"string","keyDisagreement":"string","recommendedAction":"string","finalConclusionAligned":boolean,"disagreementType":"none|additive_nuance|explanation_variation|conditional_alignment|material_conflict"}. Judge alignment from the ORIGINAL model responses first. Do not upgrade disagreement into agreement just because a reasonable compromise could be written. finalConclusionAligned should be true only when both responses support the same main conclusion. Use additive_nuance when one response mainly adds correct detail without changing the core conclusion. Use explanation_variation when both responses support the same conclusion but differ in framing, emphasis, or supporting reasoning. Use conditional_alignment when a usable combined takeaway exists only by adding conditions, context, or tradeoffs, but the original responses do not cleanly support the same main conclusion. Use material_conflict only when the main recommendation, conclusion, or decision materially differs.',
          },
          {
            role: "user",
            content: [
              `Question: ${input.prompt}`,
              "",
              `Agreement level: ${input.agreementLevel}`,
              `Likely conflict: ${input.likelyConflict ? "yes" : "no"}`,
              "",
              `Response A: ${input.answerA}`,
              "",
              `Response B: ${input.answerB}`,
              "",
              "Base your classification on the original answers, not on any hypothetical merged synthesis.",
            ].join("\n"),
          },
        ],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("verification_timeout")), VERIFICATION_TIMEOUT_MS)
      ),
    ]);

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(stripCodeFences(raw));

    const disagreementType: DisagreementType = isDisagreementType(
      parsed.disagreementType
    )
      ? parsed.disagreementType
      : fallback.disagreementType;

    const finalConclusionAligned =
      typeof parsed.finalConclusionAligned === "boolean"
        ? parsed.finalConclusionAligned
        : fallback.finalConclusionAligned;

    const modelsAligned = getModelsAligned({
      totalProviders: input.totalProviders,
      agreementLevel: input.agreementLevel,
      finalConclusionAligned,
      disagreementType,
    });

    const consensusLevel = getConsensusLevelFromAligned(
      modelsAligned,
      input.totalProviders
    );

    return {
      verdict:
        typeof parsed.verdict === "string" && parsed.verdict.trim()
          ? parsed.verdict.trim()
          : "Use the overlapping conclusion as the base answer.",
      consensus: {
        level: consensusLevel,
        modelsAligned,
      },
      riskLevel: getRiskLevel({
        agreementLevel: input.agreementLevel,
        disagreementType,
        finalConclusionAligned,
      }),
      keyDisagreement:
        typeof parsed.keyDisagreement === "string" && parsed.keyDisagreement.trim()
          ? parsed.keyDisagreement.trim()
          : disagreementType === "material_conflict"
          ? "The models differed on the main recommendation."
          : disagreementType === "conditional_alignment"
          ? "A usable answer depends on context, conditions, or tradeoffs."
          : "The models differed mainly in emphasis or supporting detail.",
      recommendedAction:
        typeof parsed.recommendedAction === "string" && parsed.recommendedAction.trim()
          ? parsed.recommendedAction.trim()
          : disagreementType === "conditional_alignment"
          ? "Choose based on the conditions or tradeoffs that matter most in your context."
          : "Use the shared conclusion as your starting point, then adjust for context.",
      finalConclusionAligned,
      disagreementType,
    };
  } catch (error) {
    console.error("[RUN_API] verification_error:", error);

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
      verdict: "Use the overlapping conclusion as the base answer.",
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
        fallback.disagreementType === "material_conflict"
          ? "The models differed on the main recommendation."
          : fallback.disagreementType === "conditional_alignment"
          ? "A usable answer depends on context, conditions, or tradeoffs."
          : "The models differed mainly in emphasis or supporting detail.",
      recommendedAction:
        fallback.disagreementType === "conditional_alignment"
          ? "Choose based on the conditions or tradeoffs that matter most in your context."
          : "Use the shared conclusion as your starting point, then adjust for context.",
      finalConclusionAligned: fallback.finalConclusionAligned,
      disagreementType: fallback.disagreementType,
    };
  }
}

async function scoreAnswerQuality(input: {
  answerA: string;
  answerB: string;
}): Promise<{ scoreA: number; scoreB: number }> {
  try {
    const completion = await Promise.race([
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 100,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content:
              `Rate these two AI responses from 1-10 for quality, accuracy and usefulness. ` +
              `Return JSON only: {"scoreA": number, "scoreB": number}\n\n` +
              `Response A: ${input.answerA}\n\nResponse B: ${input.answerB}`,
          },
        ],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("quality_timeout")), VERIFICATION_TIMEOUT_MS)
      ),
    ]);

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(stripCodeFences(raw));

    return {
      scoreA:
        typeof parsed.scoreA === "number" ? clamp(parsed.scoreA, 1, 10) : 7,
      scoreB:
        typeof parsed.scoreB === "number" ? clamp(parsed.scoreB, 1, 10) : 7,
    };
  } catch (error) {
    console.error("[RUN_API] quality_error:", error);
    return { scoreA: 7, scoreB: 7 };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: RunRequest = await req.json();

    if (!body.prompt || typeof body.prompt !== "string") {
      return NextResponse.json(
        {
          ok: false,
          error: "missing_prompt",
          answers: { openai: "", anthropic: "", perplexity: "" },
          selectedProviders: [] as ProviderName[],
        },
        { status: 400 }
      );
    }

    const taskType = detectTaskType(body.prompt);

    let selectedProviders: ProviderName[];
    let selectionMode: SelectionMode;

    if (body.providers && body.providers.length > 0) {
      selectedProviders = body.providers.slice(0, MAX_PROVIDERS);
      selectionMode = "manual";
    } else {
      const adaptiveSelection = await adaptiveSelectProviders(body.prompt, taskType);
      selectedProviders = adaptiveSelection.selectedProviders.slice(
        0,
        MAX_PROVIDERS
      ) as ProviderName[];
      selectionMode = adaptiveSelection.selectionMode;
    }

    const { results, diagnostics } = await routeProviders(
      body.prompt,
      selectedProviders
    );

    await Promise.all(
      diagnostics.map((diagnostic) =>
        updateProviderScore({
          taskType,
          provider: diagnostic.provider,
          durationMs: diagnostic.durationMs,
          timedOut: diagnostic.timedOut,
          usedFallback: diagnostic.usedFallback,
        })
      )
    );

    logRunDiagnostic({
      taskType,
      selectedProviders,
      selectionMode,
      providerResults: diagnostics,
    });

    const scores = await getProviderScores(taskType);
    console.log(
      "[PROVIDER_SCORES_UPDATED]",
      JSON.stringify({ taskType, selectedProviders, scores })
    );

    if (selectedProviders.length < 2) {
      return NextResponse.json({
        ok: true,
        answers: results,
        selectedProviders,
        comparison: null,
        decisionVerification: null,
        trustScore: null,
      });
    }

    const [providerA, providerB] = selectedProviders;
    const answerA = results[providerA];
    const answerB = results[providerB];

    const comparison = compareAnswers(answerA, answerB);

    const [decisionVerification, qualityScores] = await Promise.all([
      buildDecisionVerification({
        prompt: body.prompt,
        answerA,
        answerB,
        agreementLevel: comparison.agreementLevel,
        likelyConflict: comparison.likelyConflict,
        totalProviders: selectedProviders.length,
      }),
      scoreAnswerQuality({
        answerA,
        answerB,
      }),
    ]);

    const averageQuality = (qualityScores.scoreA + qualityScores.scoreB) / 2;

    const trustScore = calculateTrustScore({
      agreementLevel: comparison.agreementLevel,
      disagreementType: decisionVerification.disagreementType,
      finalConclusionAligned: decisionVerification.finalConclusionAligned,
      averageQuality,
      riskLevel: decisionVerification.riskLevel,
    });

    return NextResponse.json({
      ok: true,
      answers: results,
      selectedProviders,
      comparison: {
        agreementLevel: comparison.agreementLevel,
        likelyConflict: comparison.likelyConflict,
        overlapRatio: comparison.overlapRatio,
        summary: comparison.summary,
        finalConclusionAligned: decisionVerification.finalConclusionAligned,
        disagreementType: decisionVerification.disagreementType,
      },
      decisionVerification,
      trustScore,
    });
  } catch (error) {
    console.error("RUN API ERROR:", error);
    return NextResponse.json(
      {
        ok: false,
        error: "server_error",
        answers: { openai: "", anthropic: "", perplexity: "" },
        selectedProviders: [] as ProviderName[],
        comparison: null,
        decisionVerification: null,
        trustScore: null,
      },
      { status: 500 }
    );
  }
}