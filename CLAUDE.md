@AGENTS.md

## Quick reference

Zorelan is a **runtime execution decision layer for AI-driven actions** —
it sits between an AI model and real backend actions and decides whether an
AI-generated action should be **ALLOW**, **REVIEW**, or **BLOCK** before
execution.

Before any work:

- **Inspect before changing.** Read the files and their callers first.
- **Audit ≠ build.** Do not change app behaviour during an audit.
- **No destructive commands. No commits/pushes unless asked. No secrets.**
- **Don't invent env values** — use `.env.example` placeholders.
- **Don't overbuild** — product clarity beats feature bloat.
- **Validate before reporting**, and keep `docs/current-state.md` current.

For major work passes, final reports should include:

- Files changed
- What was done (and how it works)
- What was intentionally not changed
- Commands run + validation result
- Risks / unfinished items
- Exact next step
