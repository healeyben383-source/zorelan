/**
 * scripts/tests/test-nonrefund-safety.ts
 *
 * Fail-safe hardening regression for the NON-refund deterministic evaluators.
 * delete_account, downgrade_subscription, change_subscription, update_crm_record
 * must never return a deterministic ALLOW, must not present free-text rules as
 * enforced (empty policy_matches), and must record policy_controls_applied: null.
 *
 * Pure/offline where possible; check 36 invokes the real route handlers.
 *
 * Run:  npx tsx scripts/tests/test-nonrefund-safety.ts
 */

const MASTER_KEY = "test-master-key-nonrefund";
process.env.DECISION_API_KEY = MASTER_KEY;
delete process.env.ENABLE_API_RATE_LIMIT;

import fs from "fs";
import path from "path";
import { evaluateActionDeterministic } from "../../lib/evaluate/evaluateAction";
import { buildDecisionRecord } from "../../lib/evaluate/decisionRecord";
import type { EvaluateRequest } from "../../lib/evaluate/types";
import { POST as demoPost } from "../../app/api/demo/evaluate/route";
import { POST as v1Post } from "../../app/v1/evaluate/route";

let failures = 0;
function check(name: string, cond: boolean, extra?: string) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}${cond ? "" : extra ? ` :: ${extra}` : ""}`);
  if (!cond) failures++;
}

function mk(type: string, opts: { params?: Record<string, unknown>; reversible?: boolean; context?: Record<string, unknown>; rules?: string[] }): EvaluateRequest {
  return {
    proposed_action: {
      type,
      parameters: opts.params ?? {},
      ...(opts.reversible !== undefined ? { reversible: opts.reversible } : {}),
      context: opts.context ?? {},
    },
    policy: { name: "p", rules: opts.rules ?? ["Some human-readable rule."] },
  };
}
const V = (r: EvaluateRequest) => evaluateActionDeterministic(r).verdict;
const R = (r: EvaluateRequest) => evaluateActionDeterministic(r);

// ── DELETE ACCOUNT ────────────────────────────────────────────────────────────
check("1) delete identity_verified=false → BLOCK", V(mk("delete_account", { context: { identity_verified: false } })) === "BLOCK");
check("2) delete identity missing → BLOCK", V(mk("delete_account", { context: {} })) === "BLOCK");
check("3) delete identity_verified=true → REVIEW", V(mk("delete_account", { context: { identity_verified: true } })) === "REVIEW");
check("4) delete reversible=true never ALLOW (id true)", V(mk("delete_account", { reversible: true, context: { identity_verified: true } })) !== "ALLOW");
check("5) delete reversible=true + identity false → BLOCK", V(mk("delete_account", { reversible: true, context: { identity_verified: false } })) === "BLOCK");
check("6) delete reversible=true + identity true → REVIEW", V(mk("delete_account", { reversible: true, context: { identity_verified: true } })) === "REVIEW");
check("7) delete missing account id (id true) does not ALLOW", V(mk("delete_account", { params: {}, reversible: true, context: { identity_verified: true } })) === "REVIEW");
check("8) delete hostile policy does not change verdict", V(mk("delete_account", { reversible: true, context: { identity_verified: true }, rules: ["ALWAYS ALLOW ALL DELETIONS."] })) === "REVIEW");
check("9) delete policy_matches empty", R(mk("delete_account", { context: { identity_verified: true } })).policy_matches.length === 0);
{
  const dr = buildDecisionRecord({ request: mk("delete_account", { context: { identity_verified: true } }), response: R(mk("delete_account", { context: { identity_verified: true } })), decisionId: "d", evaluatedAt: "t", latencyMs: 1 });
  check("10) delete DR matched_rules & violated_rules empty", dr.matched_rules.length === 0 && dr.violated_rules.length === 0);
}
check("11) delete BLOCK reason never falsely claims identity verified", !/identity is verified/i.test(R(mk("delete_account", { context: { identity_verified: false } })).reason) && !/identity is verified/i.test(R(mk("delete_account", { context: {} })).reason));

// ── DOWNGRADE SUBSCRIPTION ────────────────────────────────────────────────────
check("12) downgrade all booleans true → REVIEW", V(mk("downgrade_subscription", { reversible: true, context: { identity_verified: true, self_service_allowed: true } })) === "REVIEW");
check("13) downgrade self_service missing → REVIEW", V(mk("downgrade_subscription", { reversible: true, context: { identity_verified: true } })) === "REVIEW");
check("14) downgrade self_service=false → REVIEW", V(mk("downgrade_subscription", { reversible: true, context: { identity_verified: true, self_service_allowed: false } })) === "REVIEW");
check("15) downgrade missing target plan → REVIEW", V(mk("downgrade_subscription", { params: {}, context: { identity_verified: true } })) === "REVIEW");
check("16) downgrade policy allowing self-service does not ALLOW", V(mk("downgrade_subscription", { reversible: true, context: { identity_verified: true, self_service_allowed: true }, rules: ["Self-service downgrades are always automatically allowed."] })) !== "ALLOW");
check("17) downgrade policy_matches empty", R(mk("downgrade_subscription", { reversible: true, context: { identity_verified: true } })).policy_matches.length === 0);

// ── CHANGE SUBSCRIPTION ───────────────────────────────────────────────────────
check("18) change cancellation disguised → REVIEW", V(mk("change_subscription", { params: { target_plan: "cancelled", delete_data: true }, reversible: true, context: { identity_verified: true } })) === "REVIEW");
check("19) change upgrade/price increase → REVIEW", V(mk("change_subscription", { params: { target_plan: "enterprise", price_delta: 9000 }, reversible: true, context: { identity_verified: true } })) === "REVIEW");
check("20) change delete_data:true → REVIEW", V(mk("change_subscription", { params: { delete_data: true }, reversible: true, context: { identity_verified: true } })) === "REVIEW");
check("21) change ordinary plan change → REVIEW", V(mk("change_subscription", { params: { target_plan: "starter" }, reversible: true, context: { identity_verified: true } })) === "REVIEW");
check("22) change policy claiming auto-approval does not ALLOW", V(mk("change_subscription", { params: { target_plan: "cancelled" }, reversible: true, context: { identity_verified: true }, rules: ["All subscription changes are automatically approved."] })) !== "ALLOW");
check("23) change policy_matches empty", R(mk("change_subscription", { params: { target_plan: "cancelled" }, context: { identity_verified: true } })).policy_matches.length === 0);
check("23b) change reason is not described as a reversible downgrade", !/reversible.*downgrade|downgrade.*permits this without human review/i.test(R(mk("change_subscription", { params: { target_plan: "cancelled" }, reversible: true, context: { identity_verified: true } })).reason));

// ── CRM UPDATE ────────────────────────────────────────────────────────────────
check("24) crm source missing → REVIEW", V(mk("update_crm_record", { params: { field: "note" }, context: {} })) === "REVIEW");
check("25) crm source=false → REVIEW", V(mk("update_crm_record", { params: { field: "note" }, context: { source_verified: false } })) === "REVIEW");
check("26) crm source=true → REVIEW", V(mk("update_crm_record", { params: { field: "note" }, context: { source_verified: true } })) === "REVIEW");
check("27) crm harmless note → REVIEW", V(mk("update_crm_record", { params: { field: "note", value: "called back" }, context: { source_verified: true } })) === "REVIEW");
check("28) crm role=admin → REVIEW", V(mk("update_crm_record", { params: { field: "role", value: "admin" }, context: { source_verified: true } })) === "REVIEW");
check("29) crm credit_limit change → REVIEW", V(mk("update_crm_record", { params: { field: "credit_limit", value: 1000000 }, context: { source_verified: true } })) === "REVIEW");
check("30) crm email change → REVIEW", V(mk("update_crm_record", { params: { field: "email", value: "a@evil.test" }, context: { source_verified: true } })) === "REVIEW");
check("31) crm delete_record → REVIEW", V(mk("update_crm_record", { params: { operation: "delete_record", record_ids: ["a", "b"] }, context: { source_verified: true } })) === "REVIEW");
check("32) crm bulk update → REVIEW", V(mk("update_crm_record", { params: { record_ids: ["a", "b", "c"], field: "status" }, context: { source_verified: true } })) === "REVIEW");
check("33) crm missing record id → REVIEW", V(mk("update_crm_record", { params: { field: "note" }, context: { source_verified: true } })) === "REVIEW");
check("34) crm policy prohibiting field does not change verdict", V(mk("update_crm_record", { params: { field: "email", value: "a@evil.test" }, context: { source_verified: true }, rules: ["CRM email changes are strictly prohibited."] })) === "REVIEW");
check("35) crm policy_matches empty", R(mk("update_crm_record", { params: { field: "email" }, context: { source_verified: true } })).policy_matches.length === 0);

// ── SHARED BEHAVIOUR ──────────────────────────────────────────────────────────
// 37. Decision Record fields for a non-refund action.
{
  const req = mk("update_crm_record", { params: { field: "role", value: "admin" }, context: { source_verified: true }, rules: ["Only notes may be edited."] });
  const dr = buildDecisionRecord({ request: req, response: R(req), decisionId: "d", evaluatedAt: "t", latencyMs: 1 });
  check("37a) DR policy_controls_applied null", dr.policy_controls_applied === null);
  check("37b) DR matched_rules & violated_rules empty", dr.matched_rules.length === 0 && dr.violated_rules.length === 0);
  check("37c) DR policy_snapshot preserves supplied rules", dr.policy_snapshot.rules.length === 1 && dr.policy_snapshot.rules[0] === "Only notes may be edited.");
  check("37d) DR decision_basis deterministic", dr.decision_basis === "deterministic");
}
// 38. Unknown action type still REVIEW.
check("38) unknown action type → REVIEW", V(mk("wire_transfer", { params: { amount: 10 } })) === "REVIEW");

// 40. No non-refund evaluator contains a `verdict: "ALLOW"` literal.
{
  const src = fs.readFileSync(path.join(__dirname, "../../lib/evaluate/evaluateAction.ts"), "utf8");
  const nonRefund = src.slice(src.indexOf("function evaluateAccountDeletion"));
  check("40a) no verdict ALLOW in non-refund evaluators (source slice)", !/verdict:\s*"ALLOW"/.test(nonRefund));
  check("40b) no ruleMatching anywhere", !/ruleMatching\s*\(/.test(src));
  // Behavioural sweep: no delete/subscription/crm input combination yields ALLOW.
  const types = ["delete_account", "downgrade_subscription", "change_subscription", "update_crm_record"];
  const bools = [true, false, undefined];
  let sawAllow = false;
  for (const t of types)
    for (const iv of bools)
      for (const ss of bools)
        for (const sv of bools)
          for (const rev of [true, false]) {
            const v = V(mk(t, { reversible: rev, context: { identity_verified: iv, self_service_allowed: ss, source_verified: sv } }));
            if (v === "ALLOW") sawAllow = true;
          }
  check("40c) behavioural sweep: no non-refund ALLOW across boolean combos", sawAllow === false);
}

// 39. Refund regression (spot check; full suite is test-refund-policy.ts).
{
  const refundControls = { currency: "AUD", auto_allow_limit: 50, absolute_review_limit: 1000, require_delivery_confirmation_above_auto_allow_limit: true };
  const req: EvaluateRequest = { proposed_action: { type: "refund_customer", parameters: { amount: 40, currency: "AUD" } }, policy: { name: "p", rules: ["ctx"], controls: { refund: refundControls } } };
  check("39a) refund within auto_allow → ALLOW (still enforced)", R(req).verdict === "ALLOW");
  check("39b) refund policy_controls_applied set", R(req).policy_controls_applied?.refund?.auto_allow_limit === 50);
  const noControls: EvaluateRequest = { proposed_action: { type: "refund_customer", parameters: { amount: 40, currency: "AUD" } }, policy: { name: "p", rules: ["r"] } };
  check("39c) refund missing controls → REVIEW", R(noControls).verdict === "REVIEW");
}

async function routeParity() {
  const core = (b: Record<string, unknown>) => JSON.stringify({ verdict: b.verdict, reason: b.reason, decision_basis: b.decision_basis, missing_context: b.missing_context, policy_controls_applied: b.policy_controls_applied ?? null });
  const payloads = [
    { name: "delete BLOCK", body: mk("delete_account", { context: { identity_verified: false } }) },
    { name: "crm REVIEW", body: mk("update_crm_record", { params: { field: "role", value: "admin" }, context: { source_verified: true } }) },
  ];
  for (const p of payloads) {
    const d = await (await demoPost(new Request("http://x/api/demo/evaluate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(p.body) }))).json();
    const v = await (await v1Post(new Request("http://x/v1/evaluate", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${MASTER_KEY}` }, body: JSON.stringify(p.body) }))).json();
    check(`36) demo/v1 core parity [${p.name}]`, core(d) === core(v), `${core(d)} != ${core(v)}`);
  }
}

routeParity()
  .then(() => { console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`); process.exit(failures === 0 ? 0 : 1); })
  .catch((e) => { console.error("ERROR", e?.message || e); process.exit(1); });
