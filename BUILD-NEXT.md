# Build Next — Zorelan

Running list of what to do next. Keep it short and current. Newest
priorities at the top. Move finished items out (or into git history).

Zorelan is a **runtime execution decision layer for AI-driven actions**
(ALLOW / REVIEW / BLOCK before execution). Keep that positioning intact.

## Now

- [ ] Full product audit (read-only): landing, demo, API + API docs,
      payment/Stripe flow, contact path, SDK. Audit mode only — no app,
      UI, copy, API, model, pricing, or demo changes during the audit.

## Next

- [ ] Act on the audit findings (build mode), smallest correct diffs,
      one concern at a time.

## Notes for whoever picks this up

- Read `AGENTS.md` first. Inspect before changing. Audit ≠ build.
- No destructive commands. No commits/pushes unless asked. No secrets.
- Don't invent env values — use `.env.example` placeholders.
- Validate (`git status`, `npm run lint`, `npm run build`) before reporting.
- Update `docs/current-state.md` after meaningful changes.
