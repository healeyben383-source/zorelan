# Decisions — Zorelan

A running log of load-bearing decisions and the reasoning behind them. Append new
entries at the top. Keep the *why*, not just the *what*, so a future session does
not re-litigate a settled choice.

Do not paste secrets, tokens, or API keys into this file.

## How to use

One entry per decision. Keep each to a few lines. Mark a decision as Superseded
rather than deleting it, so the history stays honest.

## Log

Newest first.

### 2026-06-15 — Fail closed on unauthenticated/cost-incurring routes

- Decision: Removed `/api/sdk-test`; required `Bearer DECISION_API_KEY` on
  `/api/run`; made `/api/cron/reset-usage` return 500 (not reset) when
  `CRON_SECRET` is unset. Generic error responses (no key-existence leak).
- Why: All three were reachable without auth and could burn paid AI spend or wipe
  usage accounting. Cheap, surgical fix before any public exposure.
- Alternatives considered: leaving them (rejected — open cost/abuse vector);
  rate-limiting only (insufficient).
- Status: Active.

### 2026-06-15 — Lead everything with the structured execution gate

- Decision: `/v1/evaluate` + SDK `evaluateAction(payload)` is the flagship.
  Homepage, demo, and API docs lead with proposed_action + policy → ALLOW/REVIEW/
  BLOCK. The old prompt-verification homepage widget was removed.
- Why: The execution-gate framing is the credible, differentiated product;
  trust-score/model-agreement framing was vague and confused the story.
- Alternatives considered: keeping the hybrid homepage (rejected — diluted the
  positioning).
- Status: Active.

### 2026-06-15 — Keep legacy prompt verification, demote not delete

- Decision: `/v1/decision` + SDK `verify(prompt)` stay supported as a
  secondary/convenience path, clearly labelled "legacy" in docs.
- Why: Avoid breaking any existing caller while making the flagship unambiguous.
- Alternatives considered: deleting it (rejected — breaking change, no upside now).
- Status: Active.

### 2026-06-15 — Deterministic Stage 0 first; defer model judgement

- Decision: Ship deterministic policy checks only (a small set of action types;
  unknown → REVIEW). Model-based judgement (Stage 1) is documented backlog, not
  built. Docs/demo must stay honest about this.
- Why: Deterministic decisions are predictable, testable, credible, and cheap to
  run; building model judgement before validation would add risk and cost.
- Alternatives considered: model-driven decisions now (rejected — premature,
  harder to trust/verify).
- Status: Active.
