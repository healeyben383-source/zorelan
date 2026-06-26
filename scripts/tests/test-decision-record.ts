/**
 * scripts/tests/test-decision-record.ts
 *
 * Offline test for Decision Record V1 (schema `dr-v1`). Pure — runs the
 * deterministic engine + buildDecisionRecord with no network/secrets.
 *
 * Run:  npx tsx scripts/tests/test-decision-record.ts
 */

import { evaluateActionDeterministic } from "../../lib/evaluate/evaluateAction";
import { buildDecisionRecord } from "../../lib/evaluate/decisionRecord";
import type { EvaluateRequest } from "../../lib/evaluate/types";

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}`);
  if (!cond) failures++;
}

// Fixture: refund $180 with delivery_unconfirmed → BLOCK
const refundReq: EvaluateRequest = {
  user_request: "I never received my order and I want a full refund.",
  model_output: "I've issued your refund of $180.",
  proposed_action: {
    type: "refund_customer",
    parameters: { amount: 180, currency: "AUD", customer_id: "cus_123" },
    reversible: false,
    context: { order_status: "delivery_unconfirmed", identity_verified: true },
  },
  policy: {
    name: "Refund policy",
    rules: [
      "Refunds above $100 require delivery confirmation.",
      "Refunds must not be issued when delivery status is unresolved.",
    ],
  },
};

const result = evaluateActionDeterministic(refundReq);
const record = buildDecisionRecord({
  request: refundReq,
  response: result,
  decisionId: "dec_test_0001",
  evaluatedAt: "2026-06-15T00:00:00.000Z",
  latencyMs: 3,
});

// Backward-compat: flat engine result is unchanged and still BLOCK.
check("flat verdict still BLOCK", result.verdict === "BLOCK");
check("flat result has no decision_record (engine pure)", result.decision_record === undefined);

// Record shape + provenance
check("schema_version dr-v1", record.schema_version === "dr-v1");
check("decision_id passthrough", record.decision_id === "dec_test_0001");
check("evaluated_at passthrough", record.evaluated_at === "2026-06-15T00:00:00.000Z");
check("latency_ms numeric", typeof record.latency_ms === "number");
check("final_verdict mirrors verdict", record.final_verdict === result.verdict);
check("action_type from proposed_action", record.action_type === "refund_customer");
check("failure_mode null on clean decision", record.failure_mode === null);

// Normalization makes defaults explicit
check(
  "normalized action keeps type",
  record.normalized_proposed_action.type === "refund_customer"
);
check(
  "normalized reversible explicit",
  record.normalized_proposed_action.reversible === false
);

// Policy snapshot + rule projections
check("policy_snapshot name", record.policy_snapshot.name === "Refund policy");
check("policy_snapshot rules count", record.policy_snapshot.rules.length === 2);
check("violated_rules non-empty for BLOCK", record.violated_rules.length > 0);
check(
  "matched_rules + violated_rules subset of policy_matches",
  record.matched_rules.length + record.violated_rules.length <= record.policy_matches.length
);
check("recommended_next_step is the next_step recommendation",
  record.recommended_next_step === result.next_step.recommendation);

// Self-containment for future replay: record carries inputs needed to re-run.
check("record self-contained for replay",
  !!record.normalized_proposed_action && !!record.policy_snapshot);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
