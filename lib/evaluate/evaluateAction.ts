/**
 * lib/evaluate/evaluateAction.ts
 *
 * Deterministic Stage 0 execution-gate engine — the shared product logic behind
 * both the public /v1/evaluate endpoint and the internal /api/demo/evaluate route.
 *
 * Guarantees:
 *   - Pure function. No I/O, no model calls, no secrets required. It can run
 *     anywhere and never fabricates a verdict.
 *   - Decisions are driven by STRUCTURED context fields (amount, order_status,
 *     identity_verified, reversible, source/evidence), NOT by regex on free text.
 *     Policy rule strings are matched to a determination only to *label* which
 *     rule applied — every decision is surfaced as decision_basis "deterministic"
 *     with an explicit evidence note.
 *   - Fails safe: unknown action types route to REVIEW, never auto-ALLOW.
 *
 * MODEL_JUDGEMENT_TODO (next pass): an optional Stage 1 single-model judgement may
 * run AFTER this function for cases not resolved deterministically. It must never
 * upgrade a deterministic BLOCK/REVIEW to ALLOW — only add reasoning or tighten,
 * and on provider failure it must set fell_back=true and fail closed to REVIEW.
 */

import type {
  EvaluateRequest,
  EvaluateResponse,
  PolicyMatch,
  RiskFactor,
  RiskSeverity,
} from "./types";

// ── Small, explicit helpers (no regex on policy text drives any decision) ───────

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return null;
}

function asBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return undefined;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function formatMoney(amount: number, currency: string): string {
  return `$${amount.toLocaleString("en-US")}${currency ? ` ${currency}` : ""}`;
}

function confidenceLabel(score: number): "low" | "moderate" | "high" {
  if (score >= 75) return "high";
  if (score >= 55) return "moderate";
  return "low";
}

function scoreToConfidence(score: number): {
  score: number;
  label: "low" | "moderate" | "high";
} {
  return { score, label: confidenceLabel(score) };
}

/**
 * Find the policy rule that best matches a set of keywords, so a determination
 * can be *labelled* with the customer's own rule text. This only affects which
 * string is displayed — never the verdict, which is computed from structured
 * fields above.
 */
function ruleMatching(rules: string[], keywords: string[]): string | undefined {
  const lowerKeywords = keywords.map((k) => k.toLowerCase());
  return rules.find((rule) => {
    const r = rule.toLowerCase();
    return lowerKeywords.some((k) => r.includes(k));
  });
}

// ── Per-action evaluators ───────────────────────────────────────────────────────

