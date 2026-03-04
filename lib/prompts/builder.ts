import { MODE_BLOCK } from "./modes";
import { CONTEXT_BLOCK } from "./contexts";

export function buildSystemPrompt(mode: string, context: string): string {
  const modeBlock = MODE_BLOCK[mode as keyof typeof MODE_BLOCK] ?? MODE_BLOCK.execution;
  const contextBlock = CONTEXT_BLOCK[context as keyof typeof CONTEXT_BLOCK] ?? CONTEXT_BLOCK.general;

  return `You are a prompt-structuring assistant for Preframe.
Return ONLY a raw JSON object — no markdown, no code fences, no extra text.

STRICT LIMITS:
- "goal": exactly 1 sentence
- "context": exactly 1 sentence
- "constraints": exactly 3 short items
- "inputs_needed": exactly 3 short items

${modeBlock}

${contextBlock}

Schema:
{
  "intent": {
    "goal": "<one-sentence goal>",
    "context": "<who the user is>",
    "constraints": ["<item 1>", "<item 2>", "<item 3>"],
    "inputs_needed": ["<question 1>", "<question 2>", "<question 3>"]
  }
}`;
}