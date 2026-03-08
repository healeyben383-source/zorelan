import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.warn("GEMINI_API_KEY is not set");
}

const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

const DEFAULT_SYSTEM = `You are a concise, insightful AI assistant.
Provide clear, well-structured responses with practical value.
Use headings and bullet points where helpful.
Maximum response length: 250-300 words. Do not exceed this under any circumstances.
Be direct and avoid unnecessary detail, padding, or repetition.`;

type GeminiRunParams = {
  prompt: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
};

export async function runGemini({
  prompt,
  system = DEFAULT_SYSTEM,
  temperature = 0.4,
  maxTokens = 4096,
}: GeminiRunParams): Promise<string> {
  if (!genAI) {
    throw new Error("Missing GEMINI_API_KEY");
  }

  const modelName = "gemini-2.5-flash";

  try {
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: system,
    });

    const runRequest = async (): Promise<string> => {
      const result = await model.generateContent({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
        },
      });

      const text = result.response.text()?.trim();
      return text || "";
    };

    const firstText = await runRequest();

    if (firstText) {
      return firstText;
    }

    console.warn("[GEMINI] Empty response on first attempt, retrying once...");

    const secondText = await runRequest();

    if (secondText) {
      return secondText;
    }

    throw new Error("Gemini returned empty output after retry");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown Gemini error";

    throw new Error(`Gemini provider failed [${modelName}]: ${message}`);
  }
}