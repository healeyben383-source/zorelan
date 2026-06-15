import { Zorelan } from "./dist/index.js";

const zorelan = new Zorelan(process.env.ZORELAN_API_KEY);

const result = await zorelan.verify("Is Earth a planet?");

console.log("ANSWER:", result.verified_answer);
console.log("TRUST:", result.trust_score.score);
console.log("CONSENSUS:", result.consensus.level);

// Structured execution-gate smoke (POST /v1/evaluate)
const decision = await zorelan.evaluateAction({
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
});

console.log("VERDICT:", decision.verdict);
console.log("REASON:", decision.reason);
console.log("NEXT STEP:", decision.next_step.action);