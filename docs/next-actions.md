# Next actions — Zorelan

The short list of what to do next. This is the "pick up here" file. Keep it small
and current — when something is done, move it out, don't let this grow into a
backlog dump.

## Do next

The 1–3 highest-value things, most important first. Each should be a concrete,
bounded action.

- [ ] Verify `CRON_SECRET` and `DECISION_API_KEY` are set in Vercel — the recent
      fail-closed changes mean `/api/cron/reset-usage` and `/api/run` return 500
      until these exist. Confirm the cron still authenticates.
- [ ] Commit, push, and deploy the pending security-fix pass (sdk-test removed,
      /api/run auth, cron fail-closed) — currently uncommitted in the working tree.
- [ ] Run the small validation push: show ~10–30 targeted AI builders, leading
      with the refund-BLOCK demo and the `evaluateAction` snippet.

## Soon

Worth doing, but not the immediate next step.

- Decision Record V1 (validated next feature, per Michael/m24927605): build Phase 1
  only — return a structured `decision_record` + `decision_id` from `/v1/evaluate`,
  additive, no storage. Design brief: `docs/decision-record-v1-brief.md`.
- Harden checkout key reveal to one-time (currently re-fetchable by `session_id`
  for ~10 min).
- Convert Vercel "Needs Attention" env vars from viewable to Sensitive secrets.
- `npm audit fix` (non-force) + a planned `next` patch bump (Next high advisory is
  mitigated here — no middleware-based auth).
- Split the overloaded `DECISION_API_KEY` (master request key + admin key +
  quota-exempt) into separate admin/request keys.

## Blocked / waiting

Items stalled on a decision, an input, or an external dependency. Note what each
is waiting on.

- Stage 1 model judgement (model-based evaluation beyond deterministic checks):
  intentionally deferred until validation shows real demand. Do not build yet.

## Done recently

Newest first. Trim to the last five. Pair with `current-state.md` for the live
snapshot.

- Security/cost-abuse fix pass: removed `/api/sdk-test`, added Bearer auth to
  `/api/run`, made `/api/cron/reset-usage` fail closed.
- Final docs polish: API docs lead with `/v1/evaluate` + `evaluateAction`; legacy
  `verify` clearly demoted.
- Homepage consolidated to the execution-gate story; dead/legacy routes removed.
- Trust/ops: owner payment notification, admin customer visibility, support path,
  shorter checkout-key TTL.
