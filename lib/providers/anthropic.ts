import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MAX_OUTPUT_TOKENS = 800;

const DEFAULT_SYSTEM = `You are a concise, insightful AI assistant.
Provide clear, well-structured responses with practical value.
Use headings and bullet points where helpful.
Maximum response length: 250-300 words. Do not exceed this under any circumstances.
Be direct and avoid unnecessary detail, padding, or repetition.`;

export async function runAnthropic(
  prompt: string,
  signal?: AbortSignal
): Promise<string> {
  const message = await client.messages.create(
    {
      model: "claude-sonnet-4-5-20251001",
      max_tokens: MAX_OUTPUT_TOKENS,
      system: DEFAULT_SYSTEM,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    },
    {
      signal,
    }
  );

  const block = message.content?.[0];

  if (block && block.type === "text") {
    return block.text.trim();
  }

  return "";
}