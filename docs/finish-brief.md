# Finish brief — Zorelan

The upstream statement of *finish intent* — the standard this project must reach
for its intended use. The **Finish Profile Reviewer** reads this file: if it is
filled in, the reviewer compares the project against it; if left blank, the
reviewer infers intent from context and states its confidence.

Fill in what you know. Leave a field blank rather than inventing an answer.
Field list mirrors `D:\dev\prompt-library\finish-profiles\README.md`.

## Finish Brief

- **Project type** — what kind of thing this is:
  Existing product — a developer-facing API/SDK (execution decision layer) with
  public landing, docs, and a demo. Currently at the small-validation-push stage.
- **Intended user** — who actually uses it:
  Developers building AI agents / automation that take real backend actions and
  want a policy/trust gate before execution.
- **Primary finish profile** — the main profile that should apply:
  trust-critical-workflow (it gates real, sometimes irreversible, actions).
- **Secondary finish profile** — the next most relevant profile, if any:
  founder-demo-mvp (being shown to ~10–30 targeted builders for validation; also
  public-marketing-site qualities for the landing/API docs).
- **Public / client-facing / internal / mobile / trust-critical** — which of
  these the project is (one or more):
  Public + developer-facing + trust-critical. Not internal-only, not mobile.
- **Tone** — how the copy and UI should read:
  Clear, technical, credible, understated. Developer-readable. No hype.
- **What this must feel like** — the intended impression when finished:
  A serious, trustworthy trust/control layer for AI/automation — precise about
  what it decides and why, honest about its current limits.
- **What this must not become** — the scope ceiling; what to never drift into:
  A generic chatbot, a vague "AI safety" wrapper, a trust-score/model-agreement
  tool, a policy blog, or a broad AI platform. Do not overclaim security,
  compliance, or enterprise readiness.
- **Known trust/safety concerns** — sensitive data, approvals, automation risks:
  Gates real backend actions (refunds, deletions, billing, CRM writes); handles
  API keys, Stripe billing, and Redis-stored usage. Decisions are deterministic
  Stage 0 only (no model judgement yet) — demo and docs must stay honest about
  real vs placeholder. Checkout API-key reveal is re-fetchable for a short window.
- **No-scope-creep notes** — features explicitly out of bounds for this build:
  No accounts/login system beyond API keys; no enterprise admin/RBAC; no
  compliance/security certifications; no Stage 1 model judgement until validation
  signal justifies it; no broad AI-platform features.
- **Facts that must not be invented** — claims, numbers, names that must stay
  truthful:
  - The engine is **deterministic Stage 0** today; model judgement is NOT built.
  - Supported action types: `refund_customer`, `delete_account`,
    `downgrade_subscription`/`change_subscription`, `update_crm_record`;
    unknown types → REVIEW.
  - Example truths: refund $180 with `delivery_unconfirmed` → **BLOCK**;
    self-serve plan downgrade → **ALLOW**.
  - `/v1/evaluate` (+ SDK `evaluateAction`) is the flagship; `/v1/decision`
    (+ SDK `verify`) is legacy/convenience.
  - Auth and pricing were not changed in recent work.
  - Do not claim security/compliance/enterprise guarantees that are not built.
- **Confidence** — how sure the intent is (High / Medium / Low):
  High on positioning and scope; Medium on finer finish details.

## Notes

- `no-scope-creep-pass.md` is always applied by the reviewer, regardless of the
  profiles chosen above.
- The reviewer's core rule: this changes the quality bar, not the product scope.
