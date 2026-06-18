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

2026-06-15 — Security/cost-abuse fix pass (this entry). Closed unauthenticated
paid-call endpoints and a fail-open cron guard:
- **`/api/sdk-test` removed** — leftover smoke test that ran a live `verify()`
  (paid AI calls) on every unauthenticated GET via the master key. Deleted.
- **`/api/run` protected** — now requires `Authorization: Bearer DECISION_API_KEY`;
  missing/wrong header → 401, missing key server-side → 500 (generic, never
  reveals whether the key is configured). Behaviour unchanged after auth.
  `benchmark/run.mjs` updated to send the header (reads `DECISION_API_KEY`/`API_KEY`
  from env).
- **`/api/cron/reset-usage` fails closed** — if `CRON_SECRET` is unset it now
  returns 500 and does NOT reset usage (was fail-open). Wrong/missing Bearer → 401.
No product, positioning, Stripe, admin-UI, or dependency changes in this pass.

2026-06-15 — Final docs polish. API-docs Quickstart now leads with
`/v1/evaluate` + `evaluateAction()`; legacy `verify(prompt)` curl/SDK/Python
examples moved under an explicit "Legacy: prompt verification" block; the trust
scoring / disagreement / arbitration sections carry a legacy banner clarifying
they describe `/v1/decision`, not the `/v1/evaluate` gate; unused `nodeExample`
removed; `sdk/README.md` "Trust score guide" notes it is legacy-only. Docs/copy
only — no runtime, API, SDK, Stripe, env, admin, or auth changes. Prior:
homepage consolidation + legacy route cleanup, trust/ops, docs/positioning.

## Homepage + legacy route cleanup (this pass)

- **Homepage consolidated**: `app/page.tsx` is now a static product page for the
  execution-gate story (hero → pipeline → refund BLOCK example → `evaluateAction`
  snippet → deterministic "how it decides" → support). The old prompt-verification
  widget (Quick Verify / trust-score cards / history) was removed.
- **Removed dead routes**: `app/api/demo/generate`, `app/api/demo/verify`
  (old SEND/regex demo), `app/api/preframe` (pre-Zorelan leftover), and the
  homepage-only prompt helpers `app/api/intent`, `app/api/verify` (unauthenticated
  proxy to `/api/decision`), and `app/api/synthesize`. All were confirmed
  unreferenced (no fetch callers, no imports) before deletion.
- **Legacy `/v1/decision` remains supported** (+ SDK `verify(prompt)`); core
  `app/api/decision/route.ts` untouched.
- **`/v1/evaluate` remains the flagship** structured execution gate.
- **`app/api/run` retained** — still used by `benchmark/run.mjs`.

## Trust / ops (current capability)

- **Owner payment notification**: on `checkout.session.completed` (new key),
  `app/api/webhook/stripe/route.ts` emails `OWNER_NOTIFICATION_EMAIL` (if set)
  with customer email, plan, Stripe customer/subscription IDs, API-key prefix
  (never full key), timestamp, and live/test. Best-effort — never blocks/fails
  checkout.
- **Admin customer visibility**: `GET /api/admin/customers` (master-key /
  `DECISION_API_KEY`) lists sanitized `apikey:*` records (email, plan, status,
  calls used/limit, created, Stripe IDs, key **prefix only**). Surfaced in
  `/admin`. Capped at 1000 keys (reports `truncated`).
- **Support/contact path**: `SUPPORT_EMAIL` (fallback `support@zorelan.com`)
  shown on landing CTA, API docs (access + key-rotation note), privacy page,
  and checkout success banner; README has a Support section.
- **Checkout key reveal hardening**: `checkout_session:<id>:apikey` TTL cut from
  24h → 10min (`app/api/webhook/stripe/route.ts`). Reveal is still re-fetchable
  within that window (not strictly one-time) — see risks.
- **Legacy routes marked**: `app/api/demo/generate`, `app/api/demo/verify`
  (old SEND/regex demo), `app/api/preframe`, and `app/api/run` (benchmark-only)
  carry DEPRECATED/LEGACY header comments; none are referenced by app UI.
- **Error handling**: `/api/admin/customers` builds Redis lazily and returns
  JSON (`redis_unavailable` 503 / `unauthorized` 401) instead of throwing at
  import; `/admin` shows the returned error text.

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

- **Execution gate (flagship)**: `app/v1/evaluate/route.ts` (public),
  `app/api/demo/evaluate/route.ts` (demo), shared logic in `lib/evaluate/*`.
- **Decision endpoints (legacy/supported)**: `app/v1/decision/route.ts`
  (public v1) → `app/api/decision/route.ts` (core). `app/api/run/route.ts`
  remains for `benchmark/run.mjs` only.
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
