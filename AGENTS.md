# Zorelan — Operating Instructions (Claude Agent)

You are working on **Zorelan**. Read this file before making any change.

## What Zorelan is

Zorelan is a **runtime execution decision layer for AI-driven actions**.
It sits between an AI model and real backend actions. It evaluates whether
an AI-generated action should be **ALLOW**, **REVIEW**, or **BLOCK** before
execution.

Keep this identity intact in everything you build, audit, or document. When
a change would blur this positioning, stop and flag it rather than drifting
the product into something else.

## Tech stack

- Next.js 16 (App Router) + React 19 + TypeScript (strict)
- Tailwind CSS v4
- AI providers: Anthropic, OpenAI, Google Gemini, Perplexity
  (`lib/providers/*`)
- Routing / selection, synthesis, and verification engines under `lib/`
- Upstash Redis (rate limiting, usage, provider scores) via
  `KV_REST_API_*`
- Stripe for checkout + webhook billing
- Resend for transactional email
- Public SDK published as `@zorelan/sdk` (source in `sdk/`)
- Deployed on Vercel

Routes of note: `app/v1/decision/route.ts` and `app/api/decision/route.ts`
are the core decision endpoints. `app/demo/` is the public demo.

---

## How to work here

### 1. Inspect before you change

- Read the files you intend to touch, and their callers, before editing.
- Understand the existing pattern and match it. Do not introduce a second
  way of doing something that already has a way.
- If the request is ambiguous, ask one sharp question instead of guessing.

### 2. Two modes — keep them separate

- **Audit mode**: inspect, measure, and report. Do **not** change app
  behaviour, UI, copy, API responses, model logic, pricing, Stripe, the
  demo, the SDK, or the landing page during an audit. Read-only plus notes.
- **Build mode**: make the requested change with the smallest correct diff.

Never silently slip from audit into build. If an audit surfaces a fix,
report it and let the user decide.

### 3. Safety rules (always on)

- Never run destructive commands (`rm -rf`, recursive force-delete,
  `git add .`/`-A`, `git push --force` without `--force-with-lease`,
  `npm audit fix --force`, broad process kills).
- Never commit, push, deploy, or stage files unless explicitly asked.
- Do not touch secrets. Never read, print, move, or paste real API keys,
  tokens, or `.env*.local` contents.
- Do not invent env values. Document required env vars in `.env.example`
  as placeholders only.
- Ask before broad changes (renames across many files, dependency changes,
  new abstractions, schema/route reshaping).

### 4. Don't overbuild

- Build only what was asked. No speculative features, abstractions, config
  knobs, or error handling that nobody requested.
- Do not add dependencies without flagging them first.
- **Product clarity matters more than feature bloat.** A sharper, simpler
  product beats more surface area. When in doubt, cut.

### 5. Validate before you report

- Run safe validation after changes: `git status`, then `npm run lint`
  and/or `npm run build` when relevant and reasonable.
- For TypeScript changes, `npx tsc --noEmit` should be clean.
- Never claim something works that you have not checked. If you skipped a
  check, say so.

### 6. Keep docs current

- After any meaningful change, update `docs/current-state.md` so it
  reflects reality (what works, what's in flight, known gaps).
- Do not paste secrets into docs.

---

## Final report (every non-trivial task)

End with:

1. **Files changed** — paths.
2. **What was done** — and how it works.
3. **What was intentionally not changed** — confirm no unrequested
   app/UI/copy/API/model/pricing/Stripe/demo/SDK/landing changes.
4. **Validation** — commands run and their results.
5. **Risks / unfinished items.**
6. **Exact next step** — the command, file, or question to resume from.
