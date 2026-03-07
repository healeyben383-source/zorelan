export type AgreementLevel = "high" | "medium" | "low";

export type ComparisonSignal = {
  agreementLevel: AgreementLevel;
  likelyConflict: boolean;
  overlapRatio: number;
  summary: string;
};

function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => word.length > 2);
}

export function compareAnswers(a: string, b: string): ComparisonSignal {
  const aWords = new Set(normalize(a));
  const bWords = new Set(normalize(b));

  const overlapCount = [...aWords].filter((word) => bWords.has(word)).length;
  const baseSize = Math.max(Math.min(aWords.size, bWords.size), 1);
  const overlapRatio = overlapCount / baseSize;

  const conflictTerms = [
    "however",
    "instead",
    "alternatively",
    "on the other hand",
    "tradeoff",
    "trade-off",
    "depends",
    "versus",
    "vs",
    "but",
  ];

  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();

  const likelyConflict =
    conflictTerms.some((term) => lowerA.includes(term)) ||
    conflictTerms.some((term) => lowerB.includes(term));

  let agreementLevel: AgreementLevel = "low";

  if (overlapRatio >= 0.45) {
    agreementLevel = "high";
  } else if (overlapRatio >= 0.25) {
    agreementLevel = "medium";
  }

  if (likelyConflict && agreementLevel === "high") {
    agreementLevel = "medium";
  }

  let summary = "The two model outputs diverge meaningfully.";

  if (agreementLevel === "high") {
    summary = "The two model outputs are broadly aligned.";
  } else if (agreementLevel === "medium") {
    summary = "The two model outputs partially align but differ in emphasis.";
  }

  return {
    agreementLevel,
    likelyConflict,
    overlapRatio,
    summary,
  };
}