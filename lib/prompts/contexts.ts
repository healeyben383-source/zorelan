export type Context = "operator" | "general" | "student";

export const CONTEXT_BLOCK: Record<Context, string> = {
  operator: `
Context: OPERATOR

Assume:
- High agency, wants decisive clarity
- Minimal explanation, maximum leverage
Style:
- Direct, concise, outcome-first

In the Optimized Prompt, enforce:
- No hand-holding
- Prioritize measurable impact
`.trim(),

  general: `
Context: GENERAL

Assume:
- Practical needs, mixed experience level
Style:
- Clear, grounded, minimal jargon

In the Optimized Prompt, enforce:
- Briefly clarify terms if used
- Balance action with clarity
`.trim(),

  student: `
Context: STUDENT

Assume:
- Wants to learn the reasoning while still getting actions
Style:
- Slightly more explanatory, still concise

In the Optimized Prompt, enforce:
- Brief reasoning behind prioritization
- Define key terms briefly
`.trim(),
};