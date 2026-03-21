import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
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

export async function runOpenAI(
  prompt: string,
  signal?: AbortSignal,
  options?: ProviderStreamOptions
): Promise<string> {
  const onDelta = options?.onDelta;

  if (!onDelta) {
    const completion = await client.chat.completions.create(
      {
        model: "gpt-4o-mini",
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: DEFAULT_SYSTEM,
          },
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

    return completion.choices?.[0]?.message?.content?.trim() ?? "";
  }

  const stream = await client.chat.completions.create(
    {
      model: "gpt-4o-mini",
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: 0.3,
      stream: true,
      messages: [
        {
          role: "system",
          content: DEFAULT_SYSTEM,
        },
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

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content ?? "";
    if (!delta) continue;

    fullText += delta;
    onDelta(delta);
  }

  return fullText.trim();
}