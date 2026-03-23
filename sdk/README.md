# @zorelan/sdk

The official JavaScript/TypeScript SDK for [Zorelan](https://zorelan.com) — verify AI before it reaches your users.

Zorelan compares multiple model outputs and returns a trust-calibrated answer with a trust score, risk level, consensus signal, and recommended action.

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