function evaluateRefund(req: EvaluateRequest): EvaluateResponse {
  const params = req.proposed_action.parameters ?? {};
  const ctx = req.proposed_action.context ?? {};
  const rules = req.policy.rules ?? [];

  const amount = asNumber(params.amount) ?? 0;
  const currency = asString(params.currency) ?? "USD";
  const orderStatus = asString(ctx.order_status);
  const deliveryConfirmed =
    asBool(ctx.delivery_confirmed) === true ||
    orderStatus === "delivery_confirmed";
  const reversible = req.proposed_action.reversible ?? false;

  const overThreshold = amount > 100;
  const thresholdRule =
    ruleMatching(rules, ["confirmation", "$100", "100", "above"]) ?? rules[0];
  const unresolvedRule =
    ruleMatching(rules, ["unresolved", "delivery status", "must not"]) ?? rules[1];

  // Deterministic BLOCK floor: large refund without confirmed delivery.
  if (overThreshold && !deliveryConfirmed) {
    const policy_matches: PolicyMatch[] = [];
    if (thresholdRule) {
      policy_matches.push({
        rule: thresholdRule,
        status: "violated",
        explanation: `Refund amount ${formatMoney(
          amount,
          currency
        )} is above the $100 threshold and delivery confirmation is missing.`,
      });
    }
    if (unresolvedRule) {
      policy_matches.push({
        rule: unresolvedRule,
        status: "violated",
        explanation: `order_status is "${
          orderStatus ?? "unknown"
        }", which is an unresolved delivery state.`,
      });
    }

    const risk_factors: RiskFactor[] = [
      { factor: "financial_exposure", severity: "high", detail: formatMoney(amount, currency) },
      { factor: "unverified_precondition", severity: "high", detail: "delivery status" },
    ];
    if (!reversible) {
      risk_factors.unshift({ factor: "irreversible_action", severity: "high" });
    }

    return {
      ok: true,
      verdict: "BLOCK",
      reason: `Refund of ${formatMoney(
        amount,
        currency
      )} exceeds the $100 threshold and delivery is unconfirmed (order_status="${
        orderStatus ?? "unknown"
      }"). Issuing it would violate the refund policy.`,
      policy_matches,
      risk_factors,
      missing_context: [
        {
          field: "delivery_confirmed",
          why: "Required by policy before a refund over $100 can be issued.",
        },
      ],
      evidence: [
        {
          source: "deterministic",
          note: `Matched on amount=${amount} (> 100) and order_status="${
            orderStatus ?? "unknown"
          }".`,
        },
      ],
      next_step: {
        action: "block",
        recommendation:
          "Do not issue the refund. Request delivery confirmation, then re-evaluate.",
      },
      decision_basis: "deterministic",
      confidence: scoreToConfidence(94),
      providers_used: [],
      fell_back: false,
      cached: false,
    };
  }

  // Large refund WITH confirmed delivery — policy satisfied.
  if (overThreshold && deliveryConfirmed) {
    const policy_matches: PolicyMatch[] = [];
    if (thresholdRule) {
      policy_matches.push({
        rule: thresholdRule,
        status: "satisfied",
        explanation: `Delivery is confirmed, so a refund of ${formatMoney(
          amount,
          currency
        )} is permitted.`,
      });
    }
    if (unresolvedRule) {
      policy_matches.push({
        rule: unresolvedRule,
        status: "satisfied",
        explanation: `order_status is "${orderStatus ?? "delivery_confirmed"}" — delivery is resolved.`,
      });
    }
    return {
      ok: true,
      verdict: "ALLOW",
      reason: `Refund of ${formatMoney(
        amount,
        currency
      )} is permitted: delivery is confirmed and policy conditions are satisfied.`,
      policy_matches,
      risk_factors: [
        { factor: "financial_exposure", severity: "moderate", detail: formatMoney(amount, currency) },
      ],
      missing_context: [],
      evidence: [
        {
          source: "deterministic",
          note: `Matched on amount=${amount} with confirmed delivery.`,
        },
      ],
      next_step: {
        action: "execute",
        recommendation: "Conditions met. Safe to issue the refund.",
      },
      decision_basis: "deterministic",
      confidence: scoreToConfidence(88),
      providers_used: [],
      fell_back: false,
      cached: false,
    };
  }

  // Small refund (<= $100) — under the policy threshold.
  return {
    ok: true,
    verdict: "ALLOW",
    reason: `Refund of ${formatMoney(
      amount,
      currency
    )} is at or below the $100 threshold and does not require delivery confirmation.`,
    policy_matches: thresholdRule
      ? [
          {
            rule: thresholdRule,
            status: "not_applicable",
            explanation: `Amount ${formatMoney(amount, currency)} does not exceed $100.`,
          },
        ]
      : [],
    risk_factors: [
      { factor: "financial_exposure", severity: "low", detail: formatMoney(amount, currency) },
    ],
    missing_context: [],
    evidence: [
      { source: "deterministic", note: `Matched on amount=${amount} (<= 100).` },
    ],
    next_step: {
      action: "execute",
      recommendation: "Low-value refund within policy. Safe to issue.",
    },
    decision_basis: "deterministic",
    confidence: scoreToConfidence(85),
    providers_used: [],
    fell_back: false,
    cached: false,
  };
}

