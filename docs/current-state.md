# Current state — Zorelan

Fast-moving snapshot of the project. Update at the end of every working
session, or whenever something material changes.

**Do not paste secrets, tokens, or API keys into this file.**

## What Zorelan is

A **runtime execution decision layer for AI-driven actions**. It sits
between an AI model and real backend actions and evaluates whether an
AI-generated action should be **ALLOW**, **REVIEW**, or **BLOCK** before
execution.

## Last updated

2026-06-15 — Docs/positioning cleanup pass. Public copy, metadata, READMEs,
and API docs now lead with the structured execution-gate story (ALLOW /
REVIEW / BLOCK). No engine, SDK behaviour, Stripe, or pricing changes.

## Structured execution gate (current capability)

- **Canonical demo**: `app/demo/page.tsx` is a structured execution-gate demo
  (proposed action + visible policy → ALLOW / REVIEW / BLOCK), backed by the
  unauthenticated internal route `app/api/demo/evaluate/route.ts`.
- **Public endpoint**: `POST /v1/evaluate` (`app/v1/evaluate/route.ts`) —
  authenticated (Bearer API key, same key model as `/api/decision`), validates a
  structured `proposed_action` + `policy` payload and returns the decision-first
  shape (`verdict`, `reason`, `policy_matches`, `risk_factors`,
  `missing_context`, `evidence`, `next_step`, `decision_basis`, `confidence`,
  `usage`).
- **Shared engine**: `lib/evaluate/*` (`types.ts`, `schema.ts`,
  `evaluateAction.ts`, `apiKeyAuth.ts`). Deterministic Stage 0 only —
  `refund_customer`, `delete_account`, `downgrade_subscription` /
  `change_subscription`, `update_crm_record`; unknown types fail safe to REVIEW.
  Model judgement (Stage 1) is documented backlog, not built.
- **SDK**: `@zorelan/sdk` exposes `evaluateAction(payload)` (→ `/v1/evaluate`)
  alongside the unchanged legacy `verify(prompt)` (→ `/v1/decision`).
- **Legacy/convenience**: `/v1/decision` + `verify(prompt)` (prompt
  verification / trust score) remain fully working as the secondary path.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript (strict), Tailwind v4
- Deployed on Vercel
- AI providers: Anthropic, OpenAI, Google Gemini, Perplexity
  (`lib/providers/*`)
- Upstash Redis (`KV_REST_API_*`) for rate limiting, usage, provider scores
- Stripe (checkout + webhook), Resend (email)
- Public SDK `@zorelan/sdk` (source in `sdk/`)

## Map (where things live)

- **Decision endpoints**: `app/v1/decision/route.ts` (public v1),
  `app/api/decision/route.ts` (core). Also `app/api/verify/route.ts`,
  `app/api/run/route.ts`, `app/api/synthesize/route.ts`,
  `app/api/intent/route.ts`.
- **Engines** (`lib/`):
  - `lib/routing/*` — adaptive provider selection, classification,
    provider memory/scores/profiles, diagnostics.
  - `lib/synthesis/*` — `compareAnswers`, `semanticAgreement`.
  - `lib/verification/*` — `truthClassifier`, `truthClassifierV2`.
  - `lib/promptEngine.ts`, `lib/prompts/*`, `lib/zorelanClient.ts`.
- **Billing**: `app/api/checkout/*`, `app/api/webhook/stripe/route.ts`.
- **Public surfaces**: `app/page.tsx` (landing), `app/demo/page.tsx`,
  `app/api-docs/page.tsx`, `app/privacy/page.tsx`, `app/admin/page.tsx`.
- **Analytics / ops**: `app/api/analytics`, `app/api/provider-analytics`,
  `app/api/feedback`, `app/api/cron/reset-usage`.
- **SDK**: `sdk/` (published package + dist).
- **Benchmark / scripts**: `benchmark/`, `scripts/`.

## Notes / known context

- `preframe-backup-before-zorelan/` is a pre-rebrand backup. Treat as
  archive; do not build against it.
- Env vars are documented in `.env.example` (placeholders only).
- Runtime behaviour ("what works" end-to-end) has not been independently
  verified in this pass — only structure was inspected. Verify before
  relying on any golden path.

## Open questions / gaps

- (none recorded yet — fill in as audits run)
