# Zorelan

**Stop AI agents from taking unsafe actions.**

Zorelan is a runtime execution decision layer for AI-driven actions. It sits between AI model output and real backend actions, evaluates a proposed action against your policy and context, and returns **ALLOW**, **REVIEW**, or **BLOCK** before anything executes.

## What it does

AI output can sound correct and still be unsafe to execute — issuing a refund, deleting an account, changing a subscription, writing to a CRM. Zorelan takes a structured proposed action plus the policy it must satisfy and returns a decision-first result your system can gate on.

```
User request
    ↓
AI model output
    ↓
Proposed action + policy/context
    ↓
Zorelan
    ↓
ALLOW / REVIEW / BLOCK  →  execute · review · block
```

> The structured evaluation path (`/v1/evaluate`) currently uses deterministic policy checks for common action types (refunds, account deletion, subscription changes, CRM updates). Unknown action types fail safe to **REVIEW**. Model judgement and arbitration can be layered in later for uncertain or high-risk actions.

## API — `POST /v1/evaluate`

Send the proposed action and the policy it must satisfy. Get back a verdict.

```bash
curl -X POST https://zorelan.com/v1/evaluate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "user_request": "I never received my order and I want a full refund.",
    "model_output": "I'\''ve issued your refund of $180.",
    "proposed_action": {
      "type": "refund_customer",
      "parameters": { "amount": 180, "currency": "AUD", "customer_id": "cus_123" },
      "reversible": false,
      "context": { "order_status": "delivery_unconfirmed", "identity_verified": true }
    },
    "policy": {
      "name": "Refund policy",
      "rules": [
        "Refunds above $100 require delivery confirmation.",
        "Refunds must not be issued when delivery status is unresolved."
      ]
    }
  }'
```

```json
{
  "ok": true,
  "verdict": "BLOCK",
  "reason": "Refund of $180 AUD exceeds the $100 threshold and delivery is unconfirmed.",
  "missing_context": [
    { "field": "delivery_confirmed", "why": "Required before a refund over $100." }
  ],
  "next_step": {
    "action": "block",
    "recommendation": "Do not issue the refund. Request delivery confirmation, then re-evaluate."
  },
  "decision_basis": "deterministic",
  "confidence": { "score": 94, "label": "high" }
}
```

Gate execution on `verdict`: `ALLOW` → execute, `REVIEW` → human review, `BLOCK` → stop.

## SDK

```bash
npm install @zorelan/sdk
```

```typescript
import { Zorelan } from "@zorelan/sdk";

const zorelan = new Zorelan(process.env.ZORELAN_API_KEY!);

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

if (decision.verdict === "ALLOW") {
  // execute the action
} else if (decision.verdict === "REVIEW") {
  // route to human review
} else {
  // "BLOCK" — stop execution
}
```

## Legacy: prompt verification (`/v1/decision`)

`POST /v1/decision` and the SDK's `verify(prompt)` are the original prompt-verification path: they compare multiple model answers to a prompt and return a trust-calibrated answer with a trust score, risk level, and consensus signal. This remains available as a secondary/convenience capability — new integrations gating real actions should prefer `/v1/evaluate`.

```typescript
const result = await zorelan.verify("Should I use HTTPS for my web application?");
console.log(result.verified_answer, result.trust_score.score);
```

The sections below (trust scoring, disagreement types, response fields, caching) document this legacy verification path.

## Trust scoring

Zorelan does not just measure whether models agree — it measures whether that agreement deserves confidence.

| Prompt | Trust score | Risk | Interpretation |
|--------|-------------|------|----------------|
| Is water made of hydrogen and oxygen? | 94–95 | Low | Objective fact, strong alignment |
| Should I use TypeScript or JavaScript? | ~85–88 | Moderate | Strong reasoning, context-dependent |
| Is cryptocurrency a good investment? | Lower / capped | Moderate–High | Aligned speculation ≠ certainty |

High agreement in an uncertain domain is not treated as ground truth. Two models can strongly agree and still receive a bounded score if the prompt is inherently uncertain.

## Disagreement types

| Type | Trust impact | Description |
|------|-------------|-------------|
| `none` | No penalty | Models reached the same conclusion |
| `additive_nuance` | No penalty | One model added detail without changing the conclusion |
| `explanation_variation` | −4 pts | Same conclusion, different framing |
| `conditional_alignment` | −12 pts | Agreement only with added context or conditions |
| `material_conflict` | −20 pts | Models gave materially opposite recommendations |

## Use cases

- **Validate AI before showing users** — verify responses before displaying them in your UI
- **Gate actions based on confidence** — only trigger workflows when trust score clears your threshold
- **Reduce hallucinations in production** — add a verification layer between your app and LLMs
- **Add explainability to AI features** — return confidence and disagreement metadata alongside answers
- **Build trust-aware product logic** — use trust score, risk level, and cached status as inputs into routing or review flows

## Response fields

| Field | Type | Description |
|-------|------|-------------|
| `verified_answer` | string | Synthesized final answer from aligned providers |
| `trust_score.score` | number | Calibrated reliability score from 0–100 |
| `trust_score.label` | string | `"high"` · `"moderate"` · `"low"` |
| `trust_score.reason` | string | Plain English explanation of the score |
| `risk_level` | string | `"low"` · `"moderate"` · `"high"` |
| `consensus.level` | string | How strongly the models agreed |
| `key_disagreement` | string | Main tension between model responses |
| `recommended_action` | string | Practical guidance on how to use this answer |
| `cached` | boolean | Whether the result was served from cache |

## Request options

| Field | Type | Description |
|-------|------|-------------|
| `prompt` | string | The execution prompt sent to providers (required) |
| `raw_prompt` | string | Original human question for trust calibration (optional) |
| `cache_bypass` | boolean | Force a fresh live verification (optional) |

When `raw_prompt` is provided, trust scoring is calibrated against the original human question rather than the optimized execution prompt. This preserves honest confidence even when you use prompt engineering to improve answer quality.

## Caching

Verified results are cached for 6 hours. A cached response is not an unverified response — it is a previously verified result being replayed. Every response includes a `cached` field so your application always knows what it received.

First request (live verification): ~12–20s
Repeat request within 6 hours: ~1–2s

## Links

- [Live product](https://zorelan.com)
- [API documentation](https://zorelan.com/api-docs)
- [npm SDK](https://www.npmjs.com/package/@zorelan/sdk)