function evaluateAccountDeletion(req: EvaluateRequest): EvaluateResponse {
  const ctx = req.proposed_action.context ?? {};
  const rules = req.policy.rules ?? [];

  const identityVerified = asBool(ctx.identity_verified) === true;
  const reversible = req.proposed_action.reversible ?? false;
  const identityRule =
    ruleMatching(rules, ["identity", "verified", "owner"]) ?? rules[0];

  // Deterministic BLOCK floor: irreversible action without verified identity.
  if (!reversible && !identityVerified) {
    return {
      ok: true,
      verdict: "BLOCK",
      reason:
        "Account deletion is irreversible and the requester's identity is not verified. Executing it could destroy data on an unverified request.",
      policy_matches: identityRule
        ? [
            {
              rule: identityRule,
              status: "violated",
              explanation: "identity_verified is false for an irreversible action.",
            },
          ]
        : [],
      risk_factors: [
        { factor: "irreversible_action", severity: "high" },
        { factor: "identity_unverified", severity: "high" },
        { factor: "data_loss", severity: "high" },
      ],
      missing_context: [
        {
          field: "identity_verified",
          why: "Irreversible actions require a verified account owner before they can run.",
        },
      ],
      evidence: [
        {
          source: "deterministic",
          note: "Matched on reversible=false and identity_verified=false.",
        },
      ],
      next_step: {
        action: "block",
        recommendation:
          "Do not delete the account. Verify the account owner's identity, then re-evaluate.",
      },
      decision_basis: "deterministic",
      confidence: scoreToConfidence(95),
      providers_used: [],
      fell_back: false,
      cached: false,
    };
  }

  // Identity verified but still irreversible — require human confirmation.
  if (!reversible && identityVerified) {
    return {
      ok: true,
      verdict: "REVIEW",
      reason:
        "Identity is verified, but account deletion is irreversible. A human should confirm intent before the data is destroyed.",
      policy_matches: identityRule
        ? [
            {
              rule: identityRule,
              status: "satisfied",
              explanation: "identity_verified is true.",
            },
          ]
        : [],
      risk_factors: [
        { factor: "irreversible_action", severity: "high" },
        { factor: "data_loss", severity: "high" },
      ],
      missing_context: [],
      evidence: [
        {
          source: "deterministic",
          note: "Matched on reversible=false with identity_verified=true.",
        },
      ],
      next_step: {
        action: "open_review",
        recommendation:
          "Route to human review to confirm the owner intends permanent deletion.",
      },
      decision_basis: "deterministic",
      confidence: scoreToConfidence(82),
      providers_used: [],
      fell_back: false,
      cached: false,
    };
  }

  // Reversible deletion (e.g. soft-delete) with verified identity — allow.
  return {
    ok: true,
    verdict: "ALLOW",
    reason:
      "Deletion is reversible and identity is verified, so it can proceed safely.",
    policy_matches: identityRule
      ? [
          {
            rule: identityRule,
            status: "satisfied",
            explanation: "identity_verified is true and the action is reversible.",
          },
        ]
      : [],
    risk_factors: [{ factor: "reversible_action", severity: "low" }],
    missing_context: [],
    evidence: [
      {
        source: "deterministic",
        note: "Matched on reversible=true with identity_verified=true.",
      },
    ],
    next_step: {
      action: "execute",
      recommendation: "Reversible and verified. Safe to proceed.",
    },
    decision_basis: "deterministic",
    confidence: scoreToConfidence(84),
    providers_used: [],
    fell_back: false,
    cached: false,
  };
}

