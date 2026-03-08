import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DEFAULT_SYSTEM = `You are a concise, insightful AI assistant.
Provide clear, well-structured responses with practical value.
Use headings and bullet points where helpful.
Maximum response length: 250-300 words. Do not exceed this under any circumstances.
Be direct and avoid unnecessary detail, padding, or repetition.`;

export async function runAnthropic(prompt: string): Promise<string> {
  console.log("[anthropic] key starts with:", process.env.ANTHROPIC_API_KEY?.slice(0, 10));
  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: DEFAULT_SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });
  const block = message.content[0];
  return block.type === "text" ? block.text : "";
}