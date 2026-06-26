# Zorelan Decision Record V1 Design Brief

> Design-only brief. No runtime code, API behaviour, or storage was changed.
> Grounds: `docs/current-state.md`, `lib/evaluate/*`, `app/v1/evaluate/route.ts`,
> and validation feedback from Michael / m24927605 (next production-grade feature
> should be a Decision Record / audit trail).

## Context snapshot (what already exists)

`POST /v1/evaluate` already returns a decision-first object
(`lib/evaluate/types.ts` → `EvaluateResponse`):

`verdict`, `reason`, `policy_matches`, `risk_factors`, `missing_context`,
`evidence`, `next_step`, `decision_basis`, `confidence`, `providers_used`,
`fell_back`, `cached`, `usage`.

So ~80% of a Decision Record is *already computed and returned* — it just is not
**named, identified, timestamped, or persisted**. The engine is deterministic
Stage 0 (`evaluateActionDeterministic`), the policy is supplied per-request
(`policy.name` + `policy.rules[]`), and nothing about a decision is stored today.
That makes V1 small.

---

## 1. Product purpose

Decision Record V1 turns each Zorelan verdict from a transient API response into
a **structured, self-describing enforcement artifact**: a single record that says
*what action was evaluated, against which policy, why the verdict was reached,
what was missing, and what to do next* — identified and timestamped so it can be
referenced, debugged, and (later) replayed.

It is **not** a generic request/response log. The value is that the record is
queryable, explainable, and replayable: an engineer, operator, or compliance
reviewer can answer "why did Zorelan return this verdict?" months later, and a
future test-fixture feature can re-run the exact case. It is the credibility
foundation a trust/control layer needs to be taken seriously in production.

## 2. What V1 should include

V1 is a **named, identified, returned** record — built almost entirely from
fields the engine already produces, plus thin provenance.

### Required fields (V1)
- `decision_id` — unique id (UUID; reuse the `crypto.randomUUID()` pattern already
  used in `app/api/feedback`).
- `schema_version` — Decision Record schema version (e.g. `"dr-v1"`), so the
  record format itself can evolve.
- `evaluated_at` — ISO 8601 timestamp (server-stamped).
- `verdict` — `ALLOW | REVIEW | BLOCK` (existing).
- `action_type` — e.g. `refund_customer` (lift from `proposed_action.type`).
- `reason` (existing).
- `policy_matches` — matched/violated rules with status + explanation (existing).
- `risk_factors` (existing).
- `missing_context` (existing).
- `decision_basis` — `deterministic` today (existing).
- `next_step` (existing).
- `confidence` (existing; secondary).
- `latency_ms` — wall-clock for the evaluation.
- `failure_mode` — `null` on success; otherwise a short code (e.g.
  `provider_unavailable`, `internal_error`). Mirrors the existing `fell_back`/
  fail-closed posture.

### Optional fields (V1, include if cheap)
- `policy_snapshot` — the exact `policy` object evaluated (name + rules array).
  Cheap because the caller already sends it; makes the record self-contained and
  replayable without a policy store. **Recommended to include.**
- `normalized_proposed_action` — the action as the engine saw it (type +
  parameters + context + reversible). Needed for replay; carries privacy weight
  (see §8).
- `evidence` (existing).
- `providers_used`, `cached`, `fell_back` (existing operational signals).

### Future fields (explicitly deferred, name them now so the schema anticipates)
- `policy_id` / `policy_version` — requires a managed policy store (does not exist
  yet; policies are inline today). Add when policy versioning ships.
- `action_schema_version` — requires typed/registered action schemas (not built).
- `user_request` / `model_output` — high privacy weight; only when opt-in storage
  + redaction exist (see §5, §8). Echoing them back in the response is fine; *storing*
  them is the deferred part.
- `model_judgement` block — when Stage 1 (model-based judgement) is built.
- `tenant_id` / `actor` — when multi-actor attribution is needed.

## 3. What V1 should not include

- No persistence by default (V1 is return-only — see §5).
- No managed policy registry / `policy_id` lookup (policies stay inline).
- No typed action-schema registry.
- No admin dashboard, search UI, or activity feed.
- No model-judgement fields (Stage 1 not built).
- No storing of raw `user_request` / `model_output` (PII) — defer to opt-in storage.
- No new auth model, accounts, or per-record ACLs.
- No analytics/aggregation over records.