function evaluateSubscriptionChange(req: EvaluateRequest): EvaluateResponse {
  const ctx = req.proposed_action.context ?? {};
  const rules = req.policy.rules ?? [];

  const identityVerified = asBool(ctx.identity_verified) === true;
  const reversible = req.proposed_action.reversible ?? false;
  const selfServiceAllowed = asBool(ctx.self_service_allowed) !== false; // default permitted
  const selfServiceRule =
    ruleMatching(rules, ["self-serve", "self service", "downgrade", "authenticated"]) ??
    rules[0];

  // Authenticated, reversible, self-service-permitted downgrade — allow.
  if (identityVerified && reversible && selfServiceAllowed) {
    return {
      ok: true,
      verdict: "ALLOW",
      reason:
        "Authenticated user requesting a reversible, self-service plan downgrade. Policy permits this without human review.",
      policy_matches: selfServiceRule
        ? [
            {
              rule: selfServiceRule,
              status: "satisfied",
              explanation:
                "identity_verified is true, the change is reversible, and self-service downgrades are allowed.",
            },
          ]
        : [],
      risk_factors: [{ factor: "reversible_action", severity: "low" }],
      missing_context: [],
      evidence: [
        {
          source: "deterministic",
          note: "Matched on identity_verified=true, reversible=true, self_service_allowed=true.",
        },
      ],
      next_step: {
        action: "execute",
        recommendation:
          "Safe to apply the downgrade at the next billing cycle.",
      },
      decision_basis: "deterministic",
      confidence: scoreToConfidence(90),
      providers_used: [],
      fell_back: false,
      cached: false,
    };
  }

  // Not authenticated — review before changing billing.
  if (!identityVerified) {
    return {
      ok: true,
      verdict: "REVIEW",
      reason:
        "A plan change was requested but the user's identity is not verified. Confirm the account owner before changing billing.",
      policy_matches: selfServiceRule
        ? [
            {
              rule: selfServiceRule,
              status: "violated",
              explanation: "Self-service changes require an authenticated user; identity_verified is false.",
            },
          ]
        : [],
      risk_factors: [{ factor: "identity_unverified", severity: "moderate" }],
      missing_context: [
        {
          field: "identity_verified",
          why: "Billing changes require an authenticated account owner.",
        },
      ],
      evidence: [
        { source: "deterministic", note: "Matched on identity_verified=false." },
      ],
      next_step: {
        action: "open_review",
        recommendation: "Verify the account owner, then re-evaluate.",
      },
      decision_basis: "deterministic",
      confidence: scoreToConfidence(80),
      providers_used: [],
      fell_back: false,
      cached: false,
    };
  }

  // Authenticated but irreversible or not self-service — review.
  const reviewRisk: RiskFactor[] = [];
  if (!reversible) {
    reviewRisk.push({ factor: "irreversible_action", severity: "moderate" as RiskSeverity });
  }
  return {
    ok: true,
    verdict: "REVIEW",
    reason:
      "Plan change is authenticated but is either irreversible or not eligible for self-service. Route to human review.",
    policy_matches: [],
    risk_factors: reviewRisk,
    missing_context: [],
    evidence: [
      {
        source: "deterministic",
        note: `Matched on reversible=${reversible}, self_service_allowed=${selfServiceAllowed}.`,
      },
    ],
    next_step: {
      action: "open_review",
      recommendation: "Confirm eligibility before applying the change.",
    },
    decision_basis: "deterministic",
    confidence: scoreToConfidence(78),
    providers_used: [],
    fell_back: false,
    cached: false,
  };
}

