# Project brief — Zorelan

The stable statement of *why this project exists and what it is for*. Hand-curated,
updated rarely. This is the "what we agreed to build" anchor. Pair with
`finish-brief.md` (the standard it must reach), `current-state.md` (fast-moving
snapshot), and `project-memory.md` (long-lived context).

## Identity

- Name: Zorelan
- Slug: zorelan
- Type: existing
- Dev port: 3000
- Path: D:\dev\zorelan

## The job

One or two sentences: the single problem this project solves.

- Zorelan is a runtime **execution decision layer for AI-driven actions**. It sits
  between an AI model's output and a real backend action and decides whether that
  action should be **ALLOW**, **REVIEW**, or **BLOCK** before it runs — so an
  AI/automation system does not execute unsafe or out-of-policy actions.

## Intended user

Who actually uses this, and in what setting (desktop, field, client review)?

- Audience: developers building AI agents / automation that take real actions
  (refunds, account changes, CRM writes, etc.) and want a control/trust gate.
- Where/when used: server-side, in the execution path — the developer's backend
  calls `POST /v1/evaluate` (or the SDK `evaluateAction`) before executing.

## In scope

The bounded list of what this build covers. Keep it short.

- Structured execution gate: `POST /v1/evaluate` + SDK `evaluateAction(payload)`,
  taking a `proposed_action` + `policy`/context and returning a decision-first
  result (`verdict`, `reason`, `policy_matches`, `risk_factors`, `missing_context`,
  `next_step`, `confidence`).
- Deterministic Stage 0 decisioning for a small set of action types
  (`refund_customer`, `delete_account`, `downgrade_subscription`/`change_subscription`,
  `update_crm_record`); unknown action types fail safe to REVIEW.
- A canonical structured demo (`/demo` → `/api/demo/evaluate` → `lib/demo/evaluateAction.ts`).
- Public surfaces that lead with the execution-gate story (landing, API docs).
- Existing billing/auth: Stripe checkout + API-key issuing, Redis usage/limits,
  basic admin customer visibility (sanitized).
- Legacy prompt verification (`/v1/decision` + SDK `verify`) kept working as a
  secondary/convenience path.

## Out of scope

What this project is deliberately NOT — the scope ceiling. Add to this whenever a
tempting extra comes up.

- Not a generic AI chatbot, assistant, or broad AI platform.
- Not a trust-score / model-agreement product (that framing is legacy only).
- Not an accounts/login system, enterprise admin, RBAC, or billing portal.
- No security/compliance/enterprise certifications or claims beyond what is built.
- No model-based judgement (Stage 1) yet — deterministic checks only for now.
- Not a policy blog or thought-leadership site.

## Definition of done

The plain-English bar for "this is finished for its purpose".

- A developer can understand in seconds that Zorelan gates AI actions
  (ALLOW/REVIEW/BLOCK), try the structured demo, read the `/v1/evaluate` docs,
  and integrate `evaluateAction` — and the decisions returned are honest about
  being deterministic policy checks, not general intelligence.

## Links

- Finish standard: `finish-brief.md`
- Current snapshot: `current-state.md`
- Long-lived context: `project-memory.md`
- Decisions / risks / next: `decisions.md`, `risks.md`, `next-actions.md`
