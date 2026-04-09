import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

export type SemanticAgreementLevel = "high" | "medium" | "low";
export type SemanticAgreementLabel =
  | "HIGH_AGREEMENT"
  | "MEDIUM_AGREEMENT"
  | "LOW_AGREEMENT"
  | "CONFLICT";

export type JudgeProvider = "openai" | "anthropic";

export interface SemanticAgreementResult {
  label: SemanticAgreementLabel;
  agreementLevel: SemanticAgreementLevel;
  likelyConflict: boolean;
  rationale: string;
  judgeModel: string;
}

export interface SemanticAgreementInput {
  answerA: string;
  answerB: string;
  question?: string;
}

export interface SemanticAgreementOptions {
  judgeProvider?: JudgeProvider;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
  maxOutputTokens?: number;
}

export interface HeuristicFallbackResult {
  agreementLevel: SemanticAgreementLevel;
  likelyConflict: boolean;
}

const DEFAULT_OPENAI_JUDGE_MODEL =
  process.env.OPENAI_SEMANTIC_JUDGE_MODEL || "gpt-4o-mini";
const DEFAULT_ANTHROPIC_JUDGE_MODEL =
  process.env.ANTHROPIC_SEMANTIC_JUDGE_MODEL || "claude-haiku-4-5-20251001";
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 300;

/**
 * Pick a neutral judge that did NOT produce either answer.
 * If both providers are OpenAI-family, use Anthropic and vice versa.
 * Falls back to anthropic by default since ANTHROPIC_API_KEY is available.
 */
export function selectJudgeForProviders(
  providerA: string,
  providerB: string
): JudgeProvider {
  const openaiProviders = ["openai"];
  const anthropicProviders = ["anthropic"];

  const aIsOpenAI = openaiProviders.includes(providerA);
  const bIsOpenAI = openaiProviders.includes(providerB);
  const aIsAnthropic = anthropicProviders.includes(providerA);
  const bIsAnthropic = anthropicProviders.includes(providerB);

  // If either provider is OpenAI, use Anthropic as judge
  if (aIsOpenAI || bIsOpenAI) {
    return "anthropic";
  }

  // If either provider is Anthropic, use OpenAI as judge
  if (aIsAnthropic || bIsAnthropic) {
    return "openai";
  }

  // Default: use Anthropic
  return "anthropic";
}

const semanticSchema = {
  type: "object",
  properties: {
    label: {
      type: "string",
      enum: ["HIGH_AGREEMENT", "MEDIUM_AGREEMENT", "LOW_AGREEMENT", "CONFLICT"],
    },
    rationale: {
      type: "string",
      description:
        "Very short explanation focused on conclusion, certainty, and scope. Max 1 sentence.",
    },
  },
  required: ["label", "rationale"],
  additionalProperties: false,
} as const;

function mapLabel(
  label: SemanticAgreementLabel
): Pick<SemanticAgreementResult, "agreementLevel" | "likelyConflict"> {
  switch (label) {
    case "HIGH_AGREEMENT":
      return { agreementLevel: "high", likelyConflict: false };
    case "MEDIUM_AGREEMENT":
      return { agreementLevel: "medium", likelyConflict: false };
    case "LOW_AGREEMENT":
      return { agreementLevel: "low", likelyConflict: false };
    case "CONFLICT":
      return { agreementLevel: "low", likelyConflict: true };
    default: {
      const exhaustiveCheck: never = label;
      throw new Error(`Unhandled semantic agreement label: ${exhaustiveCheck}`);
    }
  }
}

function buildPrompt({
  answerA,
  answerB,
  question,
}: SemanticAgreementInput): string {
  return [
    "You are evaluating whether two AI answers support the same main conclusion.",
    "Judge semantic agreement, not wording overlap.",
    "",
    "Evaluate these dimensions:",
    "- main conclusion",
    "- recommendation direction",
    "- certainty level",
    "- caveats or conditions",
    "- scope of the claim",
    "",
    "Decision rules:",
    "- HIGH_AGREEMENT: both answers support the same main conclusion with similar certainty, qualification, and practical takeaway. Minor wording differences or extra correct detail should still be HIGH_AGREEMENT.",
    "- MEDIUM_AGREEMENT: both answers point in the same general direction, but one answer is materially more conditional, cautious, narrowed, qualified, or limited than the other.",
    "- LOW_AGREEMENT: the answers overlap somewhat but differ meaningfully in emphasis, scope, takeaway, or support for the main conclusion.",
    "- CONFLICT: the answers give materially opposite conclusions, recommendations, or yes/no outcomes.",
    "",
    "Important guidance:",
    "- Do not lower agreement just because one answer includes extra correct detail.",
    "- Short factual paraphrases with the same conclusion should usually be HIGH_AGREEMENT.",
    "- Explanatory paraphrases with the same core meaning should usually be HIGH_AGREEMENT.",
    "- If two answers both say 'it depends' or both give a conditional answer, but differ mainly in framing, that is often MEDIUM_AGREEMENT rather than HIGH_AGREEMENT.",
    "- If one answer recommends something broadly and the other recommends it only with meaningful caveats, that is usually MEDIUM_AGREEMENT.",
    "- Direct yes/no contradictions must be CONFLICT.",
    "- Focus on the real takeaway a user would infer, not just shared topic words.",
    "",
    question ? `Question:\n${question}` : undefined,
    "",
    "Answer A:",
    answerA,
    "",
    "Answer B:",
    answerB,
  ]
    .filter(Boolean)
    .join("\n");
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timeout);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

