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
}
