/**
 * scripts/tests/test-route-parity.ts
 *
 * Behavioural parity between the two evaluate surfaces:
 *   - app/api/demo/evaluate/route.ts   (unauthenticated demo)
 *   - app/v1/evaluate/route.ts         (authenticated, production)
 *
 * Both route POST handlers are invoked directly (no network). The authenticated
 * route is exercised via its REAL master-key path: we set DECISION_API_KEY in the
 * test process and pass the matching Bearer token. This does NOT weaken production
 * auth — a wrong/absent key is still rejected, and per-customer keys still require
 * Redis. We compare the shared, meaningful evaluation result and exclude
 * endpoint-specific fields (usage, decision_id, decision_record).
 *
 * Run:  npx tsx scripts/tests/test-route-parity.ts
 */

const MASTER_KEY = "test-master-key-parity";
process.env.DECISION_API_KEY = MASTER_KEY;
// Ensure rate limiting is off for the test process (avoids any Redis dependency).
delete process.env.ENABLE_API_RATE_LIMIT;

import { POST as demoPost } from "../../app/api/demo/evaluate/route";
import { POST as v1Post } from "../../app/v1/evaluate/route";

let failures = 0;
function check(name: string, cond: boolean, extra?: string) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}${cond ? "" : extra ? ` :: ${extra}` : ""}`);
  if (!cond) failures++;
}

const STD_CONTROLS = {
  currency: "AUD",
  auto_allow_limit: 100,
  absolute_review_limit: 1000,
  require_delivery_confirmation_above_auto_allow_limit: true,
};

function refundPayload(opts: {
  amount: number;
  context?: Record<string, unknown>;
  withControls?: boolean;
}) {
  const policy: Record<string, unknown> = {
    name: "Refund policy",
    rules: ["Refunds above the auto-allow limit require delivery confirmation."],
  };
  if (opts.withControls !== false) {
    policy.controls = { refund: STD_CONTROLS };
  }
  return {
    proposed_action: {
      type: "refund_customer",
      parameters: { amount: opts.amount, currency: "AUD", customer_id: "cus_1" },
      reversible: false,
      context: opts.context ?? {},
    },
    policy,
  };
}

async function callDemo(payload: unknown) {
  const res = await demoPost(
    new Request("http://local/api/demo/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function callV1(payload: unknown, token = MASTER_KEY) {
  const res = await v1Post(
    new Request("http://local/v1/evaluate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    })
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** The shared, meaningful projection (endpoint-specific fields excluded). */
function core(body: Record<string, unknown>) {
  return JSON.stringify({
    verdict: body.verdict,
    reason: body.reason,
    decision_basis: body.decision_basis,
    missing_context: body.missing_context,
    policy_controls_applied: body.policy_controls_applied ?? null,
  });
}

async function main() {
  const cases: Array<{ name: string; payload: unknown; expect: string }> = [
    { name: "ALLOW (amount under auto_allow)", payload: refundPayload({ amount: 40 }), expect: "ALLOW" },
    { name: "BLOCK (above auto_allow, unconfirmed)", payload: refundPayload({ amount: 250, context: { delivery_confirmed: false } }), expect: "BLOCK" },
    { name: "REVIEW (at absolute_review_limit, confirmed)", payload: refundPayload({ amount: 1000, context: { delivery_confirmed: true } }), expect: "REVIEW" },
    { name: "REVIEW (no typed controls → fail safe)", payload: refundPayload({ amount: 80, withControls: false }), expect: "REVIEW" },
  ];

  for (const c of cases) {
    const d = await callDemo(c.payload);
    const v = await callV1(c.payload);

    check(`demo 200 + verdict ${c.expect} [${c.name}]`, d.status === 200 && d.body.verdict === c.expect, `got ${d.status}/${d.body.verdict}`);
    check(`v1 200 + verdict ${c.expect} [${c.name}]`, v.status === 200 && v.body.verdict === c.expect, `got ${v.status}/${v.body.verdict}`);
    check(`PARITY demo core == v1 core [${c.name}]`, core(d.body) === core(v.body), `${core(d.body)} != ${core(v.body)}`);

    // Endpoint-specific: v1 carries a Decision Record; demo does not.
    check(`v1 has decision_record, demo does not [${c.name}]`, !!v.body.decision_record && d.body.decision_record === undefined);

    // Decision Record controls match the applied controls (v1).
    const dr = v.body.decision_record as Record<string, unknown> | undefined;
    check(
      `v1 DR policy_controls_applied == response policy_controls_applied [${c.name}]`,
      JSON.stringify(dr?.policy_controls_applied ?? null) === JSON.stringify(v.body.policy_controls_applied ?? null)
    );
  }

  // Auth is NOT weakened: a wrong bearer token is rejected (401), unauthenticated (401).
  const badToken = await callV1(refundPayload({ amount: 40 }), "wrong-key");
  check("v1 rejects wrong bearer token (401)", badToken.status === 401, `got ${badToken.status}`);
}

main()
  .then(() => {
    console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error("ERROR", e?.message || e);
    process.exit(1);
  });
