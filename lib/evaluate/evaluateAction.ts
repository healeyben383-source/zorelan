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

// Note: free-text policy.rules are NEVER matched to a verdict. Only the refund
// evaluator enforces (via typed policy.controls.refund). Every other evaluator
// leaves policy_matches empty and routes to REVIEW/BLOCK — the supplied rules
// survive only in the Decision Record's policy_snapshot as human context.

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

/**
 * Account deletion — destructive, never auto-ALLOW. The caller-supplied
 * `reversible` field is deliberately IGNORED (it cannot be trusted to unlock a
 * destructive action). Only two outcomes:
 *   identity_verified !== true → BLOCK
 *   identity_verified === true → REVIEW (human confirmation still required)
 * policy_matches stays empty — free-text rules are never presented as enforced.
 */
function evaluateAccountDeletion(req: EvaluateRequest): EvaluateResponse {
  const ctx = req.proposed_action.context ?? {};
  const identityVerified = asBool(ctx.identity_verified) === true;

  if (!identityVerified) {
    return {
      ok: true,
      verdict: "BLOCK",
      reason:
        "Account deletion is destructive and the requester's identity is not verified. It cannot be executed without a verified account owner.",
      policy_matches: [],
      risk_factors: [
        { factor: "irreversible_action", severity: "high" },
        { factor: "identity_unverified", severity: "high" },
        { factor: "data_loss", severity: "high" },
      ],
      missing_context: [
        {
          field: "identity_verified",
          why: "Account deletion requires a verified account owner before it can be considered.",
        },
      ],
      evidence: [
        {
          source: "deterministic",
          note: "identity_verified is not true; account deletion is destructive and is blocked.",
        },
      ],
      next_step: {
        action: "block",
        recommendation:
          "Do not delete the account. Verify the account owner's identity, then route to human review.",
      },
      decision_basis: "deterministic",
      confidence: scoreToConfidence(90),
      providers_used: [],
      fell_back: false,
      cached: false,
    };
  }

  return {
    ok: true,
    verdict: "REVIEW",
    reason:
      "Identity is verified, but account deletion is destructive and irreversible. A human must confirm intent before the data is destroyed — Zorelan does not auto-approve account deletions.",
    policy_matches: [],
    risk_factors: [
      { factor: "irreversible_action", severity: "high" },
      { factor: "data_loss", severity: "high" },
    ],
    missing_context: [],
    evidence: [
      {
        source: "deterministic",
        note: "identity_verified is true; deletion is destructive, so human confirmation is required.",
      },
    ],
    next_step: {
      action: "open_review",
      recommendation:
        "Route to a human approver to confirm the owner intends permanent deletion.",
    },
    decision_basis: "deterministic",
    confidence: scoreToConfidence(85),
    providers_used: [],
    fell_back: false,
    cached: false,
  };
}

/**
 * Subscription changes (downgrade_subscription and change_subscription) — always
 * REVIEW. Zorelan does not yet validate plan consequences (price, feature/data
 * loss, cancellation, upgrade, ownership) and `change_subscription` is too broad
 * to distinguish them, so no caller boolean unlocks ALLOW. No policy_matches.
 */
function evaluateSubscriptionChange(req: EvaluateRequest): EvaluateResponse {
  const isBroadChange = req.proposed_action.type === "change_subscription";
  const reason = isBroadChange
    ? "The change_subscription action is too broad for deterministic approval: it does not distinguish downgrades, upgrades, cancellations, price increases, data deletion or ownership changes. It is routed to human review because its consequences are not deterministically validated."
    : "Subscription changes are routed to human review: Zorelan does not yet validate plan consequences (price, feature loss, or data impact) for subscription actions, so it does not auto-approve them.";

  return {
    ok: true,
    verdict: "REVIEW",
    reason,
    policy_matches: [],
    risk_factors: [{ factor: "unvalidated_consequences", severity: "moderate" }],
    missing_context: [],
    evidence: [
      {
        source: "deterministic",
        note: `Subscription action "${req.proposed_action.type}" routed to REVIEW; plan consequences are not deterministically validated.`,
      },
    ],
    next_step: {
      action: "open_review",
      recommendation:
        "Route to human review to confirm the subscription change and its consequences.",
    },
    decision_basis: "deterministic",
    confidence: scoreToConfidence(70),
    providers_used: [],
    fell_back: false,
    cached: false,
  };
}

/**
 * CRM record updates — always REVIEW. There is no typed field allowlist yet, so
 * Zorelan cannot distinguish harmless notes from identity, permission, role,
 * financial, deletion or bulk changes. A caller-supplied `source_verified` does
 * NOT unlock ALLOW. No policy_matches — free-text rules are never enforced here.
 */
function evaluateCrmUpdate(req: EvaluateRequest): EvaluateResponse {
  const params = req.proposed_action.parameters ?? {};
  const field = asString(params.field);
  const dataRisk: RiskFactor = field
    ? { factor: "unvalidated_field_scope", severity: "moderate", detail: field }
    : { factor: "unvalidated_field_scope", severity: "moderate" };

  return {
    ok: true,
    verdict: "REVIEW",
    reason:
      "Customer-record writes are routed to human review. Zorelan does not yet have a typed allowlist of permitted fields or operations, so it cannot distinguish harmless notes from identity, permission, financial, deletion or bulk changes, and it does not auto-approve CRM updates.",
    policy_matches: [],
    risk_factors: [dataRisk],
    missing_context: [],
    evidence: [
      {
        source: "deterministic",
        note: "CRM update routed to REVIEW; permitted fields and operation scope are not deterministically defined.",
      },
    ],
    next_step: {
      action: "open_review",
      recommendation:
        "Review the customer-record change manually until permitted fields and operations are deterministically defined.",
    },
    decision_basis: "deterministic",
    confidence: scoreToConfidence(72),
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
