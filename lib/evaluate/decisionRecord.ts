/**
 * lib/evaluate/decisionRecord.ts
 *
 * Decision Record V1 (schema `dr-v1`) builder.
 *
 * `buildDecisionRecord` is a PURE projection of an already-computed engine result
 * plus provenance passed in by the caller (decision_id, timestamp, latency). It
 * performs no I/O and no time/id generation itself, so it stays deterministic and
 * directly testable / replayable. `generateDecisionId` is the one impure helper
 * and is called by the route, not the engine.
 *
 * Phase 1: return-only. Nothing here stores or logs the record or its inputs.
 */

import crypto from "crypto";
import type {
  DecisionRecord,
  EvaluateRequest,
  EvaluateResponse,
  ProposedAction,
} from "./types";

export function generateDecisionId(): string {
  return `dec_${crypto.randomUUID()}`;
}

/** The action as the engine interprets it: defaults made explicit, no I/O. */
export function normalizeProposedAction(action: ProposedAction): ProposedAction {
  return {
    type: action.type,
    parameters: action.parameters ?? {},
    reversible: action.reversible ?? false,
    context: action.context ?? {},
  };
}

export function buildDecisionRecord(input: {
  request: EvaluateRequest;
  response: EvaluateResponse;
  decisionId: string;
  evaluatedAt: string;
  latencyMs: number;
  failureMode?: string | null;
}): DecisionRecord {
  const { request, response, decisionId, evaluatedAt, latencyMs } = input;

  const matched_rules = response.policy_matches
    .filter((m) => m.status === "satisfied")
    .map((m) => m.rule);
  const violated_rules = response.policy_matches
    .filter((m) => m.status === "violated")
    .map((m) => m.rule);

  return {
    schema_version: "dr-v1",
    decision_id: decisionId,
    evaluated_at: evaluatedAt,
    latency_ms: latencyMs,
    final_verdict: response.verdict,
    action_type: request.proposed_action.type,
    normalized_proposed_action: normalizeProposedAction(request.proposed_action),
    policy_snapshot: {
      name: request.policy.name,
      rules: [...request.policy.rules],
    },
    reason: response.reason,
    policy_matches: response.policy_matches,
    matched_rules,
    violated_rules,
    missing_context: response.missing_context,
    risk_factors: response.risk_factors,
    decision_basis: response.decision_basis,
    confidence: response.confidence,
    next_step: response.next_step,
    recommended_next_step: response.next_step.recommendation,
    failure_mode:
      input.failureMode ?? (response.fell_back ? "provider_unavailable" : null),
  };
}
