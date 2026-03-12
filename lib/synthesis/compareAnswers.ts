export type AgreementLevel = "high" | "medium" | "low";

export type ComparisonSignal = {
  agreementLevel: AgreementLevel;
  likelyConflict: boolean;
  overlapRatio: number;
  summary: string;
};

type DecisionDirection = "positive" | "negative" | "conditional" | "neutral";

function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => word.length > 2);
}

function countMatches(text: string, phrases: string[]): number {
  return phrases.reduce(
    (count, phrase) => count + (text.includes(phrase) ? 1 : 0),
    0
  );
}

function detectDecisionDirection(text: string): DecisionDirection {
  const lower = text.toLowerCase();

  const negativePhrases = [
    "do not",
    "don't",
    "should not",
    "shouldn't",
    "not advisable",
    "not recommended",
    "bad idea",
    "avoid",
    "unwise",
    "no,",
    "no ",
    "never",
  ];

  const positivePhrases = [
    "yes,",
    "yes ",
    "should",
    "recommended",
    "advisable",
    "good idea",
    "worth it",
    "go ahead",
    "do it",
  ];

  const conditionalPhrases = [
    "it depends",
    "depends on",
    "depending on",
    "if",
    "unless",
    "under certain conditions",
    "in that case",
    "otherwise",
  ];

  const negativeScore = countMatches(lower, negativePhrases);
  const positiveScore = countMatches(lower, positivePhrases);
  const conditionalScore = countMatches(lower, conditionalPhrases);

  if (negativeScore > positiveScore && negativeScore >= 1) {
    return conditionalScore >= 2 ? "conditional" : "negative";
  }

  if (positiveScore > negativeScore && positiveScore >= 1) {
    return conditionalScore >= 2 ? "conditional" : "positive";
  }

  if (conditionalScore >= 2) {
    return "conditional";
  }

  return "neutral";
}

function getDirectionAgreementScore(
  aDirection: DecisionDirection,
  bDirection: DecisionDirection
): number {
  if (aDirection === bDirection) {
    return 1;
  }

  const pair = [aDirection, bDirection].sort().join(":");

  if (
    pair === "conditional:negative" ||
    pair === "conditional:positive" ||
    pair === "conditional:neutral"
  ) {
    return 0.65;
  }

  if (
    pair === "negative:neutral" ||
    pair === "positive:neutral"
  ) {
    return 0.45;
  }

  if (pair === "negative:positive") {
    return 0;
  }

  return 0.35;
}

export function compareAnswers(a: string, b: string): ComparisonSignal {
  const aWords = new Set(normalize(a));
  const bWords = new Set(normalize(b));

  const overlapCount = [...aWords].filter((word) => bWords.has(word)).length;
  const baseSize = Math.max(Math.min(aWords.size, bWords.size), 1);
  const overlapRatio = overlapCount / baseSize;

  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();

  const aDirection = detectDecisionDirection(lowerA);
  const bDirection = detectDecisionDirection(lowerB);
  const directionAgreement = getDirectionAgreementScore(aDirection, bDirection);

  const conflictTerms = [
    "however",
    "instead",
    "alternatively",
    "on the other hand",
    "tradeoff",
    "trade-off",
    "versus",
    "vs",
  ];

  const softConflictTerms = ["depends", "but", "if", "unless", "otherwise"];

  const hardConflictSignal =
    conflictTerms.some((term) => lowerA.includes(term)) ||
    conflictTerms.some((term) => lowerB.includes(term));

  const softConflictCount =
    softConflictTerms.filter((term) => lowerA.includes(term)).length +
    softConflictTerms.filter((term) => lowerB.includes(term)).length;

  const likelyConflict =
    directionAgreement === 0 ||
    hardConflictSignal ||
    (softConflictCount >= 3 && directionAgreement < 0.7);

  const combinedScore = overlapRatio * 0.45 + directionAgreement * 0.55;

  let agreementLevel: AgreementLevel = "low";

  if (combinedScore >= 0.72) {
    agreementLevel = "high";
  } else if (combinedScore >= 0.48) {
    agreementLevel = "medium";
  }

  if (directionAgreement === 0) {
    agreementLevel = "low";
  } else if (hardConflictSignal && agreementLevel === "high" && directionAgreement < 1) {
    agreementLevel = "medium";
  }

  let summary = "The two model outputs diverge meaningfully.";

  if (agreementLevel === "high") {
    summary = "The two model outputs are broadly aligned on the main conclusion.";
  } else if (agreementLevel === "medium") {
    summary =
      "The two model outputs partially align on the main conclusion but differ in emphasis, caveats, or conditions.";
  }

  return {
    agreementLevel,
    likelyConflict,
    overlapRatio,
    summary,
  };
}