import type { Mode } from "./prompts/modes";
import type { Context } from "./prompts/contexts";
import { SYSTEM_V1 } from "./prompts/system.v1";
import { MODE_BLOCK } from "./prompts/modes";
import { CONTEXT_BLOCK } from "./prompts/contexts";

export function buildMessages(args: { mode: Mode; context: Context; input: string }) {
  const { mode, context, input } = args;

  const developer = `
You must produce outputs that feel like: "That's exactly what I meant."

Enforce brevity:
- "### Reframed Question": max 3 sentences.
- "### Optimized Prompt": structured, directive, no fluff.

The Optimized Prompt MUST embed the objective clearly and include formatting requirements.
Never mention "mode" or "context" in the final output.
Never add extra sections.

${MODE_BLOCK[mode]}

${CONTEXT_BLOCK[context]}
`.trim();

  const user = `
User input (messy, raw):
${input.trim()}
`.trim();

  return {
    system: SYSTEM_V1,
    developer,
    user,
  };
}