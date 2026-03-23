# Zorelan

**Verify AI before you trust it.**

Zorelan compares multiple AI model outputs, detects disagreement, and returns a trust-calibrated answer with a trust score, risk level, consensus signal, and recommended action — in a single API call.

## What it does

A single model can generate an answer, but it cannot tell you whether that answer deserves confidence. Zorelan sits between your application and AI providers. It queries multiple models simultaneously, compares their outputs through a semantic agreement engine, and returns a structured verification signal your application can act on.

```
Your prompt
    ↓
Adaptive provider selection
    ↓
Parallel model queries (Claude · Perplexity · GPT)
    ↓
Semantic agreement judge (neutral cross-model)
    ↓
Arbitration if disagreement detected
    ↓
Trust score + verified answer
```

## API

```bash
curl -X POST https://zorelan.com/v1/decision \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Should I use HTTPS for my web application?"}'
```

```json
{
  "ok": true,
  "verified_answer": "Yes — you should use HTTPS for your web application.",
  "trust_score": {
    "score": 94,
    "label": "high",
    "reason": "The providers strongly agree on a low-risk best-practice conclusion."
  },
  "risk_level": "low",
  "consensus": {
    "level": "high",
    "models_aligned": 2
  },
  "recommended_action": "Use the shared conclusion as the answer."
}
```

## SDK

```bash
npm install @zorelan/sdk
```

```typescript
import { Zorelan } from "@zorelan/sdk";

const zorelan = new Zorelan(process.env.ZORELAN_API_KEY!);

const result = await zorelan.verify(
  "Should I use HTTPS for my web application?"
);

// Gate behaviour based on trust
if (result.trust_score.score >= 75 && result.risk_level !== "high") {
  showAnswer(result.verified_answer);
} else {
  showWarning("Low confidence. Review before acting.");
}
```

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
