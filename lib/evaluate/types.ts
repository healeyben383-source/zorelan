/**
 * lib/evaluate/types.ts
 *
 * Shared types for Zorelan's structured execution-gate evaluation. Used by the
 * public /v1/evaluate endpoint and the internal /api/demo/evaluate route so both
 * speak exactly the same contract.
 */

export type Verdict = "ALLOW" | "REVIEW" | "BLOCK";
export type RiskSeverity = "low" | "moderate" | "high";
export type DecisionBasis = "deterministic" | "model" | "arbitrated";
export type NextStepAction = "execute" | "open_review" | "block";
export type PolicyMatchStatus =
  | "satisfied"
  | "violated"
  | "not_applicable"
  | "indeterminate";

export interface ProposedAction {
  type: string;
  parameters?: Record<string, unknown>;
  reversible?: boolean;
  context?: Record<string, unknown>;
}

export interface Policy {
  name: string;
  rules: string[];
}

export interface EvaluateOptions {
  risk_tolerance?: "strict" | "default" | "lenient";
  require_live_data?: boolean;
  max_latency_ms?: number;
}

export interface EvaluateRequest {
  user_request?: string;
  model_output?: string;
  proposed_action: ProposedAction;
  policy: Policy;
  options?: EvaluateOptions;
}

export interface PolicyMatch {
  rule: string;
  status: PolicyMatchStatus;
  explanation: string;
}

export interface RiskFactor {
  factor: string;
  severity: RiskSeverity;
  detail?: string;
}

export interface MissingContext {
  field: string;
  why: string;
}

export interface Evidence {
  source: string; // "deterministic" | "model:<provider>"
  note: string;
}

export interface NextStep {
  action: NextStepAction;
  recommendation: string;
}

export interface UsageMeta {
  plan: string;
  callsLimit: number;
  callsUsed: number;
  callsRemaining: number;
  status: "active" | "inactive";
}

export interface EvaluateResponse {
  ok: true;
  verdict: Verdict;
  reason: string;
  policy_matches: PolicyMatch[];
  risk_factors: RiskFactor[];
  missing_context: MissingContext[];
  evidence: Evidence[];
  next_step: NextStep;
  decision_basis: DecisionBasis;
  confidence: { score: number; label: "low" | "moderate" | "high" };
  providers_used: string[];
  fell_back: boolean;
  cached: boolean;
  /** Present for authenticated customer keys; null for master key / unmetered. */
  usage?: UsageMeta | null;
  /**
   * Decision Record V1 (additive). Present on /v1/evaluate responses; the pure
   * engine and the demo route leave these undefined. The flat fields above stay
   * the source of truth — the record is a self-describing, identified projection
   * of the same decision for inspection/audit/replay.
   */
  decision_id?: string;
  decision_record?: DecisionRecord;
}

/**
 * Decision Record V1 — a structured, identified enforcement artifact for a single
 * Zorelan decision. Schema `dr-v1`. Return-only in Phase 1 (not stored). Built at
 * the route layer from the deterministic engine result plus provenance
 * (id/timestamp/latency). It is NOT a generic request/response log — it captures
 * what was evaluated, against which policy, why the verdict was reached, and what
 * to do next, in a form that can later be versioned and replayed.
 */
export interface DecisionRecord {
  schema_version: "dr-v1";
  decision_id: string;
  /** ISO 8601, server-stamped. */
  evaluated_at: string;
  /** Wall-clock for the deterministic evaluation, in milliseconds. */
  latency_ms: number;
  final_verdict: Verdict;
  action_type: string;
  /** The action as the engine interpreted it (defaults made explicit). */
  normalized_proposed_action: ProposedAction;
  /** The exact policy evaluated (caller-supplied). Foundation for policy versioning. */
  policy_snapshot: Policy;
  reason: string;
  /** Canonical structured rule outcomes. */
  policy_matches: PolicyMatch[];
  /** Convenience projections of `policy_matches` (rule text only). */
  matched_rules: string[];
  violated_rules: string[];
  missing_context: MissingContext[];
  risk_factors: RiskFactor[];
  decision_basis: DecisionBasis;
  confidence: { score: number; label: "low" | "moderate" | "high" };
  next_step: NextStep;
  recommended_next_step: string;
  /** null on a clean decision; a short code (e.g. "provider_unavailable") otherwise. */
  failure_mode: string | null;
}
