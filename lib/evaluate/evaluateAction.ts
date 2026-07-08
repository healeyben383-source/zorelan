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
  MissingContext,
  NextStep,
  PolicyControls,
  PolicyMatch,
  RiskFactor,
  RiskSeverity,
  Verdict,
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

/**
 * Refund evaluator — enforces the caller's TYPED controls (policy.controls.refund),
 * never a hardcoded threshold. Verdict comes from the caller's numeric limits.
 * A refund at or above `absolute_review_limit` always REVIEWs regardless of any
 * caller-supplied boolean (high-value safeguard). Absent/invalid/mismatched controls
 * fail safe to REVIEW — Zorelan never applies an undocumented threshold, and never
 * lets the free-text `rules` drive the numeric decision.
 */
function evaluateRefund(req: EvaluateRequest): EvaluateResponse {
  const params = req.proposed_action.parameters ?? {};
  const ctx = req.proposed_action.context ?? {};
  const controls = req.policy.controls?.refund;

  const amount = asNumber(params.amount) ?? 0;
  const paramCurrency = asString(params.currency);
  const orderStatus = asString(ctx.order_status);
  const deliveryConfirmed =
    asBool(ctx.delivery_confirmed) === true ||
    orderStatus === "delivery_confirmed";
  const reversible = req.proposed_action.reversible ?? false;

  // Shared builder so every refund verdict is consistent and records what applied.
  const mk = (input: {
    verdict: Verdict;
    reason: string;
    policy_matches: PolicyMatch[];
    risk_factors: RiskFactor[];
    missing_context?: MissingContext[];
    evidenceNote: string;
    next_step: NextStep;
    confidence: number;
    applied: PolicyControls | null;
  }): EvaluateResponse => ({
    ok: true,
    verdict: input.verdict,
    reason: input.reason,
    policy_matches: input.policy_matches,
    risk_factors: input.risk_factors,
    missing_context: input.missing_context ?? [],
    evidence: [{ source: "deterministic", note: input.evidenceNote }],
    next_step: input.next_step,
    decision_basis: "deterministic",
    confidence: scoreToConfidence(input.confidence),
    providers_used: [],
    fell_back: false,
    cached: false,
    policy_controls_applied: input.applied,
  });

  // (1) Fail-safe: no typed refund controls → REVIEW. Free-text rules are not
  //     enforced, and no hidden threshold is applied.
  if (!controls) {
    return mk({
      verdict: "REVIEW",
      reason:
        "No typed refund controls were supplied (policy.controls.refund). Zorelan does not enforce free-text policy rules, so this refund is routed to human review.",
      policy_matches: [],
      risk_factors: [
        { factor: "missing_policy_controls", severity: "moderate" },
        {
          factor: "financial_exposure",
          severity: amount > 0 ? "moderate" : "low",
          detail: formatMoney(amount, paramCurrency ?? ""),
        },
      ],
      missing_context: [
        {
          field: "policy.controls.refund",
          why: "Typed refund controls (currency, auto_allow_limit, absolute_review_limit, require_delivery_confirmation_above_auto_allow_limit) are required to deterministically approve a refund.",
        },
      ],
      evidenceNote:
        "No policy.controls.refund present; free-text rules are not enforced. Routed to REVIEW.",
      next_step: {
        action: "open_review",
        recommendation:
          "Supply typed refund controls under policy.controls.refund, or review this refund manually.",
      },
      confidence: 55,
      applied: null,
    });
  }

  // (2) Defensive control validation (the request schema also enforces this; this
  //     guards direct engine use / tests that bypass zod).
  if (
    controls.auto_allow_limit < 0 ||
    controls.absolute_review_limit < 0 ||
    controls.auto_allow_limit > controls.absolute_review_limit
  ) {
    return mk({
      verdict: "REVIEW",
      reason:
        "Refund controls are invalid (negative or conflicting limits). Cannot enforce deterministically; routing to human review.",
      policy_matches: [
        {
          rule: "refund.controls",
          status: "indeterminate",
          explanation: `Invalid controls: auto_allow_limit=${controls.auto_allow_limit}, absolute_review_limit=${controls.absolute_review_limit}.`,
        },
      ],
      risk_factors: [{ factor: "invalid_policy_controls", severity: "high" }],
      evidenceNote: `Invalid refund controls: auto_allow_limit=${controls.auto_allow_limit}, absolute_review_limit=${controls.absolute_review_limit}.`,
      next_step: {
        action: "open_review",
        recommendation: "Fix policy.controls.refund limits, then re-evaluate.",
      },
      confidence: 55,
      applied: null,
    });
  }

  // (3) Currency mismatch → cannot compare the amount to the limits → REVIEW.
  if (paramCurrency && paramCurrency !== controls.currency) {
    return mk({
      verdict: "REVIEW",
      reason: `Refund currency (${paramCurrency}) does not match the policy control currency (${controls.currency}). Cannot compare against the configured limits; routing to human review.`,
      policy_matches: [
        {
          rule: "refund.currency",
          status: "violated",
          explanation: `Action currency "${paramCurrency}" does not match control currency "${controls.currency}".`,
        },
      ],
      risk_factors: [
        { factor: "currency_mismatch", severity: "high", detail: `${paramCurrency} vs ${controls.currency}` },
      ],
      missing_context: [
        {
          field: "parameters.currency",
          why: `Must match the policy control currency "${controls.currency}".`,
        },
      ],
      evidenceNote: `Currency mismatch: parameters.currency="${paramCurrency}", controls.currency="${controls.currency}".`,
      next_step: {
        action: "open_review",
        recommendation:
          "Align the refund currency with the policy control currency, then re-evaluate.",
      },
      confidence: 55,
      applied: null,
    });
  }

  const applied: PolicyControls = { refund: controls };
  const money = (a: number) => formatMoney(a, controls.currency);
  const controlsNote = `Applied refund controls: currency=${controls.currency}, auto_allow_limit=${controls.auto_allow_limit}, absolute_review_limit=${controls.absolute_review_limit}, require_delivery_confirmation_above_auto_allow_limit=${controls.require_delivery_confirmation_above_auto_allow_limit}. amount=${amount}, delivery_confirmed=${deliveryConfirmed}, reversible=${reversible}.`;

  const baseRisk = (sev: RiskSeverity): RiskFactor[] => {
    const r: RiskFactor[] = [
      { factor: "financial_exposure", severity: sev, detail: money(amount) },
    ];
    if (!reversible) r.unshift({ factor: "irreversible_action", severity: sev });
    return r;
  };

  // (4) HIGH-VALUE SAFEGUARD: at or above the absolute review ceiling → REVIEW,
  //     regardless of delivery_confirmed or any other caller-supplied boolean.
  //     Checked before the auto-allow band so the ceiling wins any tie.
  if (amount >= controls.absolute_review_limit) {
    return mk({
      verdict: "REVIEW",
      reason: `Refund of ${money(amount)} is at or above the absolute review limit (${money(controls.absolute_review_limit)}). It requires human review regardless of delivery confirmation.`,
      policy_matches: [
        {
          rule: "refund.absolute_review_limit",
          status: "violated",
          explanation: `Amount ${money(amount)} is at or above absolute_review_limit ${money(controls.absolute_review_limit)}.`,
        },
      ],
      risk_factors: baseRisk("high"),
      evidenceNote: controlsNote,
      next_step: {
        action: "open_review",
        recommendation:
          "High-value refund. Route to a human approver before issuing.",
      },
      confidence: 90,
      applied,
    });
  }

  // (5) Auto-allow band: at or below auto_allow_limit → ALLOW.
  if (amount <= controls.auto_allow_limit) {
    return mk({
      verdict: "ALLOW",
      reason: `Refund of ${money(amount)} is at or below the auto-allow limit (${money(controls.auto_allow_limit)}). Safe to issue.`,
      policy_matches: [
        {
          rule: "refund.auto_allow_limit",
          status: "satisfied",
          explanation: `Amount ${money(amount)} is within auto_allow_limit ${money(controls.auto_allow_limit)}.`,
        },
      ],
      risk_factors: baseRisk("low"),
      evidenceNote: controlsNote,
      next_step: {
        action: "execute",
        recommendation: "Within the auto-allow limit. Safe to issue the refund.",
      },
      confidence: 92,
      applied,
    });
  }

  // (6) Above auto_allow_limit and within the ceiling: confirmation gate.
  if (controls.require_delivery_confirmation_above_auto_allow_limit && !deliveryConfirmed) {
    return mk({
      verdict: "BLOCK",
      reason: `Refund of ${money(amount)} is above the auto-allow limit (${money(controls.auto_allow_limit)}) and delivery is not confirmed, which the policy requires. Do not issue.`,
      policy_matches: [
        {
          rule: "refund.auto_allow_limit",
          status: "violated",
          explanation: `Amount ${money(amount)} exceeds auto_allow_limit ${money(controls.auto_allow_limit)}.`,
        },
        {
          rule: "refund.require_delivery_confirmation_above_auto_allow_limit",
          status: "violated",
          explanation: `require_delivery_confirmation_above_auto_allow_limit is true and delivery is not confirmed (order_status="${orderStatus ?? "unknown"}").`,
        },
      ],
      risk_factors: baseRisk("high").concat({
        factor: "unverified_precondition",
        severity: "high",
        detail: "delivery status",
      }),
      missing_context: [
        {
          field: "delivery_confirmed",
          why: `Required by policy for refunds above the auto-allow limit (${money(controls.auto_allow_limit)}).`,
        },
      ],
      evidenceNote: controlsNote,
      next_step: {
        action: "block",
        recommendation:
          "Do not issue the refund. Obtain delivery confirmation, then re-evaluate.",
      },
      confidence: 94,
      applied,
    });
  }

  // Above auto_allow_limit but confirmation satisfied (or not required).
  return mk({
    verdict: "ALLOW",
    reason: `Refund of ${money(amount)} is above the auto-allow limit (${money(controls.auto_allow_limit)}) but within the absolute review limit, and the delivery-confirmation requirement is satisfied. Safe to issue.`,
    policy_matches: [
      {
        rule: "refund.require_delivery_confirmation_above_auto_allow_limit",
        status: "satisfied",
        explanation: controls.require_delivery_confirmation_above_auto_allow_limit
          ? "Delivery is confirmed for a refund above the auto-allow limit."
          : "Delivery confirmation is not required by policy in this band.",
      },
    ],
    risk_factors: baseRisk("moderate"),
    evidenceNote: controlsNote,
    next_step: {
      action: "execute",
      recommendation: "Conditions met. Safe to issue the refund.",
    },
    confidence: 88,
    applied,
  });
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
