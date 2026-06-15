# @zorelan/sdk

The official JavaScript/TypeScript SDK for [Zorelan](https://zorelan.com) — the runtime execution decision layer for AI-driven actions.

Zorelan evaluates a proposed action against your policy and returns **ALLOW**, **REVIEW**, or **BLOCK** before it reaches your backend. Use `evaluateAction()` to gate real actions. `verify(prompt)` remains available as the legacy prompt-verification path.

## Installation

```bash
npm install @zorelan/sdk
```

## Quickstart

```typescript
import { Zorelan } from "@zorelan/sdk";

const zorelan = new Zorelan(process.env.ZORELAN_API_KEY!);

const result = await zorelan.verify(
  "Should I use HTTPS for my web application?"
);

console.log(result.verified_answer);       // synthesized answer
console.log(result.trust_score.score);     // 0–100
console.log(result.trust_score.label);     // "high" | "moderate" | "low"
console.log(result.risk_level);            // "low" | "moderate" | "high"
console.log(result.consensus.level);       // "high" | "medium" | "low"
console.log(result.recommended_action);    // plain English guidance
console.log(result.cached);               // true if served from cache
```

## Gate behaviour based on trust

```typescript
const result = await zorelan.verify(userInput);

if (result.trust_score.score >= 75 && result.risk_level !== "high") {
  showAnswer(result.verified_answer);
} else {
  showWarning("Low confidence. Review before acting.");
}
```

## Evaluate a structured action (execution gate)

Use `evaluateAction()` to decide whether an AI-proposed action should run
**before** it hits your backend. It returns a decision-first result —
`ALLOW`, `REVIEW`, or `BLOCK` — with the policy matches, risk factors, missing
context, and next step behind the decision.

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
  // route to human review — decision.reason explains why
} else {
  // "BLOCK" — stop execution
}
```

`evaluateAction()` returns an `EvaluateActionResponse` on success, or throws a
`ZorelanError` on failure (same error style as `verify`). `verify(prompt)` is
unchanged and continues to work as before.

## API

### `new Zorelan(apiKey, options?)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `apiKey` | `string` | Your Zorelan API key (required) |
| `options.baseUrl` | `string` | Override the base URL (default: `https://zorelan.com`) |
| `options.fetch` | `function` | Custom fetch implementation for non-browser environments |

### `zorelan.verify(prompt, options?)`

Submit a prompt for multi-model verification.

| Parameter | Type | Description |
|-----------|------|-------------|
| `prompt` | `string` | The question or prompt to verify (required) |
| `options.cacheBypass` | `boolean` | Force a fresh live verification, bypassing cache |

Returns a `ZorelanDecisionSuccess` object on success, or throws a `ZorelanError` on failure.

### `zorelan.evaluateAction(payload)`

Evaluate a structured proposed action against a policy before execution.

| Parameter | Type | Description |
|-----------|------|-------------|
| `payload.proposed_action` | `ProposedAction` | The action to gate — `type`, `parameters`, `reversible`, `context` (required) |
| `payload.policy` | `ActionPolicy` | `name` plus one or more `rules` (required) |
| `payload.user_request` | `string` | The originating user request (optional) |
| `payload.model_output` | `string` | The AI model's output/draft (optional) |
| `payload.options` | `EvaluateActionOptions` | `risk_tolerance`, `require_live_data`, `max_latency_ms` (optional) |

Returns an `EvaluateActionResponse` with `verdict` (`"ALLOW"` · `"REVIEW"` · `"BLOCK"`), `reason`, `policy_matches`, `risk_factors`, `missing_context`, `evidence`, `next_step`, `decision_basis`, and `confidence`. Throws a `ZorelanError` on failure.

### Key response fields

| Field | Type | Description |
|-------|------|-------------|
| `verified_answer` | `string` | Synthesized final answer from aligned providers |
| `trust_score.score` | `number` | Calibrated reliability score from 0–100 |
| `trust_score.label` | `string` | `"high"` · `"moderate"` · `"low"` |
| `trust_score.reason` | `string` | Plain English explanation of the score |
| `risk_level` | `string` | `"low"` · `"moderate"` · `"high"` |
| `consensus.level` | `string` | How strongly the models agreed |
| `key_disagreement` | `string` | Main tension between model responses |
| `recommended_action` | `string` | Practical guidance on how to use this answer |
| `cached` | `boolean` | Whether the result was served from cache |

### Error handling

```typescript
import { Zorelan, ZorelanError } from "@zorelan/sdk";

try {
  const result = await zorelan.verify("Is this a good investment?");
  console.log(result.verified_answer);
} catch (err) {
  if (err instanceof ZorelanError) {
    console.error(err.status);  // HTTP status code
    console.error(err.message); // Error description
  }
}
```

## Trust score guide

> This section applies to the legacy `verify(prompt)` API. For new
> action-gating integrations, use `evaluateAction()`.

| Score | Meaning | Recommended action |
|-------|---------|-------------------|
| 90+ | High-confidence factual verification | Safe to use directly |
| ~85 | Strong aligned reasoning, context-dependent | Useful, treat as judgment not ground truth |
| Below 85 | Disagreement, ambiguity, or elevated risk | Review before acting |

## Requirements

- Node.js 18+ (or any environment with `fetch` available)
- A Zorelan API key — get one at [zorelan.com/api-docs](https://zorelan.com/api-docs)

## Links

- [API Documentation](https://zorelan.com/api-docs)
- [Zorelan](https://zorelan.com)