async function judgeWithOpenAI(
  input: SemanticAgreementInput,
  options: SemanticAgreementOptions
): Promise<SemanticAgreementResult> {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required");

  const model = options.model || DEFAULT_OPENAI_JUDGE_MODEL;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const maxOutputTokens = options.maxOutputTokens || DEFAULT_MAX_OUTPUT_TOKENS;

  const client = new OpenAI({ apiKey });

  const response = await withTimeout(
    client.responses.create({
      model,
      temperature: 0,
      input: [
        {
          role: "system",
          content:
            "Return only the requested structured verdict. Be strict about contradiction detection, careful about caveat and certainty mismatches, and do not penalize extra correct detail when the main conclusion is the same.",
        },
        {
          role: "user",
          content: buildPrompt(input),
        },
      ],
      max_output_tokens: maxOutputTokens,
      text: {
        format: {
          type: "json_schema",
          name: "semantic_agreement",
          strict: true,
          schema: semanticSchema,
        },
      },
    }),
    timeoutMs,
    "openai semantic judge"
  );

  const raw = response.output_text?.trim();
  if (!raw) throw new Error("OpenAI semantic judge returned empty output");

  let parsed: { label: SemanticAgreementLabel; rationale: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    const text = raw.toUpperCase();
    const label: SemanticAgreementLabel =
      text.includes("HIGH_AGREEMENT") ? "HIGH_AGREEMENT"
      : text.includes("HIGH") ? "HIGH_AGREEMENT"
      : text.includes("MEDIUM_AGREEMENT") ? "MEDIUM_AGREEMENT"
      : text.includes("MEDIUM") ? "MEDIUM_AGREEMENT"
      : text.includes("CONFLICT") ? "CONFLICT"
      : "LOW_AGREEMENT";
    parsed = { label, rationale: "Fallback: JSON parse failed." };
  }
  const mapped = mapLabel(parsed.label);

  return {
    label: parsed.label,
    rationale: parsed.rationale,
    judgeModel: `openai/${model}`,
    ...mapped,
  };
}

async function judgeWithAnthropic(
  input: SemanticAgreementInput,
  options: SemanticAgreementOptions
): Promise<SemanticAgreementResult> {
  const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required");

  const model = options.model || DEFAULT_ANTHROPIC_JUDGE_MODEL;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const maxOutputTokens = options.maxOutputTokens || DEFAULT_MAX_OUTPUT_TOKENS;

  const client = new Anthropic({ apiKey });

  const systemPrompt =
    "Return only valid JSON matching this exact shape: " +
    '{"label":"HIGH_AGREEMENT"|"MEDIUM_AGREEMENT"|"LOW_AGREEMENT"|"CONFLICT","rationale":"string"}. ' +
    "Be strict about contradiction detection, careful about caveat and certainty mismatches, " +
    "and do not penalize extra correct detail when the main conclusion is the same. No other text.";

  const response = await withTimeout(
    client.messages.create({
      model,
      max_tokens: maxOutputTokens,
      temperature: 0,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: buildPrompt(input),
        },
      ],
    }),
    timeoutMs,
    "anthropic semantic judge"
  );

  const raw =
    response.content[0]?.type === "text"
      ? response.content[0].text.trim()
      : "";
  if (!raw) throw new Error("Anthropic semantic judge returned empty output");

  // Strip any accidental markdown fences
  const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  let parsed: { label: SemanticAgreementLabel; rationale: string };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const text = cleaned.toUpperCase();
    const label: SemanticAgreementLabel =
      text.includes("HIGH_AGREEMENT") ? "HIGH_AGREEMENT"
      : text.includes("HIGH") ? "HIGH_AGREEMENT"
      : text.includes("MEDIUM_AGREEMENT") ? "MEDIUM_AGREEMENT"
      : text.includes("MEDIUM") ? "MEDIUM_AGREEMENT"
      : text.includes("CONFLICT") ? "CONFLICT"
      : "LOW_AGREEMENT";
    parsed = { label, rationale: "Fallback: JSON parse failed." };
  }

  const mapped = mapLabel(parsed.label);

  return {
    label: parsed.label,
    rationale: parsed.rationale,
    judgeModel: `anthropic/${model}`,
    ...mapped,
  };
}

export async function judgeSemanticAgreement(
  input: SemanticAgreementInput,
  options: SemanticAgreementOptions = {}
): Promise<SemanticAgreementResult> {
  const provider = options.judgeProvider ?? "anthropic";

  if (provider === "anthropic") {
    return judgeWithAnthropic(input, options);
  }

  return judgeWithOpenAI(input, options);
}

export async function judgeSemanticAgreementOrFallback(
  input: SemanticAgreementInput,
  fallback: () => HeuristicFallbackResult | Promise<HeuristicFallbackResult>,
  options: SemanticAgreementOptions = {}
): Promise<SemanticAgreementResult & { usedFallback: boolean }> {
  try {
    const judged = await judgeSemanticAgreement(input, options);
    return { ...judged, usedFallback: false };
  } catch (err) {
    console.error("[semanticAgreement] judge failed, using fallback:", err);
    const fallbackResult = await fallback();

    return {
      label: fallbackResult.likelyConflict
        ? "CONFLICT"
        : fallbackResult.agreementLevel === "high"
        ? "HIGH_AGREEMENT"
        : fallbackResult.agreementLevel === "medium"
        ? "MEDIUM_AGREEMENT"
        : "LOW_AGREEMENT",
      rationale: "Fell back to heuristic comparison.",
      judgeModel: "heuristic",
      agreementLevel: fallbackResult.agreementLevel,
      likelyConflict: fallbackResult.likelyConflict,
      usedFallback: true,
    };
  }
}
