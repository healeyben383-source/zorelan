import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.PERPLEXITY_API_KEY,
  baseURL: "https://api.perplexity.ai",
});

const MAX_OUTPUT_TOKENS = 800;

const DEFAULT_SYSTEM = `You are a concise, insightful AI assistant with access to real-time web search.
Provide clear, well-structured responses with practical value.
Use headings and bullet points where helpful.
Maximum response length: 250-300 words. Do not exceed this under any circumstances.
Be direct and avoid unnecessary detail, padding, or repetition.
Where relevant, include current or recent information.`;

export async function runPerplexity(
  prompt: string,
  signal?: AbortSignal
): Promise<string> {
  const completion = await client.chat.completions.create(
    {
      model: "sonar",
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
