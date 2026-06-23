# Risks — Zorelan

Known risks, sharp edges, and things that could bite later. Hand-curated. Review
at the end of each working session and before any handover or demo.

Do not paste secrets, tokens, or API keys into this file.

## How to use

One row per risk. Keep it blunt. Close a risk by moving it to "Resolved /
accepted" with a one-line outcome, rather than deleting it.

## Open risks

Highest impact first.

| Risk | Impact | Likelihood | Mitigation / next step |
| --- | --- | --- | --- |
| Overclaiming intelligence/safety: engine is deterministic Stage 0 with only ~4 action types; unknown → REVIEW. Developers may expect general reasoning. | High (credibility) | Medium | Keep docs/demo honest about deterministic scope; do not market model judgement until built. |
| Fail-closed routes (`/api/run`, `/api/cron/reset-usage`) return 500 if `DECISION_API_KEY` / `CRON_SECRET` are missing in prod. | Med (cron stops, benchmark breaks) | Medium | Verify both env vars are set in Vercel (see next-actions). |
| Checkout API-key reveal re-fetchable by `session_id` for ~10 min (not one-time); `session_id` can leak via URL/history/referrer. | Med (key disclosure) | Low | Move to one-time reveal that deletes the mapping after first read. |
| `DECISION_API_KEY` overloaded: master request key + admin key + quota-exempt. One leak = broad blast radius. | High if leaked | Low | Split admin key from request key. |
| Dependency advisories (npm audit: ~10, incl. a Next high). | Med | Low | Next advisory mitigated (no middleware-based auth); run `npm audit fix` + planned `next` bump. |
| Pending security fixes are uncommitted/undeployed — live site still has the old behaviour. | Med | Medium | Commit, push, deploy the security-fix pass. |
| `redis.keys("apikey:*")` in admin/cron is O(N). | Low now | Low | Switch to `SCAN` before scale. |

## Trust / safety watch

Anything touching private data, approvals, payments, messages, or public-facing
automation. If any of these are live, consider a `trust-critical-workflow`
finish review and a ShipGuard scan before demo/handover.

- Zorelan gates **real backend actions** (refunds, deletions, billing/CRM changes)
  — a trust-critical workflow by nature. A `trust-critical-workflow` finish review
  is appropriate before broader exposure.
- Handles API keys, Stripe billing/webhooks, and Redis-stored usage. No ShipGuard
  scan command exists in this repo (manual security audit was done instead).
- Customer/API-key admin view is sanitized (prefix only) — keep it that way.

## Resolved / accepted

Newest first. One line each: what it was and how it was closed or why it was
accepted.

- Unauthenticated paid-call endpoints (`/api/sdk-test`, `/api/run`) and fail-open
  cron — closed in the 2026-06-15 security-fix pass (removed / Bearer-auth / fail
  closed).