function evaluateCrmUpdate(req: EvaluateRequest): EvaluateResponse {
  const ctx = req.proposed_action.context ?? {};
  const params = req.proposed_action.parameters ?? {};
  const rules = req.policy.rules ?? [];

  const sourceVerified = asBool(ctx.source_verified);
  const evidenceStrength = asString(ctx.evidence_strength);
  const weakEvidence = sourceVerified === false || evidenceStrength === "weak";
  const field = asString(params.field) ?? "record";
  const sourceRule =
    ruleMatching(rules, ["source", "verified", "reviewed"]) ?? rules[0];

  // Weak / unverified evidence — review before writing.
  if (weakEvidence) {
    return {
      ok: true,
      verdict: "REVIEW",
      reason: `The proposed update to "${field}" is backed by weak or unverified evidence. It should be reviewed before being written to the customer record.`,
      policy_matches: sourceRule
        ? [
            {
              rule: sourceRule,
              status: "violated",
              explanation: `source_verified=${String(
                sourceVerified
              )}, evidence_strength="${evidenceStrength ?? "unknown"}".`,
            },
          ]
        : [],
      risk_factors: [
        { factor: "data_integrity", severity: "moderate", detail: field },
        { factor: "unverified_source", severity: "moderate" },
      ],
      missing_context: [
        {
          field: "source_verified",
          why: "Customer-record changes require a verified source before they are written.",
        },
      ],
      evidence: [
        {
          source: "deterministic",
          note: `Matched on source_verified=${String(
            sourceVerified
          )} / evidence_strength="${evidenceStrength ?? "unknown"}".`,
        },
      ],
      next_step: {
        action: "open_review",
        recommendation:
          "Hold the write. Verify the source of the data, then re-evaluate.",
      },
      decision_basis: "deterministic",
      confidence: scoreToConfidence(83),
      providers_used: [],
      fell_back: false,
      cached: false,
    };
  }

  // Verified source — allow.
  return {
    ok: true,
    verdict: "ALLOW",
    reason: `The update to "${field}" is backed by a verified source and can be written.`,
    policy_matches: sourceRule
      ? [
          {
            rule: sourceRule,
            status: "satisfied",
            explanation: "source_verified is true.",
          },
        ]
      : [],
    risk_factors: [{ factor: "data_integrity", severity: "low", detail: field }],
    missing_context: [],
    evidence: [
      { source: "deterministic", note: "Matched on source_verified=true." },
    ],
    next_step: {
      action: "execute",
      recommendation: "Verified source. Safe to write the record.",
    },
    decision_basis: "deterministic",
    confidence: scoreToConfidence(86),
    providers_used: [],
    fell_back: false,
    cached: false,
  };
}

/**
 * Unknown action type — fail safe. We never auto-ALLOW something we do not have
 * a deterministic rule for; we route it to human review and say why.
 */
function evaluateUnknown(req: EvaluateRequest): EvaluateResponse {
  return {
    ok: true,
    verdict: "REVIEW",
    reason: `No deterministic policy check exists for action type "${req.proposed_action.type}". Routing to human review rather than guessing.`,
    policy_matches: [],
    risk_factors: [{ factor: "unrecognized_action", severity: "moderate" }],
    missing_context: [],
    evidence: [
      {
        source: "deterministic",
        note: `No evaluator registered for type "${req.proposed_action.type}".`,
      },
    ],
    next_step: {
      action: "open_review",
      recommendation:
        "Review manually. A deterministic rule (or model judgement, in a later pass) is needed for this action type.",
    },
    decision_basis: "deterministic",
    confidence: scoreToConfidence(50),
    providers_used: [],
    fell_back: false,
    cached: false,
  };
}

// ── Public entry point ──────────────────────────────────────────────────────────

/** Action types with a dedicated deterministic evaluator. */
export const SUPPORTED_ACTION_TYPES = [
  "refund_customer",
  "delete_account",
  "downgrade_subscription",
  "change_subscription",
  "update_crm_record",
] as const;

/**
 * Deterministic Stage 0 evaluation. Pure function — no I/O, no model calls.
 * See MODEL_JUDGEMENT_TODO at the top of this file for the planned Stage 1.
 */
export function evaluateActionDeterministic(
  req: EvaluateRequest
): EvaluateResponse {
  switch (req.proposed_action.type) {
    case "refund_customer":
      return evaluateRefund(req);
    case "delete_account":
      return evaluateAccountDeletion(req);
    case "downgrade_subscription":
    case "change_subscription":
      return evaluateSubscriptionChange(req);
    case "update_crm_record":
      return evaluateCrmUpdate(req);
    default:
      return evaluateUnknown(req);
  }
}
