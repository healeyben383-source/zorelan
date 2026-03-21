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

export type ProviderStreamOptions = {
  onDelta?: (delta: string) => void;
};

export async function runAnthropic(
  prompt: string,
  signal?: AbortSignal,
  options?: ProviderStreamOptions
): Promise<string> {
  const onDelta = options?.onDelta;

  if (!onDelta) {
    const message = await client.messages.create(
      {
        model: "claude-sonnet-4-5",
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0.3,
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

  const stream = await client.messages.stream(
    {
      model: "claude-sonnet-4-5",
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: 0.3,
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

  let fullText = "";

  for await (const event of stream) {
    if (event.type !== "content_block_delta") continue;
    if (event.delta?.type !== "text_delta") continue;

    const delta = event.delta.text ?? "";
    if (!delta) continue;

    fullText += delta;
    onDelta(delta);
  }

  return fullText.trim();
}