## 4. API response impact

**Recommendation: return BOTH a `decision_id` and an embedded `decision_record`,
by promoting the existing flat fields into a named object — additively.**

Concretely, keep the current top-level fields for backward compatibility and add:
```
{
  "ok": true,
  "verdict": "BLOCK",
  ...existing fields...,
  "decision_id": "dr_…",
  "decision_record": {
    "decision_id": "dr_…",
    "schema_version": "dr-v1",
    "evaluated_at": "…",
    "verdict": "BLOCK",
    "action_type": "refund_customer",
    "reason": "…",
    "policy_matches": [...],
    "risk_factors": [...],
    "missing_context": [...],
    "decision_basis": "deterministic",
    "confidence": {...},
    "next_step": {...},
    "latency_ms": 12,
    "failure_mode": null,
    "policy_snapshot": {...},
    "normalized_proposed_action": {...}
  }
}
```
- **Not `decision_id` only** — that would force storage (you would need to fetch
  the record), pulling Phase 2 forward unnecessarily.
- **Not a smaller summary only** — the value is the full inspectable artifact.
- **Both** keeps existing integrations working and gives new integrations one
  clean object to persist on *their* side if they want, with zero storage on
  Zorelan's side.

SDK: surface `decision.decision_id` and `decision.decision_record` on
`evaluateAction`'s return type (additive type change, no behaviour change).

## 5. Storage approach

**V1: return-only (stateless). Zorelan does not store the record.** The caller
receives the full `decision_record` and may persist it themselves.

Rationale and tradeoffs:
- **Privacy by default.** Records can contain customer PII (refund amounts,
  `customer_id`, support messages). Not storing means no new data-retention
  liability, no new breach surface, and no GDPR/retention obligations in V1.
- **Smaller to build.** No schema, TTL, indexing, or deletion endpoints needed.
- **Phase 2 = opt-in storage**, per-API-key flag, in Redis/KV (consistent with
  current usage: `apikey:*`, usage counters), with: a short default TTL
  (e.g. 30 days), explicit redaction of high-risk fields (`user_request`,
  `model_output`) unless the customer opts into raw capture, and key-scoped
  access only. Key shape e.g. `decision:<apiKeyHash>:<decision_id>`.
- **Phase 3 / later = durable store** (Postgres or similar) only if query/search
  volume justifies it. Redis is the wrong long-term home for queryable audit data
  at scale, so do not over-invest in Redis indexing.

Do not store by default. Make storage explicit, opt-in, redacted, and TTL'd.

## 6. Admin visibility

**V1: none required** (return-only — there is nothing stored to view).

When Phase 2 storage lands, the minimum is a **lookup-by-`decision_id`** endpoint
(master-key or customer-key scoped), returning the stored record with PII fields
redacted unless explicitly requested. Reuse the existing sanitized-admin pattern
(`/api/admin/customers` returns prefixes only, builds Redis lazily, returns JSON
errors). Do **not** build a search/list/dashboard UI in Phase 2 — a single
`GET /v1/decisions/:id` (or admin equivalent) is enough.

## 7. Replay / test fixture path

The deterministic engine makes replay genuinely cheap and reliable: same inputs
→ same verdict, no model nondeterminism.

A future policy-test-fixture feature can be built directly from Decision Records:
1. A fixture = `{ proposed_action (normalized), policy_snapshot, expected_verdict }`
   — all already in the V1 record.
2. "Save as fixture" takes a Decision Record and stores the input + policy snapshot
   + the verdict that was returned as the expectation.
3. A test run feeds each fixture's `proposed_action` + `policy_snapshot` back
   through `evaluateActionDeterministic` and asserts the new verdict matches
   `expected_verdict` (and ideally `policy_matches`/`missing_context`).
4. This catches regressions when policy logic or action evaluators change — exactly
   the safety net a trust layer needs.

Because V1 records carry `policy_snapshot` and `normalized_proposed_action`,
**no extra capture work is needed later** — the fixture format is a subset of the
record. This is the strongest reason to include those two optional fields in V1.

## 8. Privacy and retention risks

Sensitive data that a Decision Record can capture:
- `user_request` — may contain customer messages, names, account details.
- `model_output` — may restate PII or sensitive context.
- `proposed_action.parameters` / `context` — `customer_id`, amounts, emails,
  order ids, identity flags.
- `policy_snapshot` — usually low-risk (business rules), but could embed internal
  thresholds.

Safeguards (apply when/if storage is enabled):
- **Return-only in V1** = no stored PII (primary safeguard).
- **Opt-in storage** per API key; default off.
- **Redaction** of `user_request` / `model_output` (and configurable parameter
  keys) unless raw capture is explicitly enabled by the customer.
- **TTL / retention** default (e.g. 30 days) with a documented policy.
- **Key-scoped access** — a customer can only read their own records; admin views
  stay sanitized; never expose other tenants' data.
- **Never store secrets** — API keys, tokens (consistent with existing posture;
  admin already shows key *prefixes* only).
- **No PII in logs** — `decision_id` + verdict + latency are fine to log; raw
  inputs are not.
- This is a `trust-critical-workflow`: if storage ships, run a ShipGuard scan
  before demo/handover (see §11 review).

## 9. Suggested implementation phases

- **Phase 0 — design/docs only (this brief).** Agree the V1 record shape, the
  `dr-v1` schema version, and the return-only stance. No code.
- **Phase 1 — return a structured `decision_record` in `/v1/evaluate`.** Add
  `decision_id`, `schema_version`, `evaluated_at`, `latency_ms`, `failure_mode`,
  `action_type`, `policy_snapshot`, `normalized_proposed_action`; wrap existing
  fields into `decision_record`; keep top-level fields for compatibility. Update
  SDK return types + API docs. No storage. Small, additive, low-risk.
- **Phase 2 — opt-in storage.** Per-key flag, Redis/KV with TTL + redaction +
  key-scoped read, plus `GET` lookup-by-id. Privacy review + ShipGuard here.
- **Phase 3 — admin/search/replay.** Minimal record lookup in `/admin`; then the
  fixture "save + replay" feature built on stored records. Durable store only if
  scale demands it.

## 10. Recommended next build

**Build Phase 1 only: return a structured `decision_record` (+ `decision_id`) from
`/v1/evaluate`, additively, with no storage.** It converts the existing response
into a real, identified, replayable artifact for almost no risk, immediately
answers Michael's "can this be inspected/debugged later?" ask (callers persist it
themselves), and lays the schema groundwork for policy versioning, typed actions,
and replay — without committing Zorelan to storing customer data yet.

**Avoid first:** building storage, admin search, or a dashboard before Phase 1 has
shipped and a customer actually asks to have records stored on Zorelan's side.

## 11. No-scope-creep review

Applying `no-scope-creep-pass` and `trust-critical-workflow` lenses to the V1 plan:
- **Defer (do not build in V1):** persistence/database, admin dashboard/search,
  policy registry (`policy_id`/version), typed action-schema registry, storing
  `user_request`/`model_output`, analytics over records, multi-tenant attribution,
  Stage 1 model-judgement fields.
- **Leave alone:** the existing deterministic engine, auth/usage model, and the
  flat top-level response fields (keep for compatibility).
- **Watch:** do not let "audit trail" pull in a logging/dashboard project — V1 is
  a *response shape change*, nothing more.
- **Trust-critical note:** V1 stores nothing, so no new sensitive-data exposure.
  The moment storage is added (Phase 2), it becomes a stored-PII feature →
  ShipGuard required before demo/handover. Scope verdict for V1:
  **in-scope-and-finished if kept to return-only.**

## 12. Open questions

(Non-blocking — V1 can proceed without resolving these.)
- Should `decision_record` fully replace the flat top-level fields in a future
  major version, or do they coexist indefinitely? (V1: coexist.)
- Default storage TTL and whether retention should be customer-configurable
  (Phase 2 decision).
- Whether `policy_snapshot` should be hashed/fingerprinted (a `policy_hash`) in
  addition to the full snapshot, as a lightweight precursor to policy versioning.
- Is `decision_id` purely opaque, or should it be sortable/time-prefixed (e.g.
  ULID) to help future querying?
