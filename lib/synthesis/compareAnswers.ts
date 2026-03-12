export type AgreementLevel = "high" | "medium" | "low";

export type ComparisonSignal = {
  agreementLevel: AgreementLevel;
  likelyConflict: boolean;
  overlapRatio: number;
  summary: string;
};

type DecisionDirection = "positive" | "negative" | "conditional" | "neutral";

type AnswerFeatures = {
  direction: DecisionDirection;
  positiveScore: number;
  negativeScore: number;
  conditionalScore: number;
  cautionScore: number;
  actionScore: number;
  normalizedWords: Set<string>;
};

function normalizeWords(text: string): string[] {
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

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function getTokenOverlapRatio(aWords: Set<string>, bWords: Set<string>): number {
  const overlapCount = [...aWords].filter((word) => bWords.has(word)).length;
  const baseSize = Math.max(Math.min(aWords.size, bWords.size), 1);
  return overlapCount / baseSize;
}

function extractFeatures(text: string): AnswerFeatures {
  const lower = text.toLowerCase();

  const positivePhrases = [
    "yes",
    "should",
    "recommended",
    "advisable",
    "good idea",
    "worth it",
    "go ahead",
    "do it",
    "beneficial",
    "healthy",
    "effective",
    "useful",
    "best option",
  ];

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
    "never",
    "risky",
    "dangerous",
    "harmful",
    "not healthy",
    "not worth it",
  ];

  const conditionalPhrases = [
    "it depends",
    "depends on",
    "depending on",
    "in some cases",
    "under certain conditions",
    "that said",
    "in that case",
    "otherwise",
    "context matters",
    "case by case",
  ];

  const cautionPhrases = [
    "be careful",
    "caution",
    "careful",
    "risk",
    "tradeoff",
    "trade-off",
    "downside",
    "uncertain",
    "uncertainty",
    "not always",
    "not necessarily",
    "long-term",
    "side effects",
    "depends",
  ];

  const actionPhrases = [
    "you should",
    "consider",
    "recommend",
    "best to",
    "the safest option",
    "the better option",
    "do this",
    "avoid this",
  ];

  const positiveScore = countMatches(lower, positivePhrases);
  const negativeScore = countMatches(lower, negativePhrases);
  const conditionalScore =
    countMatches(lower, conditionalPhrases) +
    countMatches(lower, [" if ", " unless ", " depending "]);
  const cautionScore = countMatches(lower, cautionPhrases);
  const actionScore = countMatches(lower, actionPhrases);

  let direction: DecisionDirection = "neutral";

  const positiveMargin = positiveScore - negativeScore;
  const negativeMargin = negativeScore - positiveScore;

  if (conditionalScore >= 2) {
    direction = "conditional";
  } else if (positiveMargin >= 1 && positiveScore >= 1) {
    direction = "positive";
  } else if (negativeMargin >= 1 && negativeScore >= 1) {
    direction = "negative";
  } else if (
    conditionalScore >= 1 &&
    (positiveScore >= 1 || negativeScore >= 1 || cautionScore >= 1)
  ) {
    direction = "conditional";
  }

  return {
    direction,
    positiveScore,
    negativeScore,
    conditionalScore,
    cautionScore,
    actionScore,
    normalizedWords: new Set(normalizeWords(text)),
  };
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
    return 0.7;
  }

  if (pair === "negative:neutral" || pair === "positive:neutral") {
    return 0.45;
  }

  if (pair === "negative:positive") {
    return 0;
  }

  return 0.35;
}

function getToneSimilarity(a: AnswerFeatures, b: AnswerFeatures): number {
  const cautionGap = Math.abs(a.cautionScore - b.cautionScore);
  const actionGap = Math.abs(a.actionScore - b.actionScore);

  const cautionSimilarity = 1 - clamp(cautionGap / 4);
  const actionSimilarity = 1 - clamp(actionGap / 3);

  return cautionSimilarity * 0.6 + actionSimilarity * 0.4;
}

function getRecommendationStrengthSimilarity(
  a: AnswerFeatures,
  b: AnswerFeatures
): number {
  const aStrength = Math.max(a.positiveScore, a.negativeScore);
  const bStrength = Math.max(b.positiveScore, b.negativeScore);

  const gap = Math.abs(aStrength - bStrength);
  return 1 - clamp(gap / 4);
}

export function compareAnswers(a: string, b: string): ComparisonSignal {
  const featuresA = extractFeatures(a);
  const featuresB = extractFeatures(b);

  const overlapRatio = getTokenOverlapRatio(
    featuresA.normalizedWords,
    featuresB.normalizedWords
  );

  const directionAgreement = getDirectionAgreementScore(
    featuresA.direction,
    featuresB.direction
  );

  const toneSimilarity = getToneSimilarity(featuresA, featuresB);
  const recommendationStrengthSimilarity = getRecommendationStrengthSimilarity(
    featuresA,
    featuresB
  );

  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();

  const strongConflictPhrases = [
    "do not",
    "should not",
    "don't",
    "avoid",
    "never",
    "not recommended",
    "bad idea",
    "unwise",
  ];

  const strongApprovalPhrases = [
    "yes",
    "recommended",
    "good idea",
    "worth it",
    "go ahead",
    "do it",
    "advisable",
  ];

  const aStrongConflict = countMatches(lowerA, strongConflictPhrases);
  const bStrongConflict = countMatches(lowerB, strongConflictPhrases);

  const aStrongApproval = countMatches(lowerA, strongApprovalPhrases);
  const bStrongApproval = countMatches(lowerB, strongApprovalPhrases);

  const directOpposition =
    (aStrongConflict >= 1 && bStrongApproval >= 1) ||
    (aStrongApproval >= 1 && bStrongConflict >= 1);

  const heavyConditionality =
    featuresA.conditionalScore >= 2 || featuresB.conditionalScore >= 2;

  const cautionMismatch =
    Math.abs(featuresA.cautionScore - featuresB.cautionScore) >= 3;

  const likelyConflict =
    directionAgreement === 0 ||
    directOpposition ||
    (directionAgreement < 0.7 && cautionMismatch && overlapRatio < 0.35);

  const combinedScore =
    overlapRatio * 0.28 +
    directionAgreement * 0.4 +
    toneSimilarity * 0.17 +
    recommendationStrengthSimilarity * 0.15;

  let agreementLevel: AgreementLevel = "low";

  if (combinedScore >= 0.74) {
    agreementLevel = "high";
  } else if (combinedScore >= 0.5) {
    agreementLevel = "medium";
  }

  if (directionAgreement === 0 || directOpposition) {
    agreementLevel = "low";
  } else if (
    agreementLevel === "high" &&
    heavyConditionality &&
    directionAgreement < 1
  ) {
    agreementLevel = "medium";
  } else if (
    agreementLevel === "high" &&
    overlapRatio < 0.2 &&
    toneSimilarity < 0.55
  ) {
    agreementLevel = "medium";
  }

  let summary = "The two model outputs diverge meaningfully.";

  if (agreementLevel === "high") {
    summary =
      "The two model outputs are broadly aligned on the main conclusion, with only minor framing differences.";
  } else if (agreementLevel === "medium") {
    summary =
      "The two model outputs partially align on the main conclusion but differ in caveats, framing, or conditions.";
  }

  return {
    agreementLevel,
    likelyConflict,
    overlapRatio,
    summary,
  };
}