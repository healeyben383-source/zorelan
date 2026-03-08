import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.PERPLEXITY_API_KEY,
  baseURL: "https://api.perplexity.ai",
});

const DEFAULT_SYSTEM = `You are a concise, insightful AI assistant with access to real-time web search.
Provide clear, well-structured responses with practical value.
Use headings and bullet points where helpful.
Maximum response length: 250-300 words. Do not exceed this under any circumstances.
Be direct and avoid unnecessary detail, padding, or repetition.
Where relevant, include current or recent information.`;

export async function runPerplexity(prompt: string): Promise<string> {
  const completion = await client.chat.completions.create({
    model: "sonar",
    max_tokens: 1024,
    messages: [
      { role: "system", content: DEFAULT_SYSTEM },
      { role: "user", content: prompt },
    ],
  });
  return completion.choices[0]?.message?.content ?? "